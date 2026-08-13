import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── db mocks ────────────────────────────────────────────────────────────────
const mockMembershipFindUnique = vi.fn();
const mockBoardStatusFindMany = vi.fn();
const mockBoardStatusFindUnique = vi.fn();
const mockBoardStatusAggregate = vi.fn();
const mockBoardStatusCreate = vi.fn();
const mockBoardStatusUpdate = vi.fn();
const mockBoardStatusDelete = vi.fn();
const mockTicketCount = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    teamMembership: {
      findUnique: (...args: unknown[]) => mockMembershipFindUnique(...args),
    },
    teamBoardStatus: {
      findMany: (...args: unknown[]) => mockBoardStatusFindMany(...args),
      findUnique: (...args: unknown[]) => mockBoardStatusFindUnique(...args),
      aggregate: (...args: unknown[]) => mockBoardStatusAggregate(...args),
      create: (...args: unknown[]) => mockBoardStatusCreate(...args),
      update: (...args: unknown[]) => mockBoardStatusUpdate(...args),
      delete: (...args: unknown[]) => mockBoardStatusDelete(...args),
    },
    ticket: {
      count: (...args: unknown[]) => mockTicketCount(...args),
    },
  },
}));

const mockGetSessionContext = vi.fn();
vi.mock("@/lib/session-context", () => ({
  getSessionContext: () => mockGetSessionContext(),
}));

const { GET: GET_LIST, POST: POST_CREATE } = await import(
  "@/app/api/teams/[id]/board-statuses/route"
);
const { PATCH: PATCH_STATUS, DELETE: DELETE_STATUS } = await import(
  "@/app/api/teams/[id]/board-statuses/[statusId]/route"
);

// ── helpers ─────────────────────────────────────────────────────────────────
const TEAM_ID = "team-aaa";
const USER_ID = "user-aaa";
const STATUS_ID = "status-bbb";

function memberSession() {
  return {
    user: {
      id: USER_ID,
      email: "m@x.com",
      name: "Member",
      role: "MEMBER",
      specialPermissions: [] as string[],
    },
  };
}

function makeRequest(method: string, body?: unknown) {
  return new NextRequest(`http://localhost/api/teams/${TEAM_ID}/board-statuses`, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json" },
  });
}

function makeStatusRequest(method: string, body?: unknown) {
  return new NextRequest(
    `http://localhost/api/teams/${TEAM_ID}/board-statuses/${STATUS_ID}`,
    {
      method,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: { "Content-Type": "application/json" },
    }
  );
}

function teamCtx() {
  return { params: Promise.resolve({ id: TEAM_ID }) };
}

function statusCtx() {
  return { params: Promise.resolve({ id: TEAM_ID, statusId: STATUS_ID }) };
}

const SAMPLE_STATUSES = [
  { id: "s1", key: "BACKLOG", label: "Backlog", color: null, isBuiltIn: true, isEnabled: true, sortOrder: 0 },
  { id: "s2", key: "DONE", label: "Done", color: null, isBuiltIn: true, isEnabled: true, sortOrder: 6 },
];

beforeEach(() => {
  vi.clearAllMocks();
});

// ── GET /board-statuses ──────────────────────────────────────────────────────
describe("GET /api/teams/[id]/board-statuses", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetSessionContext.mockResolvedValue(null);
    const res = await GET_LIST(makeRequest("GET"), teamCtx());
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not a team member", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue(null);
    const res = await GET_LIST(makeRequest("GET"), teamCtx());
    expect(res.status).toBe(403);
  });

  it("returns board statuses ordered by sortOrder", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue({ teamRole: "MEMBER" });
    mockBoardStatusFindMany.mockResolvedValue(SAMPLE_STATUSES);

    const res = await GET_LIST(makeRequest("GET"), teamCtx());
    expect(res.status).toBe(200);
    const json = await res.json() as { boardStatuses: typeof SAMPLE_STATUSES };
    expect(json.boardStatuses).toHaveLength(2);
    expect(json.boardStatuses[0].key).toBe("BACKLOG");
  });
});

// ── POST /board-statuses ─────────────────────────────────────────────────────
describe("POST /api/teams/[id]/board-statuses", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetSessionContext.mockResolvedValue(null);
    const res = await POST_CREATE(makeRequest("POST", { label: "QA" }), teamCtx());
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a member", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue(null);
    const res = await POST_CREATE(makeRequest("POST", { label: "QA" }), teamCtx());
    expect(res.status).toBe(403);
  });

  it("returns 422 for invalid input", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue({ teamRole: "MEMBER" });
    const res = await POST_CREATE(makeRequest("POST", { label: "" }), teamCtx());
    expect(res.status).toBe(422);
  });

  it("returns 409 when key already exists", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue({ teamRole: "MEMBER" });
    mockBoardStatusFindUnique.mockResolvedValue({ id: "existing" });
    const res = await POST_CREATE(makeRequest("POST", { label: "Backlog" }), teamCtx());
    expect(res.status).toBe(409);
  });

  it("creates a custom board status and returns 201", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue({ teamRole: "MEMBER" });
    mockBoardStatusFindUnique.mockResolvedValue(null);
    mockBoardStatusAggregate.mockResolvedValue({ _max: { sortOrder: 6 } });
    const created = {
      id: STATUS_ID,
      key: "AWAITING_QA",
      label: "Awaiting QA",
      color: "#6366f1",
      isBuiltIn: false,
      isEnabled: true,
      sortOrder: 7,
    };
    mockBoardStatusCreate.mockResolvedValue(created);

    const res = await POST_CREATE(
      makeRequest("POST", { label: "Awaiting QA", key: "AWAITING_QA", color: "#6366f1" }),
      teamCtx()
    );
    expect(res.status).toBe(201);
    const json = await res.json() as { boardStatus: typeof created };
    expect(json.boardStatus.key).toBe("AWAITING_QA");
    expect(json.boardStatus.sortOrder).toBe(7);
  });

  it("derives key from label when key is not provided", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue({ teamRole: "MEMBER" });
    mockBoardStatusFindUnique.mockResolvedValue(null);
    mockBoardStatusAggregate.mockResolvedValue({ _max: { sortOrder: 4 } });
    mockBoardStatusCreate.mockResolvedValue({
      id: "new-id",
      key: "READY_FOR_DEPLOY",
      label: "Ready for Deploy",
      color: null,
      isBuiltIn: false,
      isEnabled: true,
      sortOrder: 5,
    });

    const res = await POST_CREATE(
      makeRequest("POST", { label: "Ready for Deploy" }),
      teamCtx()
    );
    expect(res.status).toBe(201);
    const createCall = mockBoardStatusCreate.mock.calls[0][0] as { data: { key: string } };
    expect(createCall.data.key).toBe("READY_FOR_DEPLOY");
  });
});

