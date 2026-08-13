import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockTransaction = vi.fn();
const mockSprintFindUnique = vi.fn();
const mockSprintFindUniqueOrThrow = vi.fn();
const mockTicketFindMany = vi.fn();
const mockSprintUpdate = vi.fn();
const mockSprintTicketUpsert = vi.fn();
const mockSprintTicketCreateMany = vi.fn();

const mockTx = {
  sprint: {
    findUnique: (...args: unknown[]) => mockSprintFindUnique(...args),
    findUniqueOrThrow: (...args: unknown[]) => mockSprintFindUniqueOrThrow(...args),
    update: (...args: unknown[]) => mockSprintUpdate(...args),
  },
  ticket: {
    findMany: (...args: unknown[]) => mockTicketFindMany(...args),
  },
  sprintTicket: {
    upsert: (...args: unknown[]) => mockSprintTicketUpsert(...args),
    createMany: (...args: unknown[]) => mockSprintTicketCreateMany(...args),
  },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (fn: (tx: typeof mockTx) => Promise<unknown>) => mockTransaction(fn),
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

vi.mock("@/lib/list-cache", () => ({
  revalidateTicketsList: vi.fn(),
}));

const { POST } = await import("@/app/api/sprints/[id]/complete/route");

const TEAM_ID = "team-closing";

const scopeRowClosing = {
  teamId: TEAM_ID,
  completedAt: null,
  projects: [{ projectId: "p1" }],
  sprintTickets: [],
  _count: { sprintTickets: 0 },
};

function mockFinalSprintRow(id: string) {
  return {
    id,
    name: "Closing",
    startDate: null,
    endDate: null,
    completedAt: new Date("2026-05-10T00:00:00.000Z"),
    velocity: 5,
    maxManSprints: null,
    daysOff: 0,
    carryOverPoints: null,
    pointsPlanned: null,
    goals: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-10T00:00:00.000Z"),
    _count: { sprintTickets: 0 },
    projects: [{ projectId: "p1", project: { id: "p1", name: "Proj" } }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx));
  mockResolveAccessibleTeamIds.mockResolvedValue([TEAM_ID]);
});

function session() {
  return {
    user: {
      id: "user1",
      email: "a@x.com",
      name: "U",
      role: "ADMIN" as const,
      specialPermissions: [] as string[],
    },
  };
}

