import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { PERMISSIONS } from "@/lib/permissions-core";

type RouteContext = { params: Promise<{ id: string }> };

async function canManageTeam(
  callerId: string,
  specialPermissions: string[],
  teamId: string
): Promise<boolean> {
  if (specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS)) return true;
  const m = await db.teamMembership.findUnique({
    where: { userId_teamId: { userId: callerId, teamId } },
    select: { teamRole: true },
  });
  return m?.teamRole === "ADMIN";
}

/**
 * GET /api/teams/[id]/addable-users?search=
 * Returns users that are NOT already members of this team.
 * Accessible to team admins and super admins.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: teamId } = await ctx.params;

  const ok = await canManageTeam(session.user.id, session.user.specialPermissions, teamId);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const search = req.nextUrl.searchParams.get("search")?.trim() ?? "";

  const existingMemberIds = await db.teamMembership.findMany({
    where: { teamId },
    select: { userId: true },
  });
  const excludeIds = existingMemberIds.map((m) => m.userId);

  const users = await db.user.findMany({
    where: {
      id: { notIn: excludeIds.length > 0 ? excludeIds : undefined },
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    take: 30,
  });

  return NextResponse.json({ users });
}
