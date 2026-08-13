import "server-only";
import { db } from "@/lib/db";
import { isSprintRowActiveOnDate } from "@/lib/sprint-active";

/** Sprint row with enough data to test whether a ticket “belongs to” that sprint’s board. */
export interface SprintScopeForActiveRule {
  id: string;
  startDate: Date | null;
  endDate: Date | null;
  completedAt?: Date | null;
  _count: { sprintTickets: number };
  projects: { projectId: string }[];
  sprintTickets: { ticketId: string }[];
}

/**
 * True if this ticket is shown on that sprint’s board: explicit `sprint_tickets` match, or
 * (legacy) sprint has an empty explicit set and the ticket’s project is linked to the sprint.
 */
export function ticketInActiveSprintBoardScope(
  ticket: { id: string; projectId: string | null },
  sprint: SprintScopeForActiveRule
): boolean {
  if (sprint._count.sprintTickets > 0) {
    return sprint.sprintTickets.some((r) => r.ticketId === ticket.id);
  }
  if (!ticket.projectId) return false;
  return sprint.projects.some((p) => p.projectId === ticket.projectId);
}

export async function loadOtherActiveSprintsForScope(
  excludeSprintId: string,
  now: Date = new Date()
): Promise<SprintScopeForActiveRule[]> {
  const rows = await db.sprint.findMany({
    where: { id: { not: excludeSprintId } },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      completedAt: true,
      _count: { select: { sprintTickets: true } },
      projects: { select: { projectId: true } },
      sprintTickets: { select: { ticketId: true } },
    },
  });
  return rows.filter((r) => isSprintRowActiveOnDate(r, now));
}

/** Tickets already “in” another active sprint (cannot be added to this one). */
export function ticketIdsBlockedByOtherActiveSprints(
  tickets: { id: string; projectId: string | null }[],
  otherActive: SprintScopeForActiveRule[]
): Set<string> {
  const blocked = new Set<string>();
  for (const t of tickets) {
    for (const T of otherActive) {
      if (ticketInActiveSprintBoardScope(t, T)) {
        blocked.add(t.id);
        break;
      }
    }
  }
  return blocked;
}

/**
 * For a *new* ticket: only an **implicit** other active sprint that includes `projectId` blocks linking.
 * Explicit other sprints don’t list the new id yet.
 */
export function newTicketProjectBlockedByOtherActiveImplicitSprint(
  projectId: string,
  otherActive: SprintScopeForActiveRule[]
): SprintScopeForActiveRule | null {
  for (const T of otherActive) {
    if (T._count.sprintTickets > 0) continue;
    if (T.projects.some((p) => p.projectId === projectId)) {
      return T;
    }
  }
  return null;
}