// ── PATCH /board-statuses/[statusId] ────────────────────────────────────────
describe("PATCH /api/teams/[id]/board-statuses/[statusId]", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetSessionContext.mockResolvedValue(null);
    const res = await PATCH_STATUS(makeStatusRequest("PATCH", { label: "New Label" }), statusCtx());
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a member", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue(null);
    const res = await PATCH_STATUS(makeStatusRequest("PATCH", { label: "New Label" }), statusCtx());
    expect(res.status).toBe(403);
  });

  it("returns 404 when status does not belong to team", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue({ teamRole: "MEMBER" });
    mockBoardStatusFindUnique.mockResolvedValue({ id: STATUS_ID, teamId: "other-team" });
    const res = await PATCH_STATUS(makeStatusRequest("PATCH", { label: "New" }), statusCtx());
    expect(res.status).toBe(404);
  });

  it("returns 400 when no fields are provided", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue({ teamRole: "MEMBER" });
    mockBoardStatusFindUnique.mockResolvedValue({ id: STATUS_ID, teamId: TEAM_ID });
    const res = await PATCH_STATUS(makeStatusRequest("PATCH", {}), statusCtx());
    expect(res.status).toBe(400);
  });

  it("updates label and color successfully", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue({ teamRole: "MEMBER" });
    mockBoardStatusFindUnique.mockResolvedValue({ id: STATUS_ID, teamId: TEAM_ID });
    const updated = {
      id: STATUS_ID,
      key: "BACKLOG",
      label: "Renamed",
      color: "#ff0000",
      isBuiltIn: true,
      isEnabled: true,
      sortOrder: 0,
    };
    mockBoardStatusUpdate.mockResolvedValue(updated);

    const res = await PATCH_STATUS(
      makeStatusRequest("PATCH", { label: "Renamed", color: "#ff0000" }),
      statusCtx()
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { boardStatus: typeof updated };
    expect(json.boardStatus.label).toBe("Renamed");
    expect(json.boardStatus.color).toBe("#ff0000");
  });

  it("can disable a status by setting isEnabled = false", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue({ teamRole: "MEMBER" });
    mockBoardStatusFindUnique.mockResolvedValue({ id: STATUS_ID, teamId: TEAM_ID });
    mockBoardStatusUpdate.mockResolvedValue({
      id: STATUS_ID, key: "ARCHIVED", label: "Archived", color: null,
      isBuiltIn: true, isEnabled: false, sortOrder: 7,
    });

    const res = await PATCH_STATUS(makeStatusRequest("PATCH", { isEnabled: false }), statusCtx());
    expect(res.status).toBe(200);
  });
});

// ── DELETE /board-statuses/[statusId] ───────────────────────────────────────
describe("DELETE /api/teams/[id]/board-statuses/[statusId]", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetSessionContext.mockResolvedValue(null);
    const res = await DELETE_STATUS(makeStatusRequest("DELETE"), statusCtx());
    expect(res.status).toBe(401);
  });

  it("returns 409 when trying to delete a built-in status", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue({ teamRole: "MEMBER" });
    mockBoardStatusFindUnique.mockResolvedValue({
      id: STATUS_ID, teamId: TEAM_ID, key: "BACKLOG", isBuiltIn: true,
    });
    const res = await DELETE_STATUS(makeStatusRequest("DELETE"), statusCtx());
    expect(res.status).toBe(409);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/built-in/i);
  });

  it("returns 409 when tickets still use the status", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue({ teamRole: "MEMBER" });
    mockBoardStatusFindUnique.mockResolvedValue({
      id: STATUS_ID, teamId: TEAM_ID, key: "AWAITING_QA", isBuiltIn: false,
    });
    mockTicketCount.mockResolvedValue(3);

    const res = await DELETE_STATUS(makeStatusRequest("DELETE"), statusCtx());
    expect(res.status).toBe(409);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/3 ticket/i);
  });

  it("deletes a custom status with no tickets", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue({ teamRole: "MEMBER" });
    mockBoardStatusFindUnique.mockResolvedValue({
      id: STATUS_ID, teamId: TEAM_ID, key: "AWAITING_QA", isBuiltIn: false,
    });
    mockTicketCount.mockResolvedValue(0);
    mockBoardStatusDelete.mockResolvedValue({});

    const res = await DELETE_STATUS(makeStatusRequest("DELETE"), statusCtx());
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);
  });
});
