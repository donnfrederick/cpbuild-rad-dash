import { describe, expect, it } from "vitest";
import { sprintApiToPlanningPick, ticketInPlanningSprint } from "@/lib/project-planning-sprint";
import type { SprintApiPayload } from "@/lib/sprint-map";

const baseSprint = (over: Partial<SprintApiPayload> = {}): SprintApiPayload => ({
  id: "s1",
  name: "Q1",
  startDate: "2026-01-01T00:00:00.000Z",
  endDate: "2026-12-31T00:00:00.000Z",
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
  ...over,
});

describe("ticketInPlanningSprint", () => {
  it("is true when row.sprints includes the planning sprint (explicit membership)", () => {
    const pick = sprintApiToPlanningPick(
      baseSprint({ id: "sp1", usesExplicitTicketList: true, projects: [{ id: "p1", name: "A" }] })
    );
    expect(
      ticketInPlanningSprint({ sprints: [{ id: "sp1" }] }, pick)
    ).toBe(true);
    expect(ticketInPlanningSprint({ sprints: [] }, pick)).toBe(false);
  });

  it("is true when row.sprints was enriched with implicit sprint scope (GET /api/tickets)", () => {
    const pick = sprintApiToPlanningPick(baseSprint({ id: "sp1", usesExplicitTicketList: false }));
    expect(
      ticketInPlanningSprint({ sprints: [{ id: "sp1" }] }, pick)
    ).toBe(true);
  });
});
