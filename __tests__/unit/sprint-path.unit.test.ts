import { describe, expect, it } from "vitest";
import { sprintIdFromPathname } from "@/lib/sprint-path";

describe("sprintIdFromPathname", () => {
  it("returns null for non-sprint paths", () => {
    expect(sprintIdFromPathname("/")).toBeNull();
    expect(sprintIdFromPathname("/projects/abc123")).toBeNull();
    expect(sprintIdFromPathname("/tickets")).toBeNull();
  });

  it("extracts sprint id from bare sprint path", () => {
    expect(sprintIdFromPathname("/sprints/clxabc123")).toBe("clxabc123");
  });

  it("extracts sprint id from nested sprint path (tickets sub-route)", () => {
    expect(sprintIdFromPathname("/sprints/clxabc123/tickets")).toBe("clxabc123");
  });

  it("extracts sprint id from nested sprint path (overview sub-route)", () => {
    expect(sprintIdFromPathname("/sprints/clxabc123/overview")).toBe("clxabc123");
  });

  it("extracts sprint id from nested sprint path (complete sub-route)", () => {
    expect(sprintIdFromPathname("/sprints/clxabc123/complete")).toBe("clxabc123");
  });

  it("extracts sprint id from nested sprint path (report sub-route)", () => {
    expect(sprintIdFromPathname("/sprints/clxabc123/report")).toBe("clxabc123");
  });

  it("extracts sprint id when locale prefix is present", () => {
    expect(sprintIdFromPathname("/en/sprints/clxabc123/tickets")).toBe("clxabc123");
    expect(sprintIdFromPathname("/fr/sprints/clxabc123/overview")).toBe("clxabc123");
  });

  it("returns null for /sprints root list page", () => {
    expect(sprintIdFromPathname("/sprints")).toBeNull();
  });
});
