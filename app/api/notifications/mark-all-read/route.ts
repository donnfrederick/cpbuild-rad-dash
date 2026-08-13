import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";

/** POST /api/notifications/mark-all-read — mark all as read for current user */
export async function POST() {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await db.notification.updateMany({
    where: { userId: ctx.user.id, read: false },
    data: { read: true },
  });

  return NextResponse.json({ ok: true });
}
