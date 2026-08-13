import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCachedTagsCatalogBaseline } from "@/lib/list-cache";
import { getSessionContext } from "@/lib/session-context";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 500;

function parseLimit(raw: string | null): number {
  if (raw == null || raw === "") return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, n));
}

export async function GET(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const take = parseLimit(req.nextUrl.searchParams.get("limit"));

  if (q === "" && take === MAX_LIMIT) {
    const data = await getCachedTagsCatalogBaseline();
    return NextResponse.json(data);
  }

  const tags = await db.tag.findMany({
    where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
    orderBy: { name: "asc" },
    take,
    select: { id: true, name: true },
  });

  return NextResponse.json({ tags });
}
