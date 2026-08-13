import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { revalidateTicketsList } from "@/lib/list-cache";
import { getSessionContext } from "@/lib/session-context";
import { hasTicketTriageAccess } from "@/lib/ticket-access";
import {
  loadOtherActiveSprintsForScope,
  ticketIdsBlockedByOtherActiveSprints,
} from "@/lib/sprint-other-active-scope";

const addSprintTicketsSchema = z.object({
  ticketIds: z.array(z.string().min(1)).min(1).max(200),
});

const removeSprintTicketsSchema = z.object({
  ticketIds: z.array(z.string().min(1)).min(1).max(200),
});

/**
 * Add existing tickets to a sprint's explicit set (`sprint_tickets`).
 * Tickets may belong to any project or none — project membership is not required.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const parsed = addSprintTicketsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const ticketIdsUnique = [...new Set(parsed.data.ticketIds)];

  const sprint = await db.sprint.findUnique({
    where: { id: sprintId },
    select: { id: true, completedAt: true },
  });
  if (!sprint) {
    return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
  }
  if (sprint.completedAt) {
    return NextResponse.json({ error: "Cannot add tickets to a completed sprint" }, { status: 400 });
  }

  const rows = await db.ticket.findMany({
    where: { id: { in: ticketIdsUnique } },
    select: { id: true, projectId: true },
  });
  if (rows.length !== ticketIdsUnique.length) {
    return NextResponse.json({ error: "One or more tickets were not found" }, { status: 400 });
  }

  const otherActive = await loadOtherActiveSprintsForScope(sprintId);
  const blocked = ticketIdsBlockedByOtherActiveSprints(rows, otherActive);
  if (blocked.size > 0) {
    return NextResponse.json(
      {
        error:
          "One or more tickets are already part of another active sprint. Remove them from the other sprint or wait until that sprint is no longer active before adding them here.",
      },
      { status: 400 }
    );
  }

  const result = await db.sprintTicket.createMany({
    data: rows.map((t) => ({ sprintId, ticketId: t.id })),
    skipDuplicates: true,
  });

  revalidateTicketsList();
  return NextResponse.json({ ok: true, added: result.count });
}

/**
 * Remove tickets from a sprint's explicit set (`sprint_tickets`).
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const parsed = removeSprintTicketsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const ticketIdsUnique = [...new Set(parsed.data.ticketIds)];

  const sprint = await db.sprint.findUnique({
    where: { id: sprintId },
    select: { id: true, completedAt: true },
  });
  if (!sprint) {
    return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
  }
  if (sprint.completedAt) {
    return NextResponse.json({ error: "Cannot change tickets on a completed sprint" }, { status: 400 });
  }

  const result = await db.sprintTicket.deleteMany({
    where: { sprintId, ticketId: { in: ticketIdsUnique } },
  });

  revalidateTicketsList();
  return NextResponse.json({ ok: true, removed: result.count });
}
