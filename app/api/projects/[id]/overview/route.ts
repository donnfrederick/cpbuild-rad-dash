import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildTicketRefFromParts } from "@/lib/ticket-display-ref";
import { getSessionContext } from "@/lib/session-context";
import { canViewProject } from "@/lib/project-management-server";
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

  const allowed = await canViewProject(
    ctx.user.id,
    ctx.user.role,
    ctx.user.specialPermissions,
    id
  );
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const project = await db.project.findUnique({
    where: { id },
    select: { id: true, name: true, description: true },
  });

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [statusGroups, typeGroups, priorityGroups, forReviewCount, assignedToMeCount, mostRecentTicket] = await Promise.all([
    db.ticket.groupBy({
      by: ["status"],
      where: { projectId: id },
      _count: { _all: true },
    }),
    db.ticket.groupBy({
      by: ["type"],
      where: { projectId: id },
      _count: { _all: true },
    }),
    db.ticket.groupBy({
      by: ["priority"],
      where: { projectId: id },
      _count: { _all: true },
    }),
    db.ticket.count({
      where: { projectId: id, status: "FOR_REVIEW" },
    }),
    db.ticket.count({
      where: { projectId: id, assigneeId: ctx.user.id },
    }),
    db.ticket.findFirst({
      where: { projectId: id },
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

  const countsByStatus = new Map(statusGroups.map((g) => [g.status as TicketStatus, g._count._all]));
  const statusBreakdown: { status: TicketStatus; count: number }[] = ALL_STATUSES.map((status) => ({
    status,
    count: countsByStatus.get(status) ?? 0,
  }));

  const totalTickets = statusBreakdown.reduce((sum, s) => sum + s.count, 0);

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

  return NextResponse.json({
    projectName: project.name,
    projectDescription: project.description,
    totalTickets,
    forReviewCount,
    assignedToMeCount,
    statusBreakdown,
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
