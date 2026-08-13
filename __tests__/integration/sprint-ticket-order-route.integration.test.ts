import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockSprintFindUnique = vi.fn();
const mockSprintBoardTicketOrderFindMany = vi.fn();
const mockSprintBoardTicketOrderDeleteMany = vi.fn();
const mockSprintBoardTicketOrderCreateMany = vi.fn();
const mockTicketCount = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    sprint: {
      findUnique: (...args: unknown[]) => mockSprintFindUnique(...args),
    },
    ticket: {
      count: (...args: unknown[]) => mockTicketCount(...args),
    },
    sprintBoardTicketOrder: {
      findMany: (...args: unknown[]) => mockSprintBoardTicketOrderFindMany(...args),
      deleteMany: (...args: unknown[]) => mockSprintBoardTicketOrderDeleteMany(...args),
      createMany: (...args: unknown[]) => mockSprintBoardTicketOrderCreateMany(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

const mockGetSessionContext = vi.fn();
vi.mock("@/lib/session-context", () => ({
  getSessionContext: () => mockGetSessionContext(),
}));

const mockResolveAccessibleTeamIds = vi.fn();
vi.mock("@/lib/team-context", () => ({
  resolveAccessibleTeamIds: (...args: unknown[]) => mockResolveAccessibleTeamIds(...args),
}));

const { GET, PATCH } = await import("@/app/api/sprints/[id]/ticket-order/route");

function triageSession() {
  return {
    user: {
      id: "clqtestuser0000000000000001",
      email: "a@x.com",
      name: "Admin",
      role: "ADMIN",
      specialPermissions: [] as string[],
    },
  };
}

const ctx = { params: Promise.resolve({ id: "s1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveAccessibleTeamIds.mockResolvedValue(["team1"]);
  mockTransaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  mockSprintBoardTicketOrderDeleteMany.mockResolvedValue({ count: 0 });
  mockSprintBoardTicketOrderCreateMany.mockResolvedValue({ count: 0 });
});

describe("GET /api/sprints/[id]/ticket-order", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetSessionContext.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/sprints/s1/ticket-order"), ctx);
    expect(res.status).toBe(401);
  });

  it("returns 403 for member without triage", async () => {
    mockGetSessionContext.mockResolvedValue({
      user: {
        id: "u1",
        email: "m@x.com",
        name: "M",
        role: "MEMBER",
        specialPermissions: [] as string[],
      },
    });
    const res = await GET(new NextRequest("http://localhost/api/sprints/s1/ticket-order"), ctx);
    expect(res.status).toBe(403);
  });

  it("returns 404 when sprint not found", async () => {
    mockGetSessionContext.mockResolvedValue(triageSession());
    mockSprintFindUnique.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/sprints/s1/ticket-order"), ctx);
    expect(res.status).toBe(404);
  });

  it("returns orders for sprint when triage", async () => {
    mockGetSessionContext.mockResolvedValue(triageSession());
    mockSprintFindUnique.mockResolvedValue({ id: "s1", teamId: "team1" });
    mockSprintBoardTicketOrderFindMany.mockResolvedValue([
      { statusKey: "READY", ticketId: "t2", position: 0 },
      { statusKey: "READY", ticketId: "t1", position: 1 },
    ]);

    const res = await GET(new NextRequest("http://localhost/api/sprints/s1/ticket-order"), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      orders: Array<{ statusKey: string; ticketId: string; position: number }>;
    };
    expect(body.orders).toHaveLength(2);
    expect(mockSprintBoardTicketOrderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sprintId: "s1" },
        orderBy: [{ statusKey: "asc" }, { position: "asc" }],
      })
    );
  });

  it("returns 403 when triage user cannot access the sprint team", async () => {
    mockGetSessionContext.mockResolvedValue(triageSession());
    mockResolveAccessibleTeamIds.mockResolvedValue(["other-team"]);
    mockSprintFindUnique.mockResolvedValue({ id: "s1", teamId: "team1" });

    const res = await GET(new NextRequest("http://localhost/api/sprints/s1/ticket-order"), ctx);
    expect(res.status).toBe(403);
    expect(mockSprintBoardTicketOrderFindMany).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/sprints/[id]/ticket-order", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetSessionContext.mockResolvedValue(null);
    const res = await PATCH(
      new NextRequest("http://localhost/api/sprints/s1/ticket-order", {
        method: "PATCH",
        body: JSON.stringify({ statusKey: "READY", orderedTicketIds: ["t1"] }),
      }),
      ctx
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for member without triage", async () => {
    mockGetSessionContext.mockResolvedValue({
      user: {
        id: "u1",
        email: "m@x.com",
        name: "M",
        role: "MEMBER",
        specialPermissions: [] as string[],
      },
    });
    const res = await PATCH(
      new NextRequest("http://localhost/api/sprints/s1/ticket-order", {
        method: "PATCH",
        body: JSON.stringify({ statusKey: "READY", orderedTicketIds: ["t1"] }),
      }),
      ctx
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid JSON body", async () => {
    mockGetSessionContext.mockResolvedValue(triageSession());
    const res = await PATCH(
      new NextRequest("http://localhost/api/sprints/s1/ticket-order", {
        method: "PATCH",
        body: "not-json",
      }),
      ctx
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when sprint is completed", async () => {
    mockGetSessionContext.mockResolvedValue(triageSession());
    mockSprintFindUnique.mockResolvedValue({
      id: "s1",
      teamId: "team1",
      completedAt: new Date("2026-01-01"),
      projects: [{ projectId: "p1" }],
      sprintTickets: [],
    });
    const res = await PATCH(
      new NextRequest("http://localhost/api/sprints/s1/ticket-order", {
        method: "PATCH",
        body: JSON.stringify({ statusKey: "READY", orderedTicketIds: ["t1"] }),
      }),
      ctx
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/completed sprint/i);
  });

  it("returns 400 when a ticket id does not exist", async () => {
    mockGetSessionContext.mockResolvedValue(triageSession());
    mockSprintFindUnique.mockResolvedValue({
      id: "s1",
      teamId: "team1",
      completedAt: null,
      projects: [{ projectId: "p1" }],
      sprintTickets: [],
    });
    mockTicketCount.mockResolvedValue(0);

    const res = await PATCH(
      new NextRequest("http://localhost/api/sprints/s1/ticket-order", {
        method: "PATCH",
        body: JSON.stringify({ statusKey: "READY", orderedTicketIds: ["missing"] }),
      }),
      ctx
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not visible in this sprint column/i);
  });

  it("replaces column order in a transaction", async () => {
    mockGetSessionContext.mockResolvedValue(triageSession());
    mockSprintFindUnique.mockResolvedValue({
      id: "s1",
      teamId: "team1",
      completedAt: null,
      projects: [{ projectId: "p1" }],
      sprintTickets: [],
    });
    mockTicketCount.mockResolvedValue(2);

    const res = await PATCH(
      new NextRequest("http://localhost/api/sprints/s1/ticket-order", {
        method: "PATCH",
        body: JSON.stringify({
          statusKey: "READY",
          orderedTicketIds: ["t2", "t1", "t2"],
        }),
      }),
      ctx
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockSprintBoardTicketOrderDeleteMany).toHaveBeenCalledWith({
      where: { sprintId: "s1", statusKey: "READY" },
    });
    expect(mockTicketCount).toHaveBeenCalledWith({
      where: {
        AND: [
          { projectId: { in: ["p1"] } },
          { id: { in: ["t2", "t1"] } },
          { status: "READY" },
        ],
      },
    });
    expect(mockSprintBoardTicketOrderCreateMany).toHaveBeenCalledWith({
      data: [
        { sprintId: "s1", statusKey: "READY", ticketId: "t2", position: 0 },
        { sprintId: "s1", statusKey: "READY", ticketId: "t1", position: 1 },
      ],
    });
  });

  it("clears column order when orderedTicketIds is empty", async () => {
    mockGetSessionContext.mockResolvedValue(triageSession());
    mockSprintFindUnique.mockResolvedValue({
      id: "s1",
      teamId: "team1",
      completedAt: null,
      projects: [{ projectId: "p1" }],
      sprintTickets: [],
    });

    const res = await PATCH(
      new NextRequest("http://localhost/api/sprints/s1/ticket-order", {
        method: "PATCH",
        body: JSON.stringify({ statusKey: "READY", orderedTicketIds: [] }),
      }),
      ctx
    );
    expect(res.status).toBe(200);
    expect(mockSprintBoardTicketOrderDeleteMany).toHaveBeenCalled();
    expect(mockSprintBoardTicketOrderCreateMany).not.toHaveBeenCalled();
    expect(mockTicketCount).not.toHaveBeenCalled();
  });

  it("returns 403 when triage user cannot write the sprint team", async () => {
    mockGetSessionContext.mockResolvedValue(triageSession());
    mockResolveAccessibleTeamIds.mockResolvedValue(["other-team"]);
    mockSprintFindUnique.mockResolvedValue({
      id: "s1",
      teamId: "team1",
      completedAt: null,
      projects: [{ projectId: "p1" }],
      sprintTickets: [],
    });

    const res = await PATCH(
      new NextRequest("http://localhost/api/sprints/s1/ticket-order", {
        method: "PATCH",
        body: JSON.stringify({ statusKey: "READY", orderedTicketIds: ["t1"] }),
      }),
      ctx
    );

    expect(res.status).toBe(403);
    expect(mockTicketCount).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("requires ordered tickets to be visible in the sprint column", async () => {
    mockGetSessionContext.mockResolvedValue(triageSession());
    mockSprintFindUnique.mockResolvedValue({
      id: "s1",
      teamId: "team1",
      completedAt: null,
      projects: [{ projectId: "p1" }],
      sprintTickets: [],
    });
    mockTicketCount.mockResolvedValue(1);

    const res = await PATCH(
      new NextRequest("http://localhost/api/sprints/s1/ticket-order", {
        method: "PATCH",
        body: JSON.stringify({ statusKey: "READY", orderedTicketIds: ["t1", "cross-team"] }),
      }),
      ctx
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not visible in this sprint column/i);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
