import { describe, expect, it } from "vitest";
import { applyCardOrder, mergeColumnTicketIds, orderTicketsByIds } from "@/lib/sprint-board-ticket-order";

function ticket(id: string, createdAt: string) {
  return { id, createdAt, title: id };
}

describe("applyCardOrder", () => {
  it("returns tickets unchanged when order is undefined", () => {
    const tickets = [ticket("a", "2026-01-03"), ticket("b", "2026-01-01")];
    expect(applyCardOrder(tickets, undefined)).toEqual(tickets);
  });

  it("returns tickets unchanged when order is empty", () => {
    const tickets = [ticket("a", "2026-01-03"), ticket("b", "2026-01-01")];
    expect(applyCardOrder(tickets, [])).toEqual(tickets);
  });

  it("sorts tickets by persisted order", () => {
    const tickets = [
      ticket("t1", "2026-01-01"),
      ticket("t2", "2026-01-02"),
      ticket("t3", "2026-01-03"),
    ];
    const ordered = applyCardOrder(tickets, ["t3", "t1", "t2"]);
    expect(ordered.map((r) => r.id)).toEqual(["t3", "t1", "t2"]);
  });

  it("places tickets not in order last, newest createdAt first", () => {
    const tickets = [
      ticket("old", "2026-01-01"),
      ticket("new", "2026-01-10"),
      ticket("mid", "2026-01-05"),
    ];
    const ordered = applyCardOrder(tickets, ["mid"]);
    expect(ordered.map((r) => r.id)).toEqual(["mid", "new", "old"]);
  });

  it("does not mutate the input array", () => {
    const tickets = [ticket("a", "2026-01-01"), ticket("b", "2026-01-02")];
    const copy = [...tickets];
    applyCardOrder(tickets, ["b", "a"]);
    expect(tickets).toEqual(copy);
  });
});

describe("mergeColumnTicketIds", () => {
  it("appends new ticket ids not in persisted order", () => {
    expect(mergeColumnTicketIds(["t2", "t3"], ["t1", "t2"])).toEqual(["t1", "t2", "t3"]);
  });
});

describe("orderTicketsByIds", () => {
  it("reorders rows to match id list", () => {
    const rows = [ticket("a", "1"), ticket("b", "2"), ticket("c", "3")];
    expect(orderTicketsByIds(rows, ["c", "a"]).map((r) => r.id)).toEqual(["c", "a"]);
  });
});
