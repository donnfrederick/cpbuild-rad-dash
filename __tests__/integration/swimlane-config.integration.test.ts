import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── db mocks ────────────────────────────────────────────────────────────────
const mockMembershipFindUnique = vi.fn();
const mockSwimlaneConfigFindUnique = vi.fn();
const mockSwimlaneConfigUpsert = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    teamMembership: {
      findUnique: (...args: unknown[]) => mockMembershipFindUnique(...args),
    },
    teamSwimlaneConfig: {
      findUnique: (...args: unknown[]) => mockSwimlaneConfigFindUnique(...args),
      upsert: (...args: unknown[]) => mockSwimlaneConfigUpsert(...args),
    },
  },
}));

const mockGetSessionContext = vi.fn();
vi.mock("@/lib/session-context", () => ({
  getSessionContext: () => mockGetSessionContext(),
}));

const { GET: GET_CONFIG, PATCH: PATCH_CONFIG } = await import(
  "@/app/api/teams/[id]/swimlane-config/route"
);

// ── helpers ─────────────────────────────────────────────────────────────────
const TEAM_ID = "team-aaa";
const USER_ID = "user-aaa";

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

function makeGetRequest() {
  return new NextRequest(`http://localhost/api/teams/${TEAM_ID}/swimlane-config`, {
    method: "GET",
  });
}

function makePatchRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/teams/${TEAM_ID}/swimlane-config`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function teamCtx() {
  return { params: Promise.resolve({ id: TEAM_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── GET /swimlane-config ─────────────────────────────────────────────────────
describe("GET /api/teams/[id]/swimlane-config", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetSessionContext.mockResolvedValue(null);
    const res = await GET_CONFIG(makeGetRequest(), teamCtx());
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a team member", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue(null);
    const res = await GET_CONFIG(makeGetRequest(), teamCtx());
    expect(res.status).toBe(403);
  });

  it("returns default NONE config when no config row exists", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue({ teamRole: "MEMBER" });
    mockSwimlaneConfigFindUnique.mockResolvedValue(null);

    const res = await GET_CONFIG(makeGetRequest(), teamCtx());
    expect(res.status).toBe(200);
    const json = await res.json() as { swimlaneConfig: { swimlaneBy: string; id: null } };
    expect(json.swimlaneConfig.swimlaneBy).toBe("NONE");
    expect(json.swimlaneConfig.id).toBeNull();
  });

  it("returns the persisted swimlane config", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue({ teamRole: "MEMBER" });
    mockSwimlaneConfigFindUnique.mockResolvedValue({
      id: "cfg-1",
      teamId: TEAM_ID,
      swimlaneBy: "ASSIGNEE",
    });

    const res = await GET_CONFIG(makeGetRequest(), teamCtx());
    expect(res.status).toBe(200);
    const json = await res.json() as { swimlaneConfig: { swimlaneBy: string } };
    expect(json.swimlaneConfig.swimlaneBy).toBe("ASSIGNEE");
  });
});

// ── PATCH /swimlane-config ───────────────────────────────────────────────────
describe("PATCH /api/teams/[id]/swimlane-config", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetSessionContext.mockResolvedValue(null);
    const res = await PATCH_CONFIG(makePatchRequest({ swimlaneBy: "ASSIGNEE" }), teamCtx());
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a member", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue(null);
    const res = await PATCH_CONFIG(makePatchRequest({ swimlaneBy: "ASSIGNEE" }), teamCtx());
    expect(res.status).toBe(403);
  });

  it("returns 422 for an invalid swimlaneBy value", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue({ teamRole: "MEMBER" });
    const res = await PATCH_CONFIG(makePatchRequest({ swimlaneBy: "INVALID" }), teamCtx());
    expect(res.status).toBe(422);
  });

  it.each(["NONE", "ASSIGNEE", "TYPE", "PRIORITY", "PROJECT"] as const)(
    "accepts valid swimlaneBy value: %s",
    async (value) => {
      mockGetSessionContext.mockResolvedValue(memberSession());
      mockMembershipFindUnique.mockResolvedValue({ teamRole: "MEMBER" });
      mockSwimlaneConfigUpsert.mockResolvedValue({ id: "cfg-1", teamId: TEAM_ID, swimlaneBy: value });

      const res = await PATCH_CONFIG(makePatchRequest({ swimlaneBy: value }), teamCtx());
      expect(res.status).toBe(200);
      const json = await res.json() as { swimlaneConfig: { swimlaneBy: string } };
      expect(json.swimlaneConfig.swimlaneBy).toBe(value);
    }
  );

  it("upserts config and returns updated swimlaneBy", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockMembershipFindUnique.mockResolvedValue({ teamRole: "MEMBER" });
    mockSwimlaneConfigUpsert.mockResolvedValue({
      id: "cfg-1",
      teamId: TEAM_ID,
      swimlaneBy: "PRIORITY",
    });

    const res = await PATCH_CONFIG(makePatchRequest({ swimlaneBy: "PRIORITY" }), teamCtx());
    expect(res.status).toBe(200);

    const upsertCall = mockSwimlaneConfigUpsert.mock.calls[0][0] as {
      create: { swimlaneBy: string };
      update: { swimlaneBy: string };
    };
    expect(upsertCall.create.swimlaneBy).toBe("PRIORITY");
    expect(upsertCall.update.swimlaneBy).toBe("PRIORITY");
  });
});
