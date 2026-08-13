import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { PERMISSIONS } from "@/lib/permissions-core";

type RouteContext = { params: Promise<{ id: string }> };

async function resolveAccess(
  userId: string,
  specialPermissions: string[],
  teamId: string
): Promise<{ isMember: boolean; canManage: boolean }> {
  const isSuperAdmin = specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS);
  if (isSuperAdmin) return { isMember: true, canManage: true };

  const membership = await db.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { teamRole: true },
  });

  // Any team member can manage board settings (swimlane config).
  return {
    isMember: !!membership,
    canManage: !!membership,
  };
}

const SWIMLANE_VALUES = ["NONE", "ASSIGNEE", "TYPE", "PRIORITY", "PROJECT"] as const;

const patchSwimlaneSchema = z.object({
  swimlaneBy: z.enum(SWIMLANE_VALUES),
});

/** GET /api/teams/[id]/swimlane-config — get swimlane config for the team (any member). */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: teamId } = await ctx.params;

  const { isMember } = await resolveAccess(session.user.id, session.user.specialPermissions, teamId);
  if (!isMember) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = await db.teamSwimlaneConfig.findUnique({
    where: { teamId },
    select: { id: true, teamId: true, swimlaneBy: true },
  });

  return NextResponse.json({
    swimlaneConfig: config ?? { id: null, teamId, swimlaneBy: "NONE" },
  });
}

/** PATCH /api/teams/[id]/swimlane-config — update swimlane grouping (ADMIN only). */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: teamId } = await ctx.params;

  const { canManage } = await resolveAccess(session.user.id, session.user.specialPermissions, teamId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSwimlaneSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const updated = await db.teamSwimlaneConfig.upsert({
    where: { teamId },
    create: { teamId, swimlaneBy: parsed.data.swimlaneBy },
    update: { swimlaneBy: parsed.data.swimlaneBy },
    select: { id: true, teamId: true, swimlaneBy: true },
  });

  return NextResponse.json({ swimlaneConfig: updated });
}
