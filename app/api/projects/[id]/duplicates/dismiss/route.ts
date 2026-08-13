import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { hasTicketTriageAccess } from "@/lib/ticket-access";
import { revalidateTicketsList } from "@/lib/list-cache";

const dismissSchema = z.object({
  ticketAId: z.string().min(1),
  ticketBId: z.string().min(1),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasTicketTriageAccess(ctx.user.role, ctx.user.specialPermissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: projectId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = dismissSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const { ticketAId, ticketBId } = parsed.data;
  if (ticketAId === ticketBId) {
    return NextResponse.json({ error: "A ticket cannot be dismissed against itself" }, { status: 400 });
  }

  // Verify both tickets exist and belong to the same project as the route.
  const tickets = await db.ticket.findMany({
    where: { id: { in: [ticketAId, ticketBId] } },
    select: { id: true, projectId: true },
  });
  if (tickets.length !== 2) {
    return NextResponse.json({ error: "One or both tickets not found" }, { status: 404 });
  }
  if (tickets.some((t) => t.projectId !== projectId)) {
    return NextResponse.json(
      { error: "Both tickets must belong to this project" },
      { status: 400 }
    );
  }

  // Always store the pair sorted so a single row covers both directions.
  const [a, b] = ticketAId < ticketBId ? [ticketAId, ticketBId] : [ticketBId, ticketAId];

  const dismissal = await db.ticketDuplicateDismissal.upsert({
    where: { ticketAId_ticketBId: { ticketAId: a, ticketBId: b } },
    create: {
      ticketAId: a,
      ticketBId: b,
      dismissedById: ctx.user.id,
    },
    update: {},
    select: { id: true, ticketAId: true, ticketBId: true, createdAt: true },
  });

  revalidateTicketsList();
  return NextResponse.json(
    {
      ...dismissal,
      createdAt: dismissal.createdAt.toISOString(),
    },
    { status: 201 }
  );
}
