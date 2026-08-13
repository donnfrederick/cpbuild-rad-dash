import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { userCanViewTicket } from "@/lib/ticket-access";
import { assertTicketAttachmentKeys } from "@/lib/ticket-attachments";

const MAX_ATTACHMENTS = 10;

const CreateAttachmentsSchema = z.object({
  attachmentKeys: z.array(z.string()).min(1).max(MAX_ATTACHMENTS),
  attachmentUrls: z.array(z.string()).max(MAX_ATTACHMENTS).default([]),
  attachmentMimeTypes: z.array(z.string()).max(MAX_ATTACHMENTS).default([]),
  attachmentFileSizeBytes: z.array(z.number().int().positive()).max(MAX_ATTACHMENTS).default([]),
  attachmentCaptions: z.array(z.string()).max(MAX_ATTACHMENTS).default([]),
});

type Params = { id: string };

async function loadTicketForAccess(ticketId: string) {
  return db.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, userId: true, projectId: true },
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<Params> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: ticketId } = await params;

  const ticket = await loadTicketForAccess(ticketId);
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allowed = await userCanViewTicket({
    viewerId: ctx.user.id,
    role: ctx.user.role,
    ticket,
    specialPermissions: ctx.user.specialPermissions,
  });
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const attachments = await db.mediaAttachment.findMany({
    where: { ticketId },
    orderBy: { createdAt: "asc" },
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
      uploadedBy: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ attachments });
}

export async function POST(req: NextRequest, { params }: { params: Promise<Params> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: ticketId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = CreateAttachmentsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 422 });
  }

  const {
    attachmentKeys,
    attachmentUrls,
    attachmentMimeTypes,
    attachmentFileSizeBytes,
    attachmentCaptions,
  } = parsed.data;

  const keyErr = assertTicketAttachmentKeys(attachmentKeys);
  if (keyErr) {
    return NextResponse.json({ error: keyErr }, { status: 400 });
  }

  const ticket = await loadTicketForAccess(ticketId);
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allowed = await userCanViewTicket({
    viewerId: ctx.user.id,
    role: ctx.user.role,
    ticket,
    specialPermissions: ctx.user.specialPermissions,
  });
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const attachments = await db.$transaction(
      attachmentKeys.map((key, i) =>
        db.mediaAttachment.create({
          data: {
            ticketId,
            storageKey: key,
            storageUrl: attachmentUrls[i] ?? "",
            mimeType: attachmentMimeTypes[i] ?? "application/octet-stream",
            fileSizeBytes: attachmentFileSizeBytes[i] ?? null,
            caption: attachmentCaptions[i] ?? null,
            uploadedById: ctx.user.id,
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
            uploadedBy: { select: { id: true, name: true, email: true } },
          },
        })
      )
    );

    return NextResponse.json({ attachments }, { status: 201 });
  } catch (err) {
    console.error("[ticket attachments POST]", err);
    return NextResponse.json({ error: "Failed to create attachments" }, { status: 500 });
  }
}
