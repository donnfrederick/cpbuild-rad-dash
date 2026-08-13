import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockTagFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    tag: {
      findMany: (...args: unknown[]) => mockTagFindMany(...args),
    },
  },
}));

const mockGetSessionContext = vi.fn();
vi.mock("@/lib/session-context", () => ({
  getSessionContext: () => mockGetSessionContext(),
}));

const mockGetCachedTagsCatalogBaseline = vi.fn();
vi.mock("@/lib/list-cache", () => ({
  getCachedTagsCatalogBaseline: () => mockGetCachedTagsCatalogBaseline(),
}));

const { GET } = await import("@/app/api/tags/route");

beforeEach(() => {
  vi.clearAllMocks();
});

const CUID_USER = "clqtestuser0000000000000001";

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

describe("GET /api/tags", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetSessionContext.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/tags"));
    expect(res.status).toBe(401);
    expect(mockTagFindMany).not.toHaveBeenCalled();
    expect(mockGetCachedTagsCatalogBaseline).not.toHaveBeenCalled();
  });

  it("uses DEFAULT_LIMIT of 20 when no limit param is provided", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockTagFindMany.mockResolvedValue([]);
    const res = await GET(new NextRequest("http://localhost/api/tags"));
    expect(res.status).toBe(200);
    expect(mockTagFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 })
    );
    expect(mockGetCachedTagsCatalogBaseline).not.toHaveBeenCalled();
  });

  it("clamps an over-max limit value to 500 and routes through the DB", async () => {
    mockGetSessionContext.mockResolvedValue(memberSession());
    mockTagFindMany.mockResolvedValue([]);
    // q is non-empty so the baseline fast-path is skipped even after clamping.
    const res = await GET(
      new NextRequest("http://localhost/api/tags?q=widget&limit=9999")
    );
    expect(res.status).toBe(200);
    expect(mockTagFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 })
    );
    expect(mockGetCachedTagsCatalogBaseline).not.toHaveBeenCalled();
  });

  describe("baseline fast-path (q === '' && limit === 500)", () => {
    it("calls getCachedTagsCatalogBaseline and skips DB when q is empty and limit equals MAX_LIMIT", async () => {
      mockGetSessionContext.mockResolvedValue(memberSession());
      const baselinePayload = {
        tags: [
          { id: "tag-1", name: "bug" },
          { id: "tag-2", name: "feature" },
        ],
      };
      mockGetCachedTagsCatalogBaseline.mockResolvedValue(baselinePayload);

      const res = await GET(
        new NextRequest("http://localhost/api/tags?limit=500")
      );
      expect(res.status).toBe(200);
      expect(mockGetCachedTagsCatalogBaseline).toHaveBeenCalledOnce();
      expect(mockTagFindMany).not.toHaveBeenCalled();
    });

    it("returns a payload shaped { tags: Array<{ id, name }> } from the baseline cache", async () => {
      mockGetSessionContext.mockResolvedValue(memberSession());
      const baselinePayload = {
        tags: [
          { id: "tag-1", name: "bug" },
          { id: "tag-2", name: "feature" },
        ],
      };
      mockGetCachedTagsCatalogBaseline.mockResolvedValue(baselinePayload);

      const res = await GET(
        new NextRequest("http://localhost/api/tags?limit=500")
      );
      const body = await res.json();
      expect(body).toEqual(baselinePayload);
      expect(body.tags).toHaveLength(2);
      expect(body.tags[0]).toMatchObject({ id: expect.any(String), name: expect.any(String) });
    });
  });

  describe("DB query path", () => {
    it("returns filtered tags when a search query is provided", async () => {
      mockGetSessionContext.mockResolvedValue(memberSession());
      const filtered = [{ id: "tag-3", name: "performance" }];
      mockTagFindMany.mockResolvedValue(filtered);

      const res = await GET(
        new NextRequest("http://localhost/api/tags?q=perf")
      );
      expect(res.status).toBe(200);
      expect(mockTagFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { contains: "perf", mode: "insensitive" } },
          orderBy: { name: "asc" },
          take: 20,
          select: { id: true, name: true },
        })
      );
      const body = await res.json();
      expect(body).toEqual({ tags: filtered });
    });

    it("omits the where clause when q is empty and the DB path is taken", async () => {
      mockGetSessionContext.mockResolvedValue(memberSession());
      mockTagFindMany.mockResolvedValue([]);
      // limit=10 → take=10; q=""; take≠MAX_LIMIT → DB path, no where filter
      const res = await GET(
        new NextRequest("http://localhost/api/tags?limit=10")
      );
      expect(res.status).toBe(200);
      expect(mockTagFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: undefined,
          take: 10,
        })
      );
    });

    it("trims whitespace from q before applying the search filter", async () => {
      mockGetSessionContext.mockResolvedValue(memberSession());
      mockTagFindMany.mockResolvedValue([]);
      const res = await GET(
        new NextRequest("http://localhost/api/tags?q=+bug+")
      );
      expect(res.status).toBe(200);
      // After trim the value is "bug", so the where clause must use that.
      expect(mockTagFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { contains: "bug", mode: "insensitive" } },
        })
      );
    });
  });
});
