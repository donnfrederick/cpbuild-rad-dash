import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { resolveAccessibleTeamIds } from "@/lib/team-context";
import { hasTicketTriageAccess } from "@/lib/ticket-access";
import {
  buildSprintCompletionPreview,
  loadSprintCompletionScopeRow,
  loadTicketsForSprintCompletion,
} from "@/lib/sprint-completion";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasTicketTriageAccess(session.user.role, session.user.specialPermissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: sprintId } = await ctx.params;

  const scopeRow = await loadSprintCompletionScopeRow(db, sprintId);
  if (!scopeRow) {
    return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
  }

  const teamIds = await resolveAccessibleTeamIds(session.user.id, session.user.specialPermissions);
  if (!teamIds.includes(scopeRow.teamId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (scopeRow.completedAt) {
    return NextResponse.json({ error: "Sprint is already completed" }, { status: 400 });
  }

  const tickets = await loadTicketsForSprintCompletion(db, scopeRow);
  const preview = buildSprintCompletionPreview(tickets);

  return NextResponse.json(preview);
}
