import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";

/** PATCH /api/notifications/[id] — mark one notification as read */
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await db.notification.findFirst({
    where: { id, userId: ctx.user.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.notification.update({
    where: { id },
    data: { read: true },
  });

  return NextResponse.json({ ok: true });
}
