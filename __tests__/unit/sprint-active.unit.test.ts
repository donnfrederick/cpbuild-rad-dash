import { describe, expect, it } from "vitest";
import { isSprintDraft, isSprintOverdue, isSprintRunning } from "@/lib/sprint-active";
import type { SprintApiPayload } from "@/lib/sprint-map";

function sprint(over: Partial<SprintApiPayload> = {}): SprintApiPayload {
  const base: SprintApiPayload = {
    id: "s1",
    name: "S",
    startDate: null,
    endDate: null,
    completedAt: null,
    velocity: null,
    maxManSprints: null,
    daysOff: 0,
    carryOverPoints: null,
    pointsPlanned: null,
    goals: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    projects: [],
    usesExplicitTicketList: false,
  };
  return { ...base, ...over };
}

describe("isSprintDraft", () => {
  const noonMay2026 = new Date("2026-05-15T12:00:00.000Z");

  it("is true when sprint has no dates and is not completed", () => {
    expect(isSprintDraft(sprint({ startDate: null, endDate: null, completedAt: null }), noonMay2026)).toBe(true);
  });

  it("is true when start date is in the future", () => {
    expect(
      isSprintDraft(
        sprint({
          startDate: "2026-06-01T00:00:00.000Z",
          endDate: "2026-06-30T00:00:00.000Z",
          completedAt: null,
        }),
        noonMay2026
      )
    ).toBe(true);
  });

  it("is false when sprint is running (today in window)", () => {
    const row = sprint({
      startDate: "2026-05-01T00:00:00.000Z",
      endDate: "2026-05-31T00:00:00.000Z",
      completedAt: null,
    });
    expect(isSprintRunning(row, noonMay2026)).toBe(true);
    expect(isSprintDraft(row, noonMay2026)).toBe(false);
  });

  it("is false when sprint is overdue", () => {
    const row = sprint({
      startDate: "2026-04-01T00:00:00.000Z",
      endDate: "2026-05-01T00:00:00.000Z",
      completedAt: null,
    });
    expect(isSprintOverdue(row, noonMay2026)).toBe(true);
    expect(isSprintDraft(row, noonMay2026)).toBe(false);
  });

  it("is false when sprint is completed", () => {
    expect(
      isSprintDraft(
        sprint({
          startDate: null,
          endDate: null,
          completedAt: "2026-05-01T00:00:00.000Z",
        }),
        noonMay2026
      )
    ).toBe(false);
  });
});
