import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockCreate = vi.fn();
const mockTagUpsert = vi.fn();
const mockProjectFindUnique = vi.fn();
const mockTeamBoardStatusFindUnique = vi.fn();
const mockTicketMentionFindMany = vi.fn();
const mockFeedbackMentionFindUnique = vi.fn();
const mockNotificationCreate = vi.fn().mockResolvedValue({
  id: "notif-mock-1",
  type: "TICKET_ASSIGNED",
  read: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  ticket: null,
  actorName: null,
  mentionCommentId: null,
});
const mockQueryRaw = vi.fn().mockResolvedValue([{ n: 1 }]);
const mockSprintFindMany = vi.fn().mockResolvedValue([]);

// Simulate $transaction by executing the callback with a mock transaction client
const mockTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
  const tx = {
    $queryRaw: mockQueryRaw,
    ticket: { create: (...args: unknown[]) => mockCreate(...args) },
    sprintTicket: { create: vi.fn().mockResolvedValue({}) },
  };
  return fn(tx);
});

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: mockQueryRaw,
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => mockTransaction(fn),
    project: {
      findUnique: (...args: unknown[]) => mockProjectFindUnique(...args),
    },
    sprint: {
      findMany: (...args: unknown[]) => mockSprintFindMany(...args),
    },
    ticket: {
      create: (...args: unknown[]) => mockCreate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
    },
    tag: {
      upsert: (...args: unknown[]) => mockTagUpsert(...args),
    },
    ticketMention: {
      findMany: (...args: unknown[]) => mockTicketMentionFindMany(...args),
      findUnique: (...args: unknown[]) => mockFeedbackMentionFindUnique(...args),
    },
    notification: {
      create: (...args: unknown[]) => mockNotificationCreate(...args),
    },
    teamMembership: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    teamBoardStatus: {
      findUnique: (...args: unknown[]) => mockTeamBoardStatusFindUnique(...args),
    },
    user: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        if (args.where.id === "assignee-1") {
          return {
            id: "assignee-1",
            email: "a@x.com",
            name: "A",
            role: { code: "MEMBER" },
          };
        }
        return null;
      }),
    },
  },
}));

vi.mock("@/lib/embeddings", () => ({
  generateTicketEmbedding: vi.fn().mockResolvedValue([]),
  storeTicketEmbedding: vi.fn().mockResolvedValue(undefined),
  findSimilarByEmbedding: vi.fn().mockResolvedValue([]),
  DEFAULT_DUPLICATE_THRESHOLD: 0.9,
}));

const mockGetSessionContext = vi.fn();
vi.mock("@/lib/session-context", () => ({
  getSessionContext: () => mockGetSessionContext(),
}));

vi.mock("@/lib/email", () => ({
  sendTicketSubmittedNotificationEmail: vi.fn().mockResolvedValue(undefined),
  sendTicketStatusEmail: vi.fn().mockResolvedValue(undefined),
  sendTicketAssignedEmail: vi.fn().mockResolvedValue(undefined),
  sendMentionEmail: vi.fn().mockResolvedValue(undefined),
}));

const { GET: GET_LIST, POST: POST_CREATE } = await import("@/app/api/tickets/route");
const { PATCH } = await import("@/app/api/tickets/[id]/route");
const { POST: POST_BULK } = await import("@/app/api/tickets/bulk/route");

beforeEach(() => {
  vi.clearAllMocks();
  mockTicketMentionFindMany.mockResolvedValue([]);
  mockSprintFindMany.mockResolvedValue([]);
  mockTeamBoardStatusFindUnique.mockResolvedValue({ isEnabled: true });
});

const CUID_USER = "clqtestuser0000000000000001";
const CUID_TICKET = "clqtesttick0000000000000001";

function memberSession() {
  return {
    user: {
      id: CUID_USER,
      email: "m@x.com",
      name: "Member",
      role: "MEMBER",
      specialPermissions: [] as string[],
    },
  };
}

function adminSession() {
  return {
    user: {
      id: CUID_USER,
      email: "a@x.com",
      name: "Admin",
      role: "ADMIN",
      specialPermissions: [] as string[],
    },
  };
}

describe("GET /api/tickets", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetSessionContext.mockResolvedValue(null);
    const res = await GET_LIST(new NextRequest("http://localhost/api/tickets"));
    expect(res.status).toBe(401);
  });

  it("lists tickets for triage with inbox visibility filter", async () => {
    mockGetSessionContext.mockResolvedValue(adminSession());
    mockFindMany.mockResolvedValue([]);
    const res = await GET_LIST(new NextRequest("http://localhost/api/tickets"));
    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ status: { not: "ARCHIVED" }, duplicateOf: { is: null } }],
        },
      })
    );
  });

  it("scopes list for member with OR clause and inbox visibility", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockTicketMentionFindMany.mockResolvedValue([{ ticketId: "t-mention" }]);
    mockFindMany.mockResolvedValue([]);
    const res = await GET_LIST(new NextRequest("http://localhost/api/tickets"));
    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { status: { not: "ARCHIVED" }, duplicateOf: { is: null } },
            { OR: [{ userId: CUID_USER }, { id: { in: ["t-mention"] } }] },
          ],
        },
      })
    );
  });
});

