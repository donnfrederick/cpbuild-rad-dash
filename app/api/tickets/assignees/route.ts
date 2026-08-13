import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { filterMembersForTicketAssignee } from "@/lib/ticket-assignment";
import { resolveTeamContext } from "@/lib/team-context";

/**
 * GET /api/tickets/assignees
 * Users eligible for ticket assignment — filtered to the current team when a `team` param is provided.
 */
export async function GET(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teamParam = req.nextUrl.searchParams.get("team");
  const teamCtx = await resolveTeamContext(
    ctx.user.id,
    ctx.user.specialPermissions,
    teamParam
  );

  const users = await db.user.findMany({
    where: teamCtx
      ? { teamMemberships: { some: { teamId: teamCtx.teamId } } }
      : undefined,
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: { select: { code: true } },
    },
  });

  const data = filterMembersForTicketAssignee(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role.code,
    }))
  );

  return NextResponse.json({
    data: data.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
    })),
  });
}
