import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  getMentionedTicketIds,
  hasTicketTriageAccess,
  ticketListWhereClause,
  ticketMainInboxVisibilityWhere,
} from "@/lib/ticket-access";
import { getSessionContext } from "@/lib/session-context";
import { buildSprintCompletionReport } from "@/lib/sprint-completion-report";
import { mapSprintRowToApi, sprintApiSelect } from "@/lib/sprint-map";
import { resolveAccessibleTeamIds } from "@/lib/team-context";
import { ticketWhereForSprintScope } from "@/lib/sprint-ticket-where";

export const dynamic = "force-dynamic";

const reportTicketSelect = {
  id: true,
  title: true,
  status: true,
  type: true,
  priority: true,
  storyPoints: true,
  ticketScopeKey: true,
  ticketKeyNumber: true,
  assignee: { select: { id: true, name: true, email: true } },
  project: { select: { id: true, name: true, ticketKeyPrefix: true } },
} satisfies Prisma.TicketSelect;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: sprintId } = await ctx.params;

  const sprint = await db.sprint.findUnique({
    where: { id: sprintId },
    select: {
      ...sprintApiSelect(),
      teamId: true,
      completedAt: true,
      sprintTickets: { select: { ticketId: true } },
    },
  });

  if (!sprint) {
    return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
  }

  const teamIds = await resolveAccessibleTeamIds(session.user.id, session.user.specialPermissions);
  if (!teamIds.includes(sprint.teamId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!sprint.completedAt) {
    return NextResponse.json({ error: "Sprint is not completed" }, { status: 400 });
  }

  const canViewAll = hasTicketTriageAccess(session.user.role, session.user.specialPermissions);
  const mentionedIds = canViewAll ? [] : await getMentionedTicketIds(session.user.id);
  const accessWhere = ticketListWhereClause(
    session.user.id,
    session.user.role,
    mentionedIds,
    session.user.specialPermissions,
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

  const tickets = await db.ticket.findMany({
    where: ticketWhere,
    select: reportTicketSelect,
  });

  const { sprintTickets, teamId, ...sprintRow } = sprint;
  void sprintTickets;
  void teamId;

  const report = buildSprintCompletionReport(tickets, {
    pointsPlanned: sprint.pointsPlanned,
    unassignedProjectLabel: "Unassigned",
    unassignedAssigneeLabel: "Unassigned",
  });

  return NextResponse.json({
    sprint: mapSprintRowToApi(sprintRow),
    completedAt: sprint.completedAt.toISOString(),
    report,
  });
}
