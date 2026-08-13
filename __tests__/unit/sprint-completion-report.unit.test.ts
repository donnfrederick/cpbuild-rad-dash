import { describe, expect, it } from "vitest";
import {
  buildSprintCompletionReport,
  type SprintCompletionReportSourceTicket,
} from "@/lib/sprint-completion-report";

function ticket(over: Partial<SprintCompletionReportSourceTicket>): SprintCompletionReportSourceTicket {
  const base: SprintCompletionReportSourceTicket = {
    id: "t1",
    title: "Ticket",
    status: "BACKLOG",
    type: "BUG",
    priority: null,
    storyPoints: null,
    ticketScopeKey: "RAD",
    ticketKeyNumber: 1,
    assignee: null,
    project: null,
  };
  return { ...base, ...over };
}

const labels = {
  pointsPlanned: 20,
  unassignedProjectLabel: "No project",
  unassignedAssigneeLabel: "Unassigned",
};

describe("buildSprintCompletionReport", () => {
  it("returns empty aggregates for no tickets", () => {
    const report = buildSprintCompletionReport([], labels);
    expect(report.summary).toMatchObject({
      totalTickets: 0,
      doneTicketCount: 0,
      carryoverTicketCount: 0,
      velocityPoints: 0,
      carryoverPoints: 0,
      totalScopePoints: 0,
      pointsPlanned: 20,
    });
    expect(report.projects).toEqual([]);
    expect(report.byAssignee).toEqual([]);
  });

  it("aggregates velocity and carryover by project and assignee", () => {
    const report = buildSprintCompletionReport(
      [
        ticket({
          id: "d1",
          status: "DONE",
          storyPoints: 5,
          project: { id: "p1", name: "Alpha", ticketKeyPrefix: "A" },
          assignee: { id: "u1", name: "Alex", email: "a@x.com" },
        }),
        ticket({
          id: "c1",
          status: "IN_PROGRESS",
          storyPoints: 3,
          project: { id: "p1", name: "Alpha", ticketKeyPrefix: "A" },
          assignee: { id: "u1", name: "Alex", email: "a@x.com" },
        }),
        ticket({
          id: "d2",
          status: "DONE",
          storyPoints: 2,
          project: { id: "p2", name: "Beta", ticketKeyPrefix: "B" },
          assignee: { id: "u2", name: "Blair", email: "b@x.com" },
        }),
      ],
      labels
    );

    expect(report.summary.velocityPoints).toBe(7);
    expect(report.summary.carryoverPoints).toBe(3);
    expect(report.summary.doneTicketCount).toBe(2);
    expect(report.summary.carryoverTicketCount).toBe(1);

    expect(report.projects).toHaveLength(2);
    const alpha = report.projects.find((p) => p.projectId === "p1");
    expect(alpha).toMatchObject({
      ticketCount: 2,
      doneCount: 1,
      velocityPoints: 5,
      carryoverPoints: 3,
      totalPoints: 8,
    });

    expect(report.byAssignee).toHaveLength(2);
    const alex = report.byAssignee.find((a) => a.userId === "u1");
    expect(alex).toMatchObject({
      ticketCount: 2,
      velocityPoints: 5,
      carryoverPoints: 3,
    });
  });

  it("aggregates by type and priority", () => {
    const report = buildSprintCompletionReport(
      [
        ticket({ id: "d1", status: "DONE", storyPoints: 5, type: "BUG", priority: "HIGH" }),
        ticket({ id: "c1", status: "READY", storyPoints: 2, type: "FEATURE_REQUEST", priority: "LOW" }),
      ],
      labels
    );
    expect(report.byType).toHaveLength(2);
    const bug = report.byType.find((r) => r.key === "BUG");
    expect(bug).toMatchObject({ ticketCount: 1, doneCount: 1, velocityPoints: 5 });
    const high = report.byPriority.find((r) => r.key === "HIGH");
    expect(high).toMatchObject({ ticketCount: 1, velocityPoints: 5 });
    const low = report.byPriority.find((r) => r.key === "LOW");
    expect(low).toMatchObject({ ticketCount: 1, carryoverPoints: 2 });
  });

  it("groups tickets without project or assignee under unassigned labels", () => {
    const report = buildSprintCompletionReport(
      [ticket({ id: "x1", status: "DONE", storyPoints: 1 })],
      labels
    );
    expect(report.projects[0]).toMatchObject({
      projectId: null,
      projectName: "No project",
      velocityPoints: 1,
    });
    expect(report.byAssignee[0]).toMatchObject({
      userId: null,
      assigneeLabel: "Unassigned",
      velocityPoints: 1,
    });
  });
});
