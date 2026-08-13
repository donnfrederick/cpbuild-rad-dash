import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { PERMISSIONS } from "@/lib/permissions-core";

type RouteContext = { params: Promise<{ id: string; statusId: string }> };

async function resolveAccess(
  userId: string,
  specialPermissions: string[],
  teamId: string
): Promise<{ canManage: boolean }> {
  const isSuperAdmin = specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS);
  if (isSuperAdmin) return { canManage: true };

  const membership = await db.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { teamRole: true },
  });

  // Any team member can manage board settings.
  return { canManage: !!membership };
}

const patchBoardStatusSchema = z.object({
  label: z.string().min(1).max(60).trim().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex string like #6366f1").optional().nullable(),
  isEnabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** PATCH /api/teams/[id]/board-statuses/[statusId] — update label, color, isEnabled, or sortOrder (ADMIN only). */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: teamId, statusId } = await ctx.params;

  const { canManage } = await resolveAccess(session.user.id, session.user.specialPermissions, teamId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const boardStatus = await db.teamBoardStatus.findUnique({
    where: { id: statusId },
    select: { id: true, teamId: true },
  });
  if (!boardStatus || boardStatus.teamId !== teamId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchBoardStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const updated = await db.teamBoardStatus.update({
    where: { id: statusId },
    data: {
      ...(parsed.data.label !== undefined && { label: parsed.data.label }),
      ...(parsed.data.color !== undefined && { color: parsed.data.color }),
      ...(parsed.data.isEnabled !== undefined && { isEnabled: parsed.data.isEnabled }),
      ...(parsed.data.sortOrder !== undefined && { sortOrder: parsed.data.sortOrder }),
    },
    select: {
      id: true,
      key: true,
      label: true,
      color: true,
      isBuiltIn: true,
      isEnabled: true,
      sortOrder: true,
    },
  });

  return NextResponse.json({ boardStatus: updated });
}

/** DELETE /api/teams/[id]/board-statuses/[statusId] — delete a custom status (ADMIN only, no existing tickets). */
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: teamId, statusId } = await ctx.params;

  const { canManage } = await resolveAccess(session.user.id, session.user.specialPermissions, teamId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const boardStatus = await db.teamBoardStatus.findUnique({
    where: { id: statusId },
    select: { id: true, teamId: true, key: true, isBuiltIn: true },
  });
  if (!boardStatus || boardStatus.teamId !== teamId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (boardStatus.isBuiltIn) {
    return NextResponse.json({ error: "Built-in statuses cannot be deleted." }, { status: 409 });
  }

  const ticketCount = await db.ticket.count({
    where: {
      status: boardStatus.key,
      OR: [
        { project: { teamId } },
        { projectId: null, sprintTickets: { some: { sprint: { teamId } } } },
      ],
    },
  });
  if (ticketCount > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete: ${ticketCount} ticket(s) currently use this status. Move them to another status first.`,
      },
      { status: 409 }
    );
  }

  await db.teamBoardStatus.delete({ where: { id: statusId } });

  return NextResponse.json({ ok: true });
}
