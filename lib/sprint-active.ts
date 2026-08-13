import type { SprintApiPayload } from "@/lib/sprint-map";

/** Parse leading `YYYY-MM-DD` as a local calendar date (midnight local). */
function dateOnlyLocalMs(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const t = new Date(y, mo, d).getTime();
  return Number.isNaN(t) ? null : t;
}

function localTodayStartMs(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function sprintPayloadMinimal(
  row: { startDate: Date | null; endDate: Date | null; completedAt?: Date | null }
): SprintApiPayload {
  return {
    id: "",
    name: "",
    startDate: row.startDate ? row.startDate.toISOString() : null,
    endDate: row.endDate ? row.endDate.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    velocity: null,
    maxManSprints: null,
    daysOff: 0,
    carryOverPoints: null,
    pointsPlanned: null,
    goals: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    projects: [],
    usesExplicitTicketList: false,
  };
}

/**
 * True when `now` falls inside the sprint’s start/end window (local calendar dates).
 * Only start: active when today ≥ start. Only end: active when today ≤ end.
 * No dates → not active (use inline create form on the sprints page).
 */
/** Prisma/DB row — “board active”: not completed and (in window or overdue). */
export function isSprintRowActiveOnDate(
  row: { startDate: Date | null; endDate: Date | null; completedAt?: Date | null },
  now: Date = new Date()
): boolean {
  return isSprintRowRunningOnDate(row, now);
}

export function isSprintRowRunningOnDate(
  row: { startDate: Date | null; endDate: Date | null; completedAt?: Date | null },
  now: Date = new Date()
): boolean {
  return isSprintRunning(sprintPayloadMinimal(row), now);
}

export function isSprintActiveOnDate(s: SprintApiPayload, now: Date = new Date()): boolean {
  const today = localTodayStartMs(now);
  const startMs = s.startDate ? dateOnlyLocalMs(s.startDate) : null;
  const endMs = s.endDate ? dateOnlyLocalMs(s.endDate) : null;
  if (startMs != null && endMs != null) {
    if (endMs < startMs) return false;
    return today >= startMs && today <= endMs;
  }
  if (startMs != null) return today >= startMs;
  if (endMs != null) return today <= endMs;
  return false;
}

/** Past planned end date, not formally completed (requires `endDate`). */
export function isSprintOverdue(s: SprintApiPayload, now: Date = new Date()): boolean {
  if (s.completedAt) return false;
  if (!s.endDate) return false;
  const endMs = dateOnlyLocalMs(s.endDate);
  if (endMs == null) return false;
  return localTodayStartMs(now) > endMs;
}

/** Sprint board is still live: not completed, and today is in the window or past end (overdue). */
export function isSprintRunning(s: SprintApiPayload, now: Date = new Date()): boolean {
  if (s.completedAt) return false;
  return isSprintActiveOnDate(s, now) || isSprintOverdue(s, now);
}

/** Not completed, not running, and not overdue — undated or future start date (shown as Draft). */
export function isSprintDraft(s: SprintApiPayload, now: Date = new Date()): boolean {
  if (s.completedAt) return false;
  return !isSprintRunning(s, now) && !isSprintOverdue(s, now);
}
