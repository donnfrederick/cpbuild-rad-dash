import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { PERMISSIONS } from "@/lib/permissions-core";

type RouteContext = { params: Promise<{ id: string }> };

async function canManageTeam(
  userId: string,
  specialPermissions: string[],
  teamId: string
): Promise<boolean> {
  if (specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS)) return true;
  const m = await db.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { teamRole: true },
  });
  return m?.teamRole === "ADMIN";
}

const addMemberSchema = z.object({
  userId: z.string().min(1),
  teamRole: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

/** GET /api/teams/[id]/members — list team members */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: teamId } = await ctx.params;

  const isSuperAdmin = session.user.specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS);
  const hasMembership = await db.teamMembership.findUnique({
    where: { userId_teamId: { userId: session.user.id, teamId } },
    select: { teamId: true },
  });

  if (!isSuperAdmin && !hasMembership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const team = await db.team.findUnique({ where: { id: teamId }, select: { id: true } });
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  const members = await db.teamMembership.findMany({
    where: { teamId },
    orderBy: [{ teamRole: "asc" }, { user: { name: "asc" } }],
    select: {
      id: true,
      teamRole: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          role: { select: { code: true, name: true } },
        },
      },
    },
  });

  return NextResponse.json({
    members: members.map((m) => ({
      membershipId: m.id,
      teamRole: m.teamRole,
      joinedAt: m.createdAt.toISOString(),
      user: {
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        status: m.user.status,
        roleCode: m.user.role.code,
        roleName: m.user.role.name,
      },
    })),
  });
}

/** POST /api/teams/[id]/members — add an existing user to the team */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: teamId } = await ctx.params;

  const ok = await canManageTeam(session.user.id, session.user.specialPermissions, teamId);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const team = await db.team.findUnique({ where: { id: teamId }, select: { id: true } });
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = addMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const user = await db.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, name: true, email: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const membership = await db.teamMembership.create({
      data: {
        userId: parsed.data.userId,
        teamId,
        teamRole: parsed.data.teamRole,
      },
      select: { id: true, teamRole: true, createdAt: true },
    });
    return NextResponse.json(
      {
        membershipId: membership.id,
        teamRole: membership.teamRole,
        joinedAt: membership.createdAt.toISOString(),
        user: { id: user.id, name: user.name, email: user.email },
      },
      { status: 201 }
    );
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code: string }).code)
        : "";
    if (code === "P2002") {
      return NextResponse.json({ error: "User is already a member of this team" }, { status: 409 });
    }
    throw e;
  }
}
