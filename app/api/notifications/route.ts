import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";

/** GET /api/notifications — list the current user's notifications, newest first */
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const notifications = await db.notification.findMany({
    where: { userId: ctx.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      ticket: {
        select: {
          id: true,
          type: true,
          title: true,
          status: true,
          projectId: true,
        },
      },
    },
  });

  return NextResponse.json(
    notifications.map((n) => ({
      id: n.id,
      type: n.type,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
      ticket: n.ticket,
      actorName: n.actorName,
      mentionCommentId: n.mentionCommentId,
    }))
  );
}
