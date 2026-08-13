import { describe, expect, it } from "vitest";
import {
  buildSprintCompletionPreview,
  type SprintCompletionTicketRow,
} from "@/lib/sprint-completion-preview";

function row(over: Partial<SprintCompletionTicketRow>): SprintCompletionTicketRow {
  const base: SprintCompletionTicketRow = {
    id: "t1",
    title: "Ticket",
    status: "BACKLOG",
    storyPoints: null,
    ticketScopeKey: "RAD",
    ticketKeyNumber: 1,
    project: { ticketKeyPrefix: "RAD" },
  };
  return { ...base, ...over };
}

describe("buildSprintCompletionPreview", () => {
  it("returns zeros and empty carryover for empty ticket list", () => {
    expect(buildSprintCompletionPreview([])).toEqual({
      doneTicketCount: 0,
      velocity: 0,
      carryover: [],
    });
  });

  it("counts DONE tickets and sums velocity from story points", () => {
    const preview = buildSprintCompletionPreview([
      row({ id: "a", status: "DONE", storyPoints: 3 }),
      row({ id: "b", status: "DONE", storyPoints: 5 }),
    ]);
    expect(preview.doneTicketCount).toBe(2);
    expect(preview.velocity).toBe(8);
    expect(preview.carryover).toHaveLength(0);
  });

  it("treats null story points on DONE as zero for velocity", () => {
    const preview = buildSprintCompletionPreview([row({ status: "DONE", storyPoints: null })]);
    expect(preview.velocity).toBe(0);
    expect(preview.doneTicketCount).toBe(1);
  });

  it("puts non-DONE tickets in carryover with status and storyPoints preserved", () => {
    const preview = buildSprintCompletionPreview([
      row({
        id: "open1",
        title: "Open",
        status: "IN_PROGRESS",
        storyPoints: 8,
        ticketScopeKey: "X",
        ticketKeyNumber: 2,
        project: { ticketKeyPrefix: "X" },
      }),
    ]);
    expect(preview.doneTicketCount).toBe(0);
    expect(preview.velocity).toBe(0);
    expect(preview.carryover).toHaveLength(1);
    expect(preview.carryover[0]).toMatchObject({
      id: "open1",
      title: "Open",
      status: "IN_PROGRESS",
      storyPoints: 8,
    });
    expect(typeof preview.carryover[0]?.ref).toBe("string");
  });

  it("mixes DONE velocity with carryover rows", () => {
    const preview = buildSprintCompletionPreview([
      row({ id: "d1", status: "DONE", storyPoints: 2 }),
      row({
        id: "o1",
        status: "READY",
        storyPoints: null,
        ticketKeyNumber: 9,
      }),
    ]);
    expect(preview.doneTicketCount).toBe(1);
    expect(preview.velocity).toBe(2);
    expect(preview.carryover).toHaveLength(1);
    expect(preview.carryover[0]?.id).toBe("o1");
    expect(preview.carryover[0]?.storyPoints).toBeNull();
  });
});
