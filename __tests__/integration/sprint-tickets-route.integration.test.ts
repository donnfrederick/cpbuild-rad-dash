import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockSprintFindUnique = vi.fn();
const mockSprintFindMany = vi.fn();
const mockSprintTicketCreateMany = vi.fn();
const mockSprintTicketDeleteMany = vi.fn();
const mockTicketFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    sprint: {
      findUnique: (...args: unknown[]) => mockSprintFindUnique(...args),
      findMany: (...args: unknown[]) => mockSprintFindMany(...args),
    },
    sprintTicket: {
      createMany: (...args: unknown[]) => mockSprintTicketCreateMany(...args),
      deleteMany: (...args: unknown[]) => mockSprintTicketDeleteMany(...args),
    },
    ticket: {
      findMany: (...args: unknown[]) => mockTicketFindMany(...args),
    },
  },
}));

const mockGetSessionContext = vi.fn();
vi.mock("@/lib/session-context", () => ({
  getSessionContext: () => mockGetSessionContext(),
}));

vi.mock("@/lib/list-cache", () => ({
  revalidateTicketsList: vi.fn(),
}));

const { POST, DELETE } = await import("@/app/api/sprints/[id]/tickets/route");

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

beforeEach(() => {
  vi.clearAllMocks();
  mockSprintFindMany.mockResolvedValue([]);
});

describe("POST /api/sprints/[id]/tickets", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetSessionContext.mockResolvedValue(null);
    const res = await POST(
      new NextRequest("http://localhost/api/sprints/s1/tickets", {
        method: "POST",
        body: JSON.stringify({ ticketIds: ["t1"] }),
      }),
      { params: Promise.resolve({ id: "s1" }) }
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for member", async () => {
    mockGetSessionContext.mockResolvedValue({
      user: {
        id: "u1",
        email: "m@x.com",
        name: "M",
        role: "MEMBER",
        specialPermissions: [] as string[],
      },
    });
    const res = await POST(
      new NextRequest("http://localhost/api/sprints/s1/tickets", {
        method: "POST",
        body: JSON.stringify({ ticketIds: ["t1"] }),
      }),
      { params: Promise.resolve({ id: "s1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("allows adding tickets to a sprint with no prior explicit ticket rows", async () => {
    mockGetSessionContext.mockResolvedValue(triageSession());
    mockSprintFindUnique.mockResolvedValue({ id: "s1" });
    mockTicketFindMany.mockResolvedValue([{ id: "t1", projectId: null }]);
    mockSprintTicketCreateMany.mockResolvedValue({ count: 1 });

    const res = await POST(
      new NextRequest("http://localhost/api/sprints/s1/tickets", {
        method: "POST",
        body: JSON.stringify({ ticketIds: ["t1"] }),
      }),
      { params: Promise.resolve({ id: "s1" }) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; added: number };
    expect(body.ok).toBe(true);
    expect(body.added).toBe(1);
  });

  it("returns 200 and createMany when adding a ticket to a sprint", async () => {
    mockGetSessionContext.mockResolvedValue(triageSession());
    mockSprintFindUnique.mockResolvedValue({ id: "s1" });
    mockTicketFindMany.mockResolvedValue([{ id: "t-new", projectId: "p1" }]);
    mockSprintTicketCreateMany.mockResolvedValue({ count: 1 });

    const res = await POST(
      new NextRequest("http://localhost/api/sprints/s1/tickets", {
        method: "POST",
        body: JSON.stringify({ ticketIds: ["t-new"] }),
      }),
      { params: Promise.resolve({ id: "s1" }) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; added: number };
    expect(body.ok).toBe(true);
    expect(body.added).toBe(1);
    expect(mockSprintTicketCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [{ sprintId: "s1", ticketId: "t-new" }],
        skipDuplicates: true,
      })
    );
  });
});

describe("DELETE /api/sprints/[id]/tickets", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetSessionContext.mockResolvedValue(null);
    const res = await DELETE(
      new NextRequest("http://localhost/api/sprints/s1/tickets", {
        method: "DELETE",
        body: JSON.stringify({ ticketIds: ["t1"] }),
      }),
      { params: Promise.resolve({ id: "s1" }) }
    );
    expect(res.status).toBe(401);
  });

  it("removes tickets from sprint when triage", async () => {
    mockGetSessionContext.mockResolvedValue(triageSession());
    mockSprintFindUnique.mockResolvedValue({ id: "s1" });
    mockSprintTicketDeleteMany.mockResolvedValue({ count: 1 });

    const res = await DELETE(
      new NextRequest("http://localhost/api/sprints/s1/tickets", {
        method: "DELETE",
        body: JSON.stringify({ ticketIds: ["t1"] }),
      }),
      { params: Promise.resolve({ id: "s1" }) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; removed: number };
    expect(body.ok).toBe(true);
    expect(body.removed).toBe(1);
    expect(mockSprintTicketDeleteMany).toHaveBeenCalledWith({
      where: { sprintId: "s1", ticketId: { in: ["t1"] } },
    });
  });
});
