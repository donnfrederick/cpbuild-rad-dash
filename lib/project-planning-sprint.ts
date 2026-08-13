import type { SprintApiPayload } from "@/lib/sprint-map";
import { isSprintRunning } from "@/lib/sprint-active";

/** Active sprint chosen for project `/projects/:id/tickets` planning split (two lists). */
export interface PlanningSprintPick {
  id: string;
  name: string;
  /** Mirrors `/api/sprints`: sprint uses explicit `sprint_tickets` rows (vs implicit project scope). */
  usesExplicitTicketList: boolean;
}

export function sprintApiToPlanningPick(s: SprintApiPayload): PlanningSprintPick {
  return {
    id: s.id,
    name: s.name,
    usesExplicitTicketList: s.usesExplicitTicketList === true,
  };
}

/**
 * Picks the active sprint that includes `projectId` for project-level sprint planning (list split).
 * When several match, prefers the sprint with the latest `startDate`.
 */
export function pickPlanningSprintForProject(
  sprints: SprintApiPayload[],
  projectId: string
): PlanningSprintPick | null {
  const candidates = sprints.filter(
    (s) => isSprintRunning(s) && s.projects.some((p) => p.id === projectId)
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aStart = a.startDate ? Date.parse(a.startDate) : 0;
    const bStart = b.startDate ? Date.parse(b.startDate) : 0;
    return bStart - aStart;
  });
  const pick = candidates[0];
  return pick ? sprintApiToPlanningPick(pick) : null;
}

/**
 * General `/tickets` view: when no single sprint or project is selected, use the latest-starting
 * active sprint so sprint/backlog columns still have a defined sprint id.
 */
export function pickLatestActivePlanningSprint(sprints: SprintApiPayload[]): PlanningSprintPick | null {
  const candidates = sprints.filter((s) => isSprintRunning(s));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aStart = a.startDate ? Date.parse(a.startDate) : 0;
    const bStart = b.startDate ? Date.parse(b.startDate) : 0;
    return bStart - aStart;
  });
  const pick = candidates[0];
  return sprintApiToPlanningPick(pick);
}

/**
 * Ticket is **included in this sprint** for planning UI. Uses `row.sprints` from GET /api/tickets,
 * which is enriched to match the sprint board (explicit links + implicit linked-project scope).
 */
export function ticketInPlanningSprint(
  row: { sprints?: { id: string }[] },
  pick: PlanningSprintPick
): boolean {
  return row.sprints?.some((s) => s.id === pick.id) ?? false;
}
