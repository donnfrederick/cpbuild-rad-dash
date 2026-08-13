/**
 * `Ticket.ticketScopeKey` for tickets with `projectId === null`.
 * Chosen to never collide with a cuid.
 */
export const UNASSIGNED_TICKET_SCOPE = "__unassigned__" as const;

export const UNASSIGNED_DISPLAY_PREFIX = "UN" as const;
