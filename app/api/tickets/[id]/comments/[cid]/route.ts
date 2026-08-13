import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { revalidateTicketsList } from "@/lib/list-cache";
import { getSessionContext } from "@/lib/session-context";
import { extractMentionIds } from "@/lib/mention-utils";
import { sendMentionEmail } from "@/lib/email";
import { createManyNotifications } from "@/lib/notifications";
import { userCanViewTicket } from "@/lib/ticket-access";
import { buildTicketDetailAppUrl } from "@/lib/ticket-urls";

const EDIT_WINDOW_MS = 30 * 60 * 1000;

const PatchCommentSchema = z.object({
  body: z.string().min(1).max(4000),
});

type Params = { id: string; cid: string };

export async function PATCH(req: NextRequest, { params }: { params: Promise<Params> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: ticketId, cid } = await params;

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, userId: true, projectId: true },
  });
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allowed = await userCanViewTicket({
    viewerId: ctx.user.id,
    role: ctx.user.role,
    ticket,
    specialPermissions: ctx.user.specialPermissions,
  });
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const comment = await db.ticketComment.findFirst({
    where: { id: cid, ticketId, deletedAt: null },
  });
  if (!comment) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

  if (comment.authorId !== ctx.user.id) {
    return NextResponse.json({ error: "You can only edit your own comments" }, { status: 403 });
  }

  const ageMs = Date.now() - comment.createdAt.getTime();
  if (ageMs > EDIT_WINDOW_MS) {
    return NextResponse.json(
      { error: "Comments can only be edited within 30 minutes of posting" },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = PatchCommentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 422 });
  }

  const newBody = parsed.data.body;
  const oldMentionIds = new Set(extractMentionIds(comment.body));
  const allMentionIds = extractMentionIds(newBody);
  const notifyUserIds = allMentionIds.filter((uid) => !oldMentionIds.has(uid));

  const authorUser = await db.user.findUnique({
    where: { id: ctx.user.id },
    select: { id: true, name: true, email: true },
  });
  const actorName = authorUser?.name ?? authorUser?.email ?? "Someone";

  const updated = await db.ticketComment.update({
    where: { id: cid },
    data: { body: newBody, editedAt: new Date() },
    include: {
      author: { select: { id: true, name: true, email: true } },
      attachments: true,
    },
  });

  if (allMentionIds.length > 0) {
    try {
      await db.$transaction(
        allMentionIds.map((uid) =>
          db.ticketMention.upsert({
            where: {
              ticketId_mentionedUserId: {
                ticketId,
                mentionedUserId: uid,
              },
            },
            create: {
              ticketId,
              mentionedUserId: uid,
              sourceCommentId: cid,
            },
            update: { sourceCommentId: cid },
          })
        )
      );
    } catch (err) {
      console.warn("[ticket mention upsert on PATCH]", err);
    }
  }

  if (notifyUserIds.length > 0) {
    void (async () => {
      try {
        const mentionedUsers = await db.user.findMany({
          where: { id: { in: notifyUserIds } },
          select: { id: true, name: true, email: true },
        });
        if (mentionedUsers.length === 0) return;

        await createManyNotifications(
          mentionedUsers.map((u) => ({
            userId: u.id,
            type: "MENTIONED_IN_COMMENT" as const,
            actorId: ctx.user.id,
            actorName,
            ticketId,
            mentionCommentId: cid,
          }))
        );

        const openUrl = buildTicketDetailAppUrl(ticketId, ticket.projectId);
        for (const u of mentionedUsers) {
          void sendMentionEmail({
            to: u.email,
            actorName,
            contextTitle: newBody.slice(0, 120),
            openUrl,
          }).catch((err: unknown) => console.warn("[mention-email edit]", err));
        }
      } catch (err) {
        console.warn("[mention-notify PATCH]", err);
      }
    })();
  }

  revalidateTicketsList();
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<Params> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: ticketId, cid } = await params;

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, userId: true },
  });
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allowed = await userCanViewTicket({
    viewerId: ctx.user.id,
    role: ctx.user.role,
    ticket,
    specialPermissions: ctx.user.specialPermissions,
  });
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const comment = await db.ticketComment.findFirst({
    where: { id: cid, ticketId },
  });
  if (!comment) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

  if (comment.authorId !== ctx.user.id) {
    return NextResponse.json({ error: "You can only delete your own comments" }, { status: 403 });
  }
  if (comment.deletedAt) {
    return NextResponse.json({ error: "Already deleted" }, { status: 409 });
  }

  await db.ticketComment.update({ where: { id: cid }, data: { deletedAt: new Date() } });
  revalidateTicketsList();
  return NextResponse.json({ deleted: true });
}
