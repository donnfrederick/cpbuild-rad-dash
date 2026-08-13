import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildTicketRefFromParts } from "@/lib/ticket-display-ref";
import {
  getMentionedTicketIds,
  hasTicketTriageAccess,
  ticketListWhereClause,
  ticketMainInboxVisibilityWhere,
} from "@/lib/ticket-access";
import { getSessionContext } from "@/lib/session-context";
import { mapSprintRowToApi, sprintApiSelect } from "@/lib/sprint-map";
import { ticketWhereForSprintScope } from "@/lib/sprint-ticket-where";
import type { TicketStatus } from "@/components/tickets/ticket-types";

const ALL_STATUSES: TicketStatus[] = [
  "BACKLOG",
  "READY",
  "IN_PROGRESS",
  "FOR_REVIEW",
  "RESOLVED",
  "TO_BE_DEPLOYED",
  "DONE",
  "ARCHIVED",
];

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const sprint = await db.sprint.findUnique({
    where: { id },
    select: {
      ...sprintApiSelect(),
      teamId: true,
      sprintTickets: { select: { ticketId: true } },
    },
  });

  if (!sprint) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const canViewAll = hasTicketTriageAccess(ctx.user.role, ctx.user.specialPermissions);
  const mentionedIds = canViewAll ? [] : await getMentionedTicketIds(ctx.user.id);
  const accessWhere = ticketListWhereClause(
    ctx.user.id,
    ctx.user.role,
    mentionedIds,
    ctx.user.specialPermissions,
    sprint.teamId
  );

  const scopeWhere = ticketWhereForSprintScope({
    projects: sprint.projects.map((p) => ({ projectId: p.projectId })),
    sprintTickets: sprint.sprintTickets,
  });

  const extraAnd = [accessWhere, scopeWhere].filter(
    (w): w is NonNullable<typeof w> => w != null
  );
  const ticketWhere = {
    AND: [ticketMainInboxVisibilityWhere(), ...extraAnd],
  };

  const [
    statusGroups,
    statusPointGroups,
    typeGroups,
    priorityGroups,
    forReviewCount,
    assignedToMeCount,
    mostRecentTicket,
  ] = await Promise.all([
    db.ticket.groupBy({
      by: ["status"],
      where: ticketWhere,
      _count: { _all: true },
    }),
    db.ticket.groupBy({
      by: ["status"],
      where: ticketWhere,
      _sum: { storyPoints: true },
    }),
    db.ticket.groupBy({
      by: ["type"],
      where: ticketWhere,
      _count: { _all: true },
    }),
    db.ticket.groupBy({
      by: ["priority"],
      where: ticketWhere,
      _count: { _all: true },
    }),
    db.ticket.count({
      where: { ...ticketWhere, status: "FOR_REVIEW" },
    }),
    db.ticket.count({
      where: { ...ticketWhere, assigneeId: ctx.user.id },
    }),
    db.ticket.findFirst({
      where: ticketWhere,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        shortId: true,
        ticketScopeKey: true,
        ticketKeyNumber: true,
        title: true,
        status: true,
        priority: true,
        storyPoints: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
        project: { select: { ticketKeyPrefix: true } },
      },
    }),
  ]);

  const countsByStatus = new Map(
    statusGroups.map((g) => [g.status as TicketStatus, g._count._all])
  );
  const statusBreakdown: { status: TicketStatus; count: number }[] = ALL_STATUSES.map(
    (status) => ({
      status,
      count: countsByStatus.get(status) ?? 0,
    })
  );

  const pointsByStatus = new Map(
    statusPointGroups.map((g) => {
      const sum = g._sum.storyPoints;
      const n = sum == null ? 0 : Number(sum);
      return [g.status as TicketStatus, Number.isFinite(n) ? n : 0] as const;
    })
  );
  const statusPointsBreakdown: { status: TicketStatus; points: number }[] = ALL_STATUSES.map(
    (status) => ({
      status,
      points: pointsByStatus.get(status) ?? 0,
    })
  );

  const totalTickets = statusBreakdown.reduce((sum, s) => sum + s.count, 0);
  const totalStoryPoints = statusPointsBreakdown.reduce((sum, s) => sum + s.points, 0);

  const typeBreakdown = {
    BUG: typeGroups.find((g) => (g.type as string) === "BUG")?._count._all ?? 0,
    FEATURE_REQUEST: typeGroups.find((g) => (g.type as string) === "FEATURE_REQUEST")?._count._all ?? 0,
    FEEDBACK: typeGroups.find((g) => (g.type as string) === "FEEDBACK")?._count._all ?? 0,
    MINOR_ENHANCEMENT: typeGroups.find((g) => (g.type as string) === "MINOR_ENHANCEMENT")?._count._all ?? 0,
    REGRESSION: typeGroups.find((g) => (g.type as string) === "REGRESSION")?._count._all ?? 0,
    SECURITY_IMPROVEMENT: typeGroups.find((g) => (g.type as string) === "SECURITY_IMPROVEMENT")?._count._all ?? 0,
  };

  const priorityBreakdown = {
    HIGH: priorityGroups.find((g) => g.priority === "HIGH")?._count._all ?? 0,
    MEDIUM: priorityGroups.find((g) => g.priority === "MEDIUM")?._count._all ?? 0,
    LOW: priorityGroups.find((g) => g.priority === "LOW")?._count._all ?? 0,
    NONE: priorityGroups.find((g) => g.priority === null)?._count._all ?? 0,
  };

  const { sprintTickets, teamId, ...sprintRow } = sprint;
  void sprintTickets;

  const rollingRows = await db.sprint.findMany({
    where: {
      teamId,
      completedAt: { not: null },
      velocity: { not: null },
    },
    orderBy: { completedAt: "desc" },
    take: 8,
    select: { velocity: true },
  });
  const velocities = rollingRows
    .map((r) => r.velocity)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const teamVelocityRollingAvg8 =
    velocities.length === 0
      ? null
      : Math.round(velocities.reduce((a, b) => a + b, 0) / velocities.length);

  return NextResponse.json({
    sprint: mapSprintRowToApi(sprintRow),
    teamVelocityRollingAvg8,
    totalTickets,
    forReviewCount,
    assignedToMeCount,
    statusBreakdown,
    statusPointsBreakdown,
    totalStoryPoints,
    typeBreakdown,
    priorityBreakdown,
    mostRecentTicket: mostRecentTicket
      ? {
          ...mostRecentTicket,
          ref: buildTicketRefFromParts(
            mostRecentTicket.ticketScopeKey,
            mostRecentTicket.ticketKeyNumber,
            mostRecentTicket.project?.ticketKeyPrefix
          ),
          createdAt: mostRecentTicket.createdAt.toISOString(),
        }
      : null,
  });
}
