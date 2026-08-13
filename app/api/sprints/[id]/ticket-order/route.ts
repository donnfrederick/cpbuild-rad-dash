import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { resolveAccessibleTeamIds } from "@/lib/team-context";
import { hasTicketTriageAccess } from "@/lib/ticket-access";
import { ticketWhereForSprintScope } from "@/lib/sprint-ticket-where";

const patchTicketOrderSchema = z.object({
  statusKey: z.string().min(1).max(100),
  orderedTicketIds: z.array(z.string().min(1)).max(500),
});

/** Returns persisted manual card order for all columns on this sprint board. */
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
    select: { id: true, teamId: true },
  });
  if (!sprint) {
    return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
  }
  const teamIds = await resolveAccessibleTeamIds(session.user.id, session.user.specialPermissions);
  if (!teamIds.includes(sprint.teamId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db.sprintBoardTicketOrder.findMany({
    where: { sprintId },
    orderBy: [{ statusKey: "asc" }, { position: "asc" }],
    select: { statusKey: true, ticketId: true, position: true },
  });

  return NextResponse.json({ orders: rows });
}

/** Replaces the full ordered ticket list for one column on this sprint board. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasTicketTriageAccess(session.user.role, session.user.specialPermissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: sprintId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchTicketOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const { statusKey, orderedTicketIds } = parsed.data;
  const uniqueIds = [...new Set(orderedTicketIds)];

  const sprint = await db.sprint.findUnique({
    where: { id: sprintId },
    select: {
      id: true,
      teamId: true,
      completedAt: true,
      projects: { select: { projectId: true } },
      sprintTickets: { select: { ticketId: true } },
    },
  });
  if (!sprint) {
    return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
  }
  const teamIds = await resolveAccessibleTeamIds(session.user.id, session.user.specialPermissions);
  if (!teamIds.includes(sprint.teamId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (sprint.completedAt) {
    return NextResponse.json({ error: "Cannot reorder tickets on a completed sprint" }, { status: 400 });
  }

  if (uniqueIds.length > 0) {
    const found = await db.ticket.count({
      where: {
        AND: [
          ticketWhereForSprintScope(sprint),
          { id: { in: uniqueIds } },
          { status: statusKey },
        ],
      },
    });
    if (found !== uniqueIds.length) {
      return NextResponse.json(
        { error: "One or more tickets are not visible in this sprint column" },
        { status: 400 }
      );
    }
  }

  await db.$transaction([
    db.sprintBoardTicketOrder.deleteMany({ where: { sprintId, statusKey } }),
    ...(uniqueIds.length > 0
      ? [
          db.sprintBoardTicketOrder.createMany({
            data: uniqueIds.map((ticketId, position) => ({
              sprintId,
              statusKey,
              ticketId,
              position,
            })),
          }),
        ]
      : []),
  ]);

  return NextResponse.json({ ok: true });
}
