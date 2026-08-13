export const SPRINT_CREATE_DRAFT_STORAGE_KEY = "rad-dash.sprintCreateDraft.v1";

export type SprintCreateWizardStep = "details" | "tickets" | "summary";

export interface SprintCreateDraftV1 {
  v: 1;
  step: SprintCreateWizardStep;
  name: string;
  startDate: string;
  endDate: string;
  maxManSprints: string;
  daysOff: string;
  carryOverPoints: string;
  pointsPlanned: string;
  goals: string;
  selectedProjectIds: string[];
  selectedTicketIds: string[];
  savedAt: number;
}

export function parseSprintCreateDraft(raw: string | null): SprintCreateDraftV1 | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const rec = o as Record<string, unknown>;
    if (rec.v !== 1) return null;
    if (rec.step !== "details" && rec.step !== "tickets" && rec.step !== "summary") return null;
    return {
      v: 1,
      step: rec.step,
      name: typeof rec.name === "string" ? rec.name : "",
      startDate: typeof rec.startDate === "string" ? rec.startDate : "",
      endDate: typeof rec.endDate === "string" ? rec.endDate : "",
      maxManSprints: typeof rec.maxManSprints === "string" ? rec.maxManSprints : "",
      daysOff: typeof rec.daysOff === "string" ? rec.daysOff : "",
      carryOverPoints: typeof rec.carryOverPoints === "string" ? rec.carryOverPoints : "",
      pointsPlanned: typeof rec.pointsPlanned === "string" ? rec.pointsPlanned : "",
      goals: typeof rec.goals === "string" ? rec.goals : "",
      selectedProjectIds: Array.isArray(rec.selectedProjectIds)
        ? rec.selectedProjectIds.filter((x): x is string => typeof x === "string")
        : [],
      selectedTicketIds: Array.isArray(rec.selectedTicketIds)
        ? rec.selectedTicketIds.filter((x): x is string => typeof x === "string")
        : [],
      savedAt: typeof rec.savedAt === "number" ? rec.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function readSprintCreateDraft(): SprintCreateDraftV1 | null {
  if (typeof window === "undefined") return null;
  try {
    return parseSprintCreateDraft(window.localStorage.getItem(SPRINT_CREATE_DRAFT_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeSprintCreateDraft(draft: SprintCreateDraftV1): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SPRINT_CREATE_DRAFT_STORAGE_KEY,
      JSON.stringify({ ...draft, savedAt: Date.now() })
    );
  } catch {
    /* quota or private mode */
  }
}

export function clearSprintCreateDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SPRINT_CREATE_DRAFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
