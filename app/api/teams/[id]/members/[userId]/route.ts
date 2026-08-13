import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { PERMISSIONS } from "@/lib/permissions-core";

type RouteContext = { params: Promise<{ id: string; userId: string }> };

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

const patchMemberSchema = z.object({
  teamRole: z.enum(["ADMIN", "MEMBER"]),
});

/** PATCH /api/teams/[id]/members/[userId] — change a member's team role */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: teamId, userId } = await ctx.params;
  const ok = await canManageTeam(session.user.id, session.user.specialPermissions, teamId);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const membership = await db.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { id: true },
  });
  if (!membership) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const updated = await db.teamMembership.update({
    where: { userId_teamId: { userId, teamId } },
    data: { teamRole: parsed.data.teamRole },
    select: { teamRole: true },
  });

  return NextResponse.json({ teamRole: updated.teamRole });
}

/** DELETE /api/teams/[id]/members/[userId] — remove a member from the team */
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: teamId, userId } = await ctx.params;
  const ok = await canManageTeam(session.user.id, session.user.specialPermissions, teamId);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const membership = await db.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { id: true },
  });
  if (!membership) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  await db.teamMembership.delete({ where: { userId_teamId: { userId, teamId } } });
  return new NextResponse(null, { status: 204 });
}
