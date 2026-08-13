import { describe, it, expect } from "vitest";
import { assertValidParentAssignment, wouldAssigningParentCreateCycle } from "@/lib/ticket-parent";
import { parseTicketRefLabel } from "@/components/tickets/ticket-utils";

describe("wouldAssigningParentCreateCycle", () => {
  it("returns false when parent chain does not reach ticket", () => {
    const parents: Record<string, string | null> = {
      a: "b",
      b: null,
    };
    expect(wouldAssigningParentCreateCycle("t", "a", (id) => parents[id] ?? null)).toBe(false);
  });

  it("returns true when proposed parent is the ticket (self in chain)", () => {
    const parents: Record<string, string | null> = { x: null };
    expect(wouldAssigningParentCreateCycle("x", "x", (id) => parents[id] ?? null)).toBe(true);
  });

  it("returns true when an ancestor of the proposed parent is the ticket (cycle)", () => {
    const parents: Record<string, string | null> = {
      p: "c",
      c: null,
    };
    expect(wouldAssigningParentCreateCycle("c", "p", (id) => parents[id] ?? null)).toBe(true);
  });
});

describe("assertValidParentAssignment", () => {
  it("throws CYCLE when parent is under the ticket subtree", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      ticket: {
        findUnique: async (args: { where: { id: string }; select: Record<string, boolean> }) => {
          const id = args.where.id;
          const sel = args.select;
          if (sel.id && !("parentId" in sel)) {
            if (id === "p") return { id: "p" };
            return null;
          }
          if ("parentId" in sel && sel.parentId === true) {
            if (id === "p") return { parentId: "c" };
            if (id === "c") return { parentId: null };
          }
          return null;
        },
      },
    };
    await expect(assertValidParentAssignment(db, { ticketId: "c", parentId: "p" })).rejects.toMatchObject({
      code: "CYCLE",
    });
  });

  it("allows clearing parent", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { ticket: { findUnique: async () => null } } as any;
    await expect(assertValidParentAssignment(db, { ticketId: "c", parentId: null })).resolves.toBeUndefined();
  });
});

describe("parseTicketRefLabel", () => {
  it("parses RAD-0042", () => {
    expect(parseTicketRefLabel("RAD-0042")).toBe(42);
  });

  it("returns null for invalid input", () => {
    expect(parseTicketRefLabel("nope")).toBe(null);
  });
});
