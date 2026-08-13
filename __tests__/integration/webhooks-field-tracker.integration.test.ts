import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockTicketCreate = vi.fn();
const mockUserFindFirst = vi.fn();
const mockRevalidate = vi.fn();
const mockAllocateKey = vi.fn();
const mockTransaction = vi.fn(async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient));

// tx client passed into $transaction callbacks mirrors the mocked db.ticket.create
const txClient = {
  ticket: {
    create: (...args: unknown[]) => mockTicketCreate(...args),
  },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (fn: (tx: typeof txClient) => Promise<unknown>) => mockTransaction(fn),
    ticket: {
      create: (...args: unknown[]) => mockTicketCreate(...args),
    },
    user: {
      findFirst: (...args: unknown[]) => mockUserFindFirst(...args),
    },
  },
}));

vi.mock("@/lib/list-cache", () => ({
  revalidateTicketsList: () => mockRevalidate(),
}));

vi.mock("@/lib/ticket-key", () => ({
  allocateNewTicketKey: (...args: unknown[]) => mockAllocateKey(...args),
}));

const WEBHOOK_SECRET = "test-secret-abc";

function makeRequest(
  body: unknown,
  secret: string | null = WEBHOOK_SECRET
): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) {
    headers["authorization"] = `Bearer ${secret}`;
  }
  return new NextRequest("http://localhost:3003/api/webhooks/field-tracker", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const ADMIN_USER = { id: "admin-user-1" };

const VALID_PAYLOAD = {
  environment: "dev",
  feedbackItems: [
    {
      id: "feedback-abc",
      shortId: 42,
      type: "BUG",
      title: "Button is broken",
      description: "Clicking the submit button does nothing on the projects page.",
      screenshot: null,
      videoUrl: null,
      pageUrl: "https://app.example.com/en/projects",
      priority: "HIGH",
      submittedBy: "Phil Amour",
      createdAt: "2026-04-22T10:00:00.000Z",
    },
  ],
};

const CREATED_TICKET = { id: "ticket-1", shortId: 1001 };

describe("POST /api/webhooks/field-tracker", () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("FIELD_TRACKER_WEBHOOK_SECRET", WEBHOOK_SECRET);
    vi.stubEnv("BOOTSTRAP_ADMIN_EMAIL", "admin@example.com");

    mockTicketCreate.mockReset();
    mockUserFindFirst.mockReset();
    mockRevalidate.mockReset();
    mockAllocateKey.mockReset();
    mockTransaction.mockClear();

    mockUserFindFirst.mockResolvedValue(ADMIN_USER);
    mockTicketCreate.mockResolvedValue(CREATED_TICKET);
    mockAllocateKey.mockResolvedValue({ ticketScopeKey: "UN", ticketKeyNumber: 1 });

    const mod = await import("@/app/api/webhooks/field-tracker/route");
    POST = mod.POST;
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await POST(makeRequest(VALID_PAYLOAD, null));
    expect(res.status).toBe(401);
  });

  it("returns 401 when secret does not match", async () => {
    const res = await POST(makeRequest(VALID_PAYLOAD, "wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("returns 400 for malformed JSON", async () => {
    const req = new NextRequest("http://localhost:3003/api/webhooks/field-tracker", {
      method: "POST",
      headers: { authorization: `Bearer ${WEBHOOK_SECRET}`, "content-type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 422 for missing required fields", async () => {
    const res = await POST(makeRequest({ environment: "dev", feedbackItems: [] }));
    expect(res.status).toBe(422);
  });

  it("creates a ticket for each feedback item and returns 201", async () => {
    const res = await POST(makeRequest(VALID_PAYLOAD));
    expect(res.status).toBe(201);
    const body = await res.json() as { created: number; tickets: { id: string; shortId: number }[] };
    expect(body.created).toBe(1);
    expect(body.tickets).toHaveLength(1);
    expect(body.tickets[0]).toEqual(CREATED_TICKET);
  });

  it("does not use an interactive transaction when creating webhook tickets", async () => {
    const res = await POST(makeRequest(VALID_PAYLOAD));
    expect(res.status).toBe(201);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("passes correct data to db.ticket.create (dev environment, BUG type)", async () => {
    await POST(makeRequest(VALID_PAYLOAD));
    expect(mockTicketCreate).toHaveBeenCalledOnce();
    const callArg = mockTicketCreate.mock.calls[0][0] as {
      data: {
        type: string;
        title: string;
        source: string;
        environment: string;
        priority: string | null;
        status: string;
      };
    };
    expect(callArg.data.type).toBe("BUG");
    expect(callArg.data.title).toBe("Button is broken");
    expect(callArg.data.source).toBe("FIELD_TRACKER");
    expect(callArg.data.environment).toBe("dev");
    expect(callArg.data.priority).toBe("HIGH");
    expect(callArg.data.status).toBe("BACKLOG");
  });

  it("stores the field-tracker item id on the created ticket", async () => {
    await POST(makeRequest(VALID_PAYLOAD));
    expect(mockTicketCreate).toHaveBeenCalledOnce();
    const callArg = mockTicketCreate.mock.calls[0][0] as {
      data: { fieldTrackerItemId: string };
    };
    expect(callArg.data.fieldTrackerItemId).toBe("feedback-abc");
  });

  it("handles prod environment correctly", async () => {
    const payload = { ...VALID_PAYLOAD, environment: "prod" };
    const res = await POST(makeRequest(payload));
    expect(res.status).toBe(201);
    const callArg = mockTicketCreate.mock.calls[0][0] as { data: { environment: string; adminNote: string } };
    expect(callArg.data.environment).toBe("prod");
    expect(callArg.data.adminNote).toContain("production");
  });

  it("creates multiple tickets from multiple feedback items", async () => {
    mockTicketCreate
      .mockResolvedValueOnce({ id: "t-1", shortId: 1001 })
      .mockResolvedValueOnce({ id: "t-2", shortId: 1002 });

    const payload = {
      environment: "dev",
      feedbackItems: [
        { ...VALID_PAYLOAD.feedbackItems[0], id: "fb-1", shortId: 1 },
        {
          id: "fb-2",
          shortId: 2,
          type: "FEATURE_REQUEST",
          title: "Dark mode",
          description: "Please add dark mode to the dashboard.",
          screenshot: null,
          videoUrl: null,
          pageUrl: null,
          priority: null,
          submittedBy: "",
          createdAt: "2026-04-22T11:00:00.000Z",
        },
      ],
    };

    const res = await POST(makeRequest(payload));
    expect(res.status).toBe(201);
    const body = await res.json() as { created: number };
    expect(body.created).toBe(2);
    expect(mockTicketCreate).toHaveBeenCalledTimes(2);
  });

  it("accepts feedback item where all nullable fields are null (Unifier-style nulls)", async () => {
    const payload = {
      environment: "dev",
      feedbackItems: [
        {
          id: "fb-sparse",
          shortId: 99,
          type: "FEATURE_REQUEST",
          title: "Sparse feedback",
          description: "Only required fields are set.",
          screenshot: null,
          videoUrl: null,
          pageUrl: null,
          priority: null,
          submittedBy: "",
        },
      ],
    };
    const res = await POST(makeRequest(payload));
    expect(res.status).toBe(201);
  });

  it("returns 503 when no admin user is found in DB", async () => {
    mockUserFindFirst.mockResolvedValue(null);
    vi.stubEnv("BOOTSTRAP_ADMIN_EMAIL", "");
    const res = await POST(makeRequest(VALID_PAYLOAD));
    expect(res.status).toBe(503);
  });

  it("falls back to role-based admin lookup when BOOTSTRAP_ADMIN_EMAIL is not set", async () => {
    // When BOOTSTRAP_ADMIN_EMAIL is empty the email lookup is skipped entirely;
    // the role-based lookup is the first (and only) findFirst call.
    vi.stubEnv("BOOTSTRAP_ADMIN_EMAIL", "");
    mockUserFindFirst.mockResolvedValueOnce(ADMIN_USER);
    const res = await POST(makeRequest(VALID_PAYLOAD));
    expect(res.status).toBe(201);
    expect(mockUserFindFirst).toHaveBeenCalledTimes(1);
  });

  it("revalidates tickets list cache after creating tickets", async () => {
    await POST(makeRequest(VALID_PAYLOAD));
    expect(mockRevalidate).toHaveBeenCalledOnce();
  });

  it("returns 401 when FIELD_TRACKER_WEBHOOK_SECRET is not configured", async () => {
    vi.stubEnv("FIELD_TRACKER_WEBHOOK_SECRET", "");
    const res = await POST(makeRequest(VALID_PAYLOAD));
    expect(res.status).toBe(401);
  });
});
