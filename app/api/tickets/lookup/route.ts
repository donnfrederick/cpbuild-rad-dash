import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { userCanViewTicket } from "@/lib/ticket-access";
import { parseDisplayTicketRef } from "@/components/tickets/ticket-utils";
import { buildRefFromTicketRow } from "@/lib/ticket-ref-resolve";
import { UNASSIGNED_TICKET_SCOPE } from "@/lib/ticket-scopes";

/**
 * GET /api/tickets/lookup?ref=UN-0001|ENG-0001|RAD-0001
 * or GET /api/tickets/lookup?shortId=42 (legacy global shortId)
 */
export async function GET(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const refParam = req.nextUrl.searchParams.get("ref")?.trim() ?? "";
  if (refParam) {
    const parsed = parseDisplayTicketRef(refParam);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid ref" }, { status: 400 });
    }

    const refSelect = {
      id: true,
      shortId: true,
      title: true,
      userId: true,
      ticketScopeKey: true,
      ticketKeyNumber: true,
      project: { select: { ticketKeyPrefix: true } },
    } as const;

    let ticket: {
      id: string;
      shortId: number;
      title: string;
      userId: string;
      ticketScopeKey: string;
      ticketKeyNumber: number;
      project: { ticketKeyPrefix: string } | null;
    } | null = null;

    if (parsed.kind === "legacyRad") {
      ticket = await db.ticket.findUnique({
        where: { shortId: parsed.shortId },
        select: refSelect,
      });
    } else if (parsed.kind === "un") {
      ticket = await db.ticket.findFirst({
        where: {
          ticketScopeKey: UNASSIGNED_TICKET_SCOPE,
          ticketKeyNumber: parsed.keyNumber,
        },
        select: refSelect,
      });
    } else {
      const proj = await db.project.findUnique({
        where: { ticketKeyPrefix: parsed.prefix },
        select: { id: true },
      });
      if (!proj) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      ticket = await db.ticket.findFirst({
        where: {
          ticketScopeKey: proj.id,
          ticketKeyNumber: parsed.keyNumber,
        },
        select: refSelect,
      });
    }

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

    return NextResponse.json({
      id: ticket.id,
      ref: buildRefFromTicketRow(ticket),
      shortId: ticket.shortId,
      title: ticket.title,
    });
  }

  const raw = req.nextUrl.searchParams.get("shortId");
  if (raw === null || raw === "") {
    return NextResponse.json({ error: "shortId or ref is required" }, { status: 400 });
  }

  const shortId = Number.parseInt(raw, 10);
  if (!Number.isFinite(shortId) || shortId < 1) {
    return NextResponse.json({ error: "Invalid shortId" }, { status: 400 });
  }

  const byShort = await db.ticket.findUnique({
    where: { shortId },
    select: {
      id: true,
      shortId: true,
      title: true,
      userId: true,
      ticketScopeKey: true,
      ticketKeyNumber: true,
      project: { select: { ticketKeyPrefix: true } },
    },
  });

  if (!byShort) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allowed = await userCanViewTicket({
    viewerId: ctx.user.id,
    role: ctx.user.role,
    ticket: { id: byShort.id, userId: byShort.userId },
    specialPermissions: ctx.user.specialPermissions,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: byShort.id,
    ref: buildRefFromTicketRow(byShort),
    shortId: byShort.shortId,
    title: byShort.title,
  });
}
