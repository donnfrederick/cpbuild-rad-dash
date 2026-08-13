import { describe, expect, it } from "vitest";
import { computeTicketSprintsForBoardAlignment } from "@/lib/ticket-list-implicit-sprints";
import { ticketMatchesSprintBoardScope } from "@/lib/sprint-ticket-where";

describe("ticketMatchesSprintBoardScope", () => {
  it("explicit mode: ticket id in sprint_tickets", () => {
    expect(
      ticketMatchesSprintBoardScope(
        { id: "t1", projectId: "p1" },
        {
          projects: [{ projectId: "p1" }],
          sprintTickets: [{ ticketId: "t1" }],
        }
      )
    ).toBe(true);
    expect(
      ticketMatchesSprintBoardScope(
        { id: "t2", projectId: "p1" },
        {
          projects: [{ projectId: "p1" }],
          sprintTickets: [{ ticketId: "t1" }],
        }
      )
    ).toBe(false);
  });

  it("implicit mode: project linked, no sprint_tickets rows", () => {
    expect(
      ticketMatchesSprintBoardScope(
        { id: "t1", projectId: "p1" },
        {
          projects: [{ projectId: "p1" }],
          sprintTickets: [],
        }
      )
    ).toBe(true);
    expect(
      ticketMatchesSprintBoardScope(
        { id: "t1", projectId: "p-other" },
        {
          projects: [{ projectId: "p1" }],
          sprintTickets: [],
        }
      )
    ).toBe(false);
  });
});

describe("computeTicketSprintsForBoardAlignment", () => {
  const scopes = [
    {
      id: "s-q2",
      name: "Q2",
      projects: [{ projectId: "p-a" }],
      sprintTickets: [] as { ticketId: string }[],
    },
  ];

  it("adds sprint when join missed implicit membership", () => {
    expect(
      computeTicketSprintsForBoardAlignment(
        { id: "t1", projectId: "p-a" },
        [],
        scopes
      )
    ).toEqual([{ id: "s-q2", name: "Q2" }]);
  });

  it("does not duplicate sprint already present from join", () => {
    expect(
      computeTicketSprintsForBoardAlignment(
        { id: "t1", projectId: "p-a" },
        [{ id: "s-q2", name: "Q2" }],
        scopes
      )
    ).toEqual([{ id: "s-q2", name: "Q2" }]);
  });
});