describe("POST /api/sprints/[id]/complete", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetSessionContext.mockResolvedValue(null);
    const res = await POST(
      new NextRequest("http://localhost/api/sprints/s1/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "s1" }) }
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when sprint scope row is missing", async () => {
    mockGetSessionContext.mockResolvedValue(session());
    mockSprintFindUnique.mockResolvedValueOnce(null);
    const res = await POST(
      new NextRequest("http://localhost/api/sprints/missing/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "missing" }) }
    );
    expect(res.status).toBe(404);
    expect(mockTicketFindMany).not.toHaveBeenCalled();
  });

  it("returns 400 when sprint is already completed", async () => {
    mockGetSessionContext.mockResolvedValue(session());
    mockSprintFindUnique.mockResolvedValueOnce({
      ...scopeRowClosing,
      completedAt: new Date(),
    });
    const res = await POST(
      new NextRequest("http://localhost/api/sprints/s1/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "s1" }) }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("already completed");
  });

  it("returns 400 when nextSprintId equals the sprint being completed", async () => {
    mockGetSessionContext.mockResolvedValue(session());
    mockSprintFindUnique.mockResolvedValueOnce(scopeRowClosing);
    mockTicketFindMany.mockResolvedValueOnce([
      {
        id: "t1",
        title: "Done ticket",
        status: "DONE",
        storyPoints: 5,
        ticketScopeKey: "R",
        ticketKeyNumber: 1,
        project: { ticketKeyPrefix: "R" },
      },
    ]);
    mockSprintUpdate.mockResolvedValueOnce({});
    const res = await POST(
      new NextRequest("http://localhost/api/sprints/same/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nextSprintId: "same" }),
      }),
      { params: Promise.resolve({ id: "same" }) }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("same sprint");
    expect(mockSprintFindUnique).toHaveBeenCalledTimes(1);
  });

  it("completes without nextSprintId and does not upsert sprint tickets", async () => {
    mockGetSessionContext.mockResolvedValue(session());
    mockSprintFindUnique.mockResolvedValueOnce(scopeRowClosing);
    mockTicketFindMany.mockResolvedValueOnce([]);
    mockSprintUpdate.mockResolvedValueOnce({});
    mockSprintFindUniqueOrThrow.mockResolvedValueOnce(mockFinalSprintRow("close1"));

    const res = await POST(
      new NextRequest("http://localhost/api/sprints/close1/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "close1" }) }
    );

    expect(res.status).toBe(200);
    expect(mockSprintTicketUpsert).not.toHaveBeenCalled();
    expect(mockSprintTicketCreateMany).not.toHaveBeenCalled();
    expect(mockSprintUpdate).toHaveBeenCalledTimes(1);
    const payload = (await res.json()) as { sprint?: { id: string } };
    expect(payload.sprint?.id).toBe("close1");
  });

  it("completes with nextSprintId and upserts carried-over tickets", async () => {
    mockGetSessionContext.mockResolvedValue(session());
    mockSprintFindUnique
      .mockResolvedValueOnce(scopeRowClosing)
      .mockResolvedValueOnce({
        id: "next1",
        teamId: TEAM_ID,
        completedAt: null,
        projects: [{ projectId: "p1" }],
      })
      .mockResolvedValueOnce({
        ...scopeRowClosing,
        _count: { sprintTickets: 2 },
      });
    mockTicketFindMany.mockResolvedValueOnce([
      {
        id: "t-done",
        title: "D",
        status: "DONE",
        storyPoints: 3,
        ticketScopeKey: "R",
        ticketKeyNumber: 1,
        project: { ticketKeyPrefix: "R" },
      },
      {
        id: "t-open",
        title: "O",
        status: "READY",
        storyPoints: 2,
        ticketScopeKey: "R",
        ticketKeyNumber: 2,
        project: { ticketKeyPrefix: "R" },
      },
    ]);
    mockSprintUpdate.mockResolvedValueOnce({});
    mockSprintFindUniqueOrThrow.mockResolvedValueOnce(mockFinalSprintRow("closing1"));

    const res = await POST(
      new NextRequest("http://localhost/api/sprints/closing1/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nextSprintId: "next1" }),
      }),
      { params: Promise.resolve({ id: "closing1" }) }
    );

    expect(res.status).toBe(200);
    expect(mockSprintTicketUpsert).toHaveBeenCalledTimes(1);
    expect(mockSprintTicketUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sprintId_ticketId: { sprintId: "next1", ticketId: "t-open" } },
        create: expect.objectContaining({ isCarriedOver: true }) as Record<string, unknown>,
      })
    );
  });

  it("returns 400 when additionalNextSprintTicketIds is set without nextSprintId", async () => {
    mockGetSessionContext.mockResolvedValue(session());
    const res = await POST(
      new NextRequest("http://localhost/api/sprints/s1/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additionalNextSprintTicketIds: ["x"] }),
      }),
      { params: Promise.resolve({ id: "s1" }) }
    );
    expect(res.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("creates extra sprint_ticket rows for additionalNextSprintTicketIds", async () => {
    mockGetSessionContext.mockResolvedValue(session());
    mockSprintFindUnique
      .mockResolvedValueOnce(scopeRowClosing)
      .mockResolvedValueOnce({
        id: "next1",
        teamId: TEAM_ID,
        completedAt: null,
        projects: [{ projectId: "p1" }],
      })
      .mockResolvedValueOnce({
        ...scopeRowClosing,
        _count: { sprintTickets: 2 },
      });
    mockTicketFindMany
      .mockResolvedValueOnce([
        {
          id: "t-done",
          title: "D",
          status: "DONE",
          storyPoints: 3,
          ticketScopeKey: "R",
          ticketKeyNumber: 1,
          project: { ticketKeyPrefix: "R" },
        },
        {
          id: "t-open",
          title: "O",
          status: "READY",
          storyPoints: 2,
          ticketScopeKey: "R",
          ticketKeyNumber: 2,
          project: { ticketKeyPrefix: "R" },
        },
      ])
      .mockResolvedValueOnce([{ id: "t-extra" }]);
    mockSprintUpdate.mockResolvedValueOnce({});
    mockSprintFindUniqueOrThrow.mockResolvedValueOnce(mockFinalSprintRow("closing1"));

    const res = await POST(
      new NextRequest("http://localhost/api/sprints/closing1/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nextSprintId: "next1",
          additionalNextSprintTicketIds: ["t-extra"],
        }),
      }),
      { params: Promise.resolve({ id: "closing1" }) }
    );

    expect(res.status).toBe(200);
    expect(mockSprintTicketUpsert).toHaveBeenCalledTimes(1);
    expect(mockSprintTicketCreateMany).toHaveBeenCalledTimes(1);
    expect(mockSprintTicketCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            sprintId: "next1",
            ticketId: "t-extra",
            isCarriedOver: false,
          }),
        ],
        skipDuplicates: true,
      })
    );
  });
});
