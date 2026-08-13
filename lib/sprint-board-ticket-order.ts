/** Minimal ticket fields needed to apply sprint board manual card order. */
export interface SprintBoardOrderableTicket {
  id: string;
  createdAt: string;
}

/**
 * Sorts tickets by persisted manual order for a board column.
 * Tickets missing from `order` are placed last (newest `createdAt` first among them).
 */
export function applyCardOrder<T extends SprintBoardOrderableTicket>(
  tickets: T[],
  order: string[] | undefined
): T[] {
  if (!order || order.length === 0) return tickets;
  const posMap = new Map(order.map((id, i) => [id, i]));
  return [...tickets].sort((a, b) => {
    const pa = posMap.get(a.id) ?? Number.POSITIVE_INFINITY;
    const pb = posMap.get(b.id) ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/** Merges persisted column order with the current ticket id list (append any new tickets). */
export function mergeColumnTicketIds(sortedTicketIds: string[], persistedOrder: string[] | undefined): string[] {
  const merged = [...(persistedOrder ?? sortedTicketIds)];
  for (const id of sortedTicketIds) {
    if (!merged.includes(id)) merged.push(id);
  }
  return merged;
}

/** Reorders ticket rows to match a column id list (drops missing ids). */
export function orderTicketsByIds<T extends { id: string }>(tickets: T[], ids: string[]): T[] {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  return ids.map((id) => byId.get(id)).filter((ticket): ticket is T => ticket !== undefined);
}
