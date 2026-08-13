import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { PERMISSIONS } from "@/lib/permissions-core";

type RouteContext = { params: Promise<{ id: string }> };

async function resolveTeamAccess(
  userId: string,
  specialPermissions: string[],
  teamId: string
): Promise<{ team: { id: string; name: string; slug: string; logoUrl: string | null } | null; canManage: boolean }> {
  const isSuperAdmin = specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS);

  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { id: true, name: true, slug: true, logoUrl: true },
  });

  if (!team) return { team: null, canManage: false };

  if (isSuperAdmin) return { team, canManage: true };

  const membership = await db.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { teamRole: true },
  });

  return {
    team,
    canManage: membership?.teamRole === "ADMIN",
  };
}

const updateTeamSchema = z.object({
  name: z.string().min(1).max(80).trim().optional(),
  logoUrl: z.string().url().nullable().optional(),
});

/** GET /api/teams/[id] — team detail */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const { team } = await resolveTeamAccess(session.user.id, session.user.specialPermissions, id);
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  const full = await db.team.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { memberships: true, projects: true } },
    },
  });
  if (!full) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  return NextResponse.json({
    id: full.id,
    name: full.name,
    slug: full.slug,
    logoUrl: full.logoUrl ?? null,
    createdAt: full.createdAt.toISOString(),
    updatedAt: full.updatedAt.toISOString(),
    memberCount: full._count.memberships,
    projectCount: full._count.projects,
  });
}

/** PATCH /api/teams/[id] — rename team (team ADMIN or super admin) */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const { team, canManage } = await resolveTeamAccess(
    session.user.id,
    session.user.specialPermissions,
    id
  );
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateTeamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const updated = await db.team.update({
    where: { id },
    data: {
      ...(parsed.data.name && { name: parsed.data.name }),
      ...(parsed.data.logoUrl !== undefined && { logoUrl: parsed.data.logoUrl }),
    },
    select: { id: true, name: true, slug: true, logoUrl: true, updatedAt: true },
  });

  return NextResponse.json({ ...updated, logoUrl: updated.logoUrl ?? null, updatedAt: updated.updatedAt.toISOString() });
}

/** DELETE /api/teams/[id] — delete team (super admin only) */
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isSuperAdmin = session.user.specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS);
  if (!isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden — super admin only" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const team = await db.team.findUnique({ where: { id }, select: { id: true } });
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  // Prevent deleting a team that still has projects (data would become orphaned)
  const projectCount = await db.project.count({ where: { teamId: id } });
  if (projectCount > 0) {
    return NextResponse.json(
      { error: "Cannot delete a team that still has projects. Reassign or delete projects first." },
      { status: 409 }
    );
  }

  await db.team.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
