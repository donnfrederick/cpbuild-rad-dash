import { UNASSIGNED_DISPLAY_PREFIX, UNASSIGNED_TICKET_SCOPE } from "@/lib/ticket-scopes";

const PAD = 4;

function pad(n: number): string {
  return n.toString().padStart(PAD, "0");
}

/** Public ticket ref: PREFIX-0001 or UN-0001. */
export function buildTicketRefFromParts(
  ticketScopeKey: string,
  ticketKeyNumber: number,
  projectPrefix: string | null | undefined
): string {
  if (ticketScopeKey === UNASSIGNED_TICKET_SCOPE) {
    return `${UNASSIGNED_DISPLAY_PREFIX}-${pad(ticketKeyNumber)}`;
  }
  const prefix = (projectPrefix ?? "?").toUpperCase();
  return `${prefix}-${pad(ticketKeyNumber)}`;
}

/** @deprecated — prefer `ref` on API row or `buildTicketRefFromParts` */
export function buildLegacyRadRef(shortId: number): string {
  return `RAD-${pad(shortId)}`;
}
