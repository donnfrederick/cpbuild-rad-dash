import type { Prisma } from "@prisma/client";

/** Shapes from `sprint` rows used for list/overview ticket scope. */
export interface SprintScopeRow {
  projects: Array<{ projectId: string }>;
  sprintTickets: Array<{ ticketId: string }>;
}

/**
 * Ticket `where` clause for a sprint board.
 *
 * Priority order:
 * 1. If `sprintTickets` rows exist → show exactly those tickets (project-independent).
 * 2. Else if linked projects exist → show all tickets from those projects (legacy implicit mode).
 * 3. Otherwise → empty result (no tickets).
 *
 * Matches the `sprintIdParam` branch in `tickets-list-loader`.
 */
export function ticketWhereForSprintScope(
  sprint: SprintScopeRow | null
): Prisma.TicketWhereInput {
  if (!sprint) {
    return { AND: [{ projectId: { equals: null } }, { NOT: { projectId: { equals: null } } }] };
  }
  const explicitTicketIds = sprint.sprintTickets.map((row) => row.ticketId);
  if (explicitTicketIds.length > 0) {
    return { id: { in: explicitTicketIds } };
  }
  const ids = sprint.projects.map((row) => row.projectId);
  if (ids.length > 0) {
    return { projectId: { in: ids } };
  }
  return { AND: [{ projectId: { equals: null } }, { NOT: { projectId: { equals: null } } }] };
}

export interface SprintScopeTicketRow {
  id: string;
  projectId: string | null;
}

/** True iff this ticket would appear on the sprint board (same rules as {@link ticketWhereForSprintScope}). */
export function ticketMatchesSprintBoardScope(
  ticket: SprintScopeTicketRow,
  sprint: SprintScopeRow | null
): boolean {
  if (!sprint) return false;
  const explicitTicketIds = sprint.sprintTickets.map((row) => row.ticketId);
  if (explicitTicketIds.length > 0) {
    return explicitTicketIds.includes(ticket.id);
  }
  const ids = sprint.projects.map((row) => row.projectId);
  if (ids.length === 0) return false;
  return ticket.projectId != null && ids.includes(ticket.projectId);
}
