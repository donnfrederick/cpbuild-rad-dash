import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { userCanViewTicket } from "@/lib/ticket-access";
import { revalidateTicketsList } from "@/lib/list-cache";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; prId: string }> }
) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: ticketId, prId } = await params;

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, userId: true },
  });
  if (!ticket) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allowed = await userCanViewTicket({
    viewerId: ctx.user.id,
    role: ctx.user.role,
    ticket: { id: ticket.id, userId: ticket.userId },
    specialPermissions: ctx.user.specialPermissions,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const deleted = await db.ticketLinkedPR.deleteMany({
    where: { id: prId, ticketId },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  revalidateTicketsList();

  return NextResponse.json({ ok: true });
}