describe("POST /api/tickets", () => {
  it("returns 403 when member sends triage-only fields", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    const req = new NextRequest("http://localhost/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        type: "BUG",
        title: "T",
        description: "D",
        priority: "HIGH",
      }),
    });
    const res = await POST_CREATE(req);
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 403 when member sends tagNames", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    const req = new NextRequest("http://localhost/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        type: "BUG",
        title: "T",
        description: "D",
        tagNames: ["alpha"],
      }),
    });
    const res = await POST_CREATE(req);
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 403 when member sends sprintId (triage-only)", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    const req = new NextRequest("http://localhost/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        type: "BUG",
        title: "T",
        description: "D",
        projectId: "proj-1",
        sprintId: "sprint-1",
      }),
    });
    const res = await POST_CREATE(req);
    expect(res.status).toBe(403);
  });

  it("allows admin to create with project, priority, and story points", async () => {
    mockGetSessionContext.mockResolvedValue(adminSession());
    mockProjectFindUnique.mockResolvedValue({ id: "proj-1" });
    mockCreate.mockResolvedValue({
      id: "new-ticket",
      userId: CUID_USER,
      type: "BUG",
      title: "T",
      description: "D",
      shortId: 1,
      ticketScopeKey: "proj-1",
      ticketKeyNumber: 1,
      screenshot: null,
      videoUrl: null,
      pageUrl: null,
      projectId: "proj-1",
      assigneeId: null,
      priority: "MEDIUM",
      storyPoints: 5,
      status: "BACKLOG",
      user: { name: "Admin", email: "a@x.com" },
      project: { ticketKeyPrefix: "TST" },
    });

    const req = new NextRequest("http://localhost/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        type: "BUG",
        title: "T",
        description: "D",
        projectId: "proj-1",
        priority: "MEDIUM",
        storyPoints: 5,
      }),
    });
    const res = await POST_CREATE(req);
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: "proj-1",
          priority: "MEDIUM",
          storyPoints: 5,
        }),
      })
    );
  });

  it("applies tagNames after create for admin", async () => {
    mockGetSessionContext.mockResolvedValue(adminSession());
    mockProjectFindUnique.mockResolvedValue({ id: "proj-1" });
    mockTagUpsert.mockResolvedValue({ id: "tag-id-1", name: "alpha" });
    mockUpdate.mockResolvedValue({});
    mockCreate.mockResolvedValue({
      id: "new-ticket",
      userId: CUID_USER,
      type: "BUG",
      title: "T",
      description: "D",
      shortId: 1,
      ticketScopeKey: "proj-1",
      ticketKeyNumber: 1,
      screenshot: null,
      videoUrl: null,
      pageUrl: null,
      projectId: "proj-1",
      assigneeId: null,
      priority: null,
      storyPoints: null,
      status: "BACKLOG",
      user: { name: "Admin", email: "a@x.com" },
      project: { ticketKeyPrefix: "TST" },
    });

    const req = new NextRequest("http://localhost/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        type: "BUG",
        title: "T",
        description: "D",
        projectId: "proj-1",
        tagNames: ["Alpha"],
      }),
    });
    const res = await POST_CREATE(req);
    expect(res.status).toBe(201);
    expect(mockTagUpsert).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "new-ticket" },
        data: expect.objectContaining({
          tags: { set: [{ id: "tag-id-1" }] },
        }),
      })
    );
  });
});

describe("PATCH /api/tickets/[id]", () => {
  it("returns 403 when member tries triage fields", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockFindUnique.mockResolvedValue({
      id: CUID_TICKET,
      userId: CUID_USER,
      status: "BACKLOG",
      title: "T",
      type: "BUG",
      user: { email: "m@x.com", name: "M" },
      assignee: null,
    });

    const req = new NextRequest("http://localhost/api/tickets/x", {
      method: "PATCH",
      body: JSON.stringify({ status: "RESOLVED" }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: CUID_TICKET }) });
    expect(res.status).toBe(403);
  });

  it("allows admin to update status", async () => {
    mockGetSessionContext.mockResolvedValue(adminSession());
    mockFindUnique
      .mockResolvedValueOnce({
        id: CUID_TICKET,
        userId: "other-user",
        status: "BACKLOG",
        title: "T",
        type: "BUG",
        project: { teamId: "team-1", commandCenterProjectId: null },
        user: { email: "o@x.com", name: "O" },
        assignee: null,
      })
      .mockResolvedValueOnce({
        userId: "other-user",
        status: "BACKLOG",
      })
      .mockResolvedValueOnce({
        id: CUID_TICKET,
        userId: "other-user",
        status: "RESOLVED",
        title: "T",
        type: "BUG",
        ticketScopeKey: "proj-1",
        ticketKeyNumber: 1,
        user: { id: "other-user", name: "O", email: "o@x.com" },
        assignee: null,
        parent: null,
        project: { ticketKeyPrefix: "TST" },
        tags: [],
        duplicateOf: null,
        canonicalDuplicates: [],
        sprintTickets: [],
        _count: { comments: 0, canonicalDuplicates: 0 },
      });

    mockUpdate.mockResolvedValue({});

    const req = new NextRequest("http://localhost/api/tickets/x", {
      method: "PATCH",
      body: JSON.stringify({ status: "RESOLVED" }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: CUID_TICKET }) });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });
});

describe("POST /api/tickets/bulk", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetSessionContext.mockResolvedValue(null);
    const res = await POST_BULK(
      new NextRequest("http://localhost/api/tickets/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "archive", ticketIds: ["x"] }),
      })
    );
    expect(res.status).toBe(401);
  });
});

