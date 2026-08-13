import "server-only";
import { db } from "@/lib/db";
import { parseDisplayTicketRef } from "@/components/tickets/ticket-utils";
import { buildTicketRefFromParts } from "@/lib/ticket-display-ref";
import { UNASSIGNED_TICKET_SCOPE } from "@/lib/ticket-scopes";

/**
 * Resolves a user-supplied ref (e.g. ENG-0042, UN-0001, legacy RAD-0042) or the ticket's
 * primary key (cuid) to a ticket id, or null if not found.
 */
export async function findTicketIdByRefString(ref: string): Promise<string | null> {
  const trimmed = ref.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = parseDisplayTicketRef(trimmed);
  if (!parsed) {
    const byId = await db.ticket.findUnique({ where: { id: trimmed }, select: { id: true } });
    return byId?.id ?? null;
  }

  if (parsed.kind === "legacyRad") {
    const row = await db.ticket.findUnique({
      where: { shortId: parsed.shortId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  if (parsed.kind === "un") {
    const row = await db.ticket.findFirst({
      where: {
        ticketScopeKey: UNASSIGNED_TICKET_SCOPE,
        ticketKeyNumber: parsed.keyNumber,
      },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  const project = await db.project.findUnique({
    where: { ticketKeyPrefix: parsed.prefix },
    select: { id: true },
  });
  if (!project) {
    return null;
  }

  const row = await db.ticket.findFirst({
    where: {
      ticketScopeKey: project.id,
      ticketKeyNumber: parsed.keyNumber,
    },
    select: { id: true },
  });
  return row?.id ?? null;
}

const ticketRefSelect = {
  id: true,
  ticketScopeKey: true,
  ticketKeyNumber: true,
  project: { select: { ticketKeyPrefix: true } },
} as const;

type TicketRefRow = {
  id: string;
  ticketScopeKey: string;
  ticketKeyNumber: number;
  project: { ticketKeyPrefix: string } | null;
};

/**
 * Public display refs for a set of ticket ids (e.g. agent tool payloads).
 */
export async function loadTicketDisplayRefsByIds(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await db.ticket.findMany({
    where: { id: { in: ids } },
    select: ticketRefSelect,
  });
  const m = new Map<string, string>();
  for (const t of rows) {
    m.set(t.id, buildRefFromTicketRow(t));
  }
  return m;
}

export function buildRefFromTicketRow(
  t: Pick<TicketRefRow, "ticketScopeKey" | "ticketKeyNumber" | "project">
): string {
  return buildTicketRefFromParts(t.ticketScopeKey, t.ticketKeyNumber, t.project?.ticketKeyPrefix);
}
