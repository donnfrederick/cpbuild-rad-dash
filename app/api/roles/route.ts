import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";

/** GET /api/roles — MEMBER/ADMIN role options (ADMIN only). */
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const roles = await db.role.findMany({
    where: { code: { in: ["ADMIN", "MEMBER"] } },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ roles });
}
