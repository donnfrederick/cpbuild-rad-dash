import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { userCanViewTicket } from "@/lib/ticket-access";
import { parseImageAnnotation } from "@/lib/image-annotation-schema";

const PatchAttachmentSchema = z.object({
  imageAnnotation: z.unknown(),
});

type Params = { id: string; cid: string; attachmentId: string };

export async function PATCH(req: NextRequest, { params }: { params: Promise<Params> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: ticketId, cid: commentId, attachmentId } = await params;

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

  const comment = await db.ticketComment.findUnique({
    where: { id: commentId },
    select: { id: true, ticketId: true, deletedAt: true },
  });
  if (!comment || comment.ticketId !== ticketId || comment.deletedAt !== null) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  const attachment = await db.mediaAttachment.findUnique({
    where: { id: attachmentId },
    select: { id: true, ticketCommentId: true, mimeType: true },
  });
  if (!attachment || attachment.ticketCommentId !== commentId) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  if (!attachment.mimeType.startsWith("image/")) {
    return NextResponse.json({ error: "Only images can be annotated" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchAttachmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 422 });
  }

  const annotation = parseImageAnnotation(parsed.data.imageAnnotation);
  if (!annotation) {
    return NextResponse.json({ error: "Invalid annotation payload" }, { status: 400 });
  }

  const updated = await db.mediaAttachment.update({
    where: { id: attachmentId },
    data: {
      imageAnnotation: annotation,
      lastMarkedById: ctx.user.id,
      lastMarkedAt: new Date(),
    },
    select: {
      id: true,
      storageKey: true,
      storageUrl: true,
      mimeType: true,
      fileSizeBytes: true,
      caption: true,
      imageAnnotation: true,
      lastMarkedById: true,
      lastMarkedAt: true,
      lastMarkedBy: { select: { id: true, name: true, email: true } },
      createdAt: true,
    },
  });

  return NextResponse.json(updated);
}
