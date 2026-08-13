import { db } from "@/lib/db";
import { isSprintRowActiveOnDate } from "@/lib/sprint-active";
import {
  ticketMatchesSprintBoardScope,
  type SprintScopeRow,
} from "@/lib/sprint-ticket-where";

/** Active sprint rows with full scope (explicit ticket ids + linked projects). */
export type ActiveSprintScopeRow = SprintScopeRow & { id: string; name: string };

export async function loadActiveSprintScopesForList(
  now: Date = new Date()
): Promise<ActiveSprintScopeRow[]> {
  const rows = await db.sprint.findMany({
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      completedAt: true,
      projects: { select: { projectId: true } },
      sprintTickets: { select: { ticketId: true } },
    },
  });

  return rows
    .filter((r) =>
      isSprintRowActiveOnDate(
        { startDate: r.startDate, endDate: r.endDate, completedAt: r.completedAt },
        now
      )
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      projects: r.projects,
      sprintTickets: r.sprintTickets,
    }));
}

/**
 * Builds `TicketRow.sprints` so GET /api/tickets matches sprint boards: each active sprint the
 * ticket belongs to (explicit `sprint_tickets` or implicit linked-project scope).
 */
export function computeTicketSprintsForBoardAlignment(
  ticket: { id: string; projectId: string | null },
  explicitFromJoin: ReadonlyArray<{ id: string; name: string }>,
  activeSprintScopes: ReadonlyArray<ActiveSprintScopeRow>
): { id: string; name: string }[] {
  const seen = new Set(explicitFromJoin.map((s) => s.id));
  const out: { id: string; name: string }[] = [...explicitFromJoin];

  for (const sp of activeSprintScopes) {
    if (seen.has(sp.id)) continue;
    const scope: SprintScopeRow = {
      projects: sp.projects,
      sprintTickets: sp.sprintTickets,
    };
    if (ticketMatchesSprintBoardScope(ticket, scope)) {
      out.push({ id: sp.id, name: sp.name });
      seen.add(sp.id);
    }
  }

  return out;
}
