import { describe, it, expect } from "vitest";
import {
  hasTicketTriageAccess,
  ticketListWhereClause,
  ticketMainInboxVisibilityWhere,
  canChangeTicketAssignee,
} from "@/lib/ticket-access";
import { PERMISSIONS } from "@/lib/permissions";

describe("hasTicketTriageAccess()", () => {
  it("returns false for MEMBER without override", () => {
    expect(hasTicketTriageAccess("MEMBER")).toBe(false);
  });

  it("returns true for ADMIN role", () => {
    expect(hasTicketTriageAccess("ADMIN")).toBe(true);
  });

  it("returns true when specialPermissions grants triage", () => {
    expect(hasTicketTriageAccess("MEMBER", [PERMISSIONS.TICKETS_TRIAGE])).toBe(true);
  });
});

describe("ticketListWhereClause()", () => {
  it("returns undefined when user has triage via special permission", () => {
    expect(
      ticketListWhereClause("u1", "MEMBER", [], [PERMISSIONS.TICKETS_TRIAGE])
    ).toBeUndefined();
  });

  it("returns OR filter for own tickets and mentions when not triage", () => {
    const w = ticketListWhereClause("u1", "MEMBER", ["t2", "t3"], []);
    expect(w).toEqual({
      OR: [{ userId: "u1" }, { id: { in: ["t2", "t3"] } }],
    });
  });
});

describe("ticketMainInboxVisibilityWhere()", () => {
  it("excludes deleted and duplicate rows", () => {
    expect(ticketMainInboxVisibilityWhere()).toEqual({
      status: { not: "ARCHIVED" },
      duplicateOf: { is: null },
    });
  });
});

describe("canChangeTicketAssignee()", () => {
  it("returns true for triage override without being submitter", () => {
    expect(
      canChangeTicketAssignee({
        viewerId: "other",
        role: "MEMBER",
        ticketUserId: "submitter",
        specialPermissions: [PERMISSIONS.TICKETS_TRIAGE],
      })
    ).toBe(true);
  });

  it("returns true when viewer is submitter", () => {
    expect(
      canChangeTicketAssignee({
        viewerId: "submitter",
        role: "MEMBER",
        ticketUserId: "submitter",
      })
    ).toBe(true);
  });
});
