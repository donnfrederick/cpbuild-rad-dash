import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { PERMISSIONS } from "@/lib/permissions-core";

/** GET /api/users — list users (super-admin only, requires ACCESS_ALL_TEAMS) */
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!ctx.user.specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await db.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      createdAt: true,
      role: { select: { id: true, code: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    users: users.map((u) => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
    })),
  });
}
