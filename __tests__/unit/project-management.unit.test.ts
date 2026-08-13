import { describe, it, expect } from "vitest";
import { canManageProjects, canViewProject } from "@/lib/project-management";
import { PERMISSIONS } from "@/lib/permissions";

describe("canManageProjects()", () => {
  it("returns false for team member without triage", () => {
    expect(canManageProjects("MEMBER", [], "MEMBER")).toBe(false);
  });

  it("returns true for team admin without global triage", () => {
    expect(canManageProjects("MEMBER", [], "ADMIN")).toBe(true);
  });

  it("returns true for global ADMIN (triage)", () => {
    expect(canManageProjects("ADMIN", [], "MEMBER")).toBe(true);
  });

  it("returns true for super admin (all teams)", () => {
    expect(canManageProjects("MEMBER", [PERMISSIONS.ACCESS_ALL_TEAMS], null)).toBe(true);
  });
});

describe("canViewProject()", () => {
  it("returns true for team member without triage", () => {
    expect(canViewProject("MEMBER", [], "MEMBER")).toBe(true);
  });

  it("returns true for team admin without global triage", () => {
    expect(canViewProject("MEMBER", [], "ADMIN")).toBe(true);
  });

  it("returns false when user has no team role", () => {
    expect(canViewProject("MEMBER", [], null)).toBe(false);
  });
});
