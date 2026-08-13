import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { PERMISSIONS } from "@/lib/permissions-core";

type RouteContext = { params: Promise<{ id: string; typeId: string }> };

async function resolveAccess(
  userId: string,
  specialPermissions: string[],
  teamId: string
): Promise<boolean> {
  if (specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS)) return true;
  const membership = await db.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { teamRole: true },
  });
  return membership?.teamRole === "ADMIN";
}

const patchTicketTypeSchema = z.object({
  name: z.string().min(1).max(60).trim().optional(),
  isEnabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** PATCH /api/teams/[id]/ticket-types/[typeId] — rename, toggle enabled, reorder */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: teamId, typeId } = await ctx.params;

  const canManage = await resolveAccess(session.user.id, session.user.specialPermissions, teamId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ticketType = await db.teamTicketType.findUnique({
    where: { id: typeId },
    select: { id: true, teamId: true, isBuiltIn: true },
  });

  if (!ticketType || ticketType.teamId !== teamId) {
    return NextResponse.json({ error: "Ticket type not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchTicketTypeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const updated = await db.teamTicketType.update({
    where: { id: typeId },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.isEnabled !== undefined && { isEnabled: parsed.data.isEnabled }),
      ...(parsed.data.sortOrder !== undefined && { sortOrder: parsed.data.sortOrder }),
    },
    select: {
      id: true,
      name: true,
      key: true,
      isBuiltIn: true,
      isEnabled: true,
      sortOrder: true,
    },
  });

  return NextResponse.json({ ticketType: updated });
}

/** DELETE /api/teams/[id]/ticket-types/[typeId] — delete a custom type (built-ins cannot be deleted) */
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: teamId, typeId } = await ctx.params;

  const canManage = await resolveAccess(session.user.id, session.user.specialPermissions, teamId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ticketType = await db.teamTicketType.findUnique({
    where: { id: typeId },
    select: { id: true, teamId: true, isBuiltIn: true },
  });

  if (!ticketType || ticketType.teamId !== teamId) {
    return NextResponse.json({ error: "Ticket type not found" }, { status: 404 });
  }

  if (ticketType.isBuiltIn) {
    return NextResponse.json(
      { error: "Built-in ticket types cannot be deleted. You can disable them instead." },
      { status: 422 }
    );
  }

  await db.teamTicketType.delete({ where: { id: typeId } });
  return new NextResponse(null, { status: 204 });
}
