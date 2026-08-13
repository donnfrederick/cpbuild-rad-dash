import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { hasTicketTriageAccess } from "@/lib/ticket-access";
import { getCachedTicketsList } from "@/lib/tickets-list-loader";
import {
  loadOtherActiveSprintsForScope,
  ticketIdsBlockedByOtherActiveSprints,
} from "@/lib/sprint-other-active-scope";

/**
 * Tickets the user may add to this sprint's explicit set: any ticket not already
 * in this sprint and not already on another **active** sprint's board.
 * Project membership is not required.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasTicketTriageAccess(session.user.role, session.user.specialPermissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: sprintId } = await ctx.params;

  const sprint = await db.sprint.findUnique({
    where: { id: sprintId },
    select: {
      sprintTickets: { select: { ticketId: true } },
    },
  });
  if (!sprint) {
    return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
  }

  const { tickets } = await getCachedTicketsList({
    userId: session.user.id,
    role: session.user.role,
    specialPermissions: session.user.specialPermissions ?? [],
    projectIdParam: null,
    sprintIdParam: null,
    projectIdsParam: null,
    sprintIdsParam: null,
    archivedList: false,
    globalProjectFilter: false,
    globalProjectIdList: [],
    includeUnassignedGlobal: false,
    teamId: null,
  });

  const inThisSprint = new Set(sprint.sprintTickets.map((r) => r.ticketId));
  const otherActive = await loadOtherActiveSprintsForScope(sprintId);
  const blocked = ticketIdsBlockedByOtherActiveSprints(
    tickets.map((t) => ({ id: t.id, projectId: t.projectId ?? null })),
    otherActive
  );

  const eligible = tickets.filter((t) => !inThisSprint.has(t.id) && !blocked.has(t.id));
  return NextResponse.json({ tickets: eligible });
}
