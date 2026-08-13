import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { revalidateTicketsList } from "@/lib/list-cache";
import { getSessionContext } from "@/lib/session-context";
import { extractMentionIds } from "@/lib/mention-utils";
import { sendMentionEmail } from "@/lib/email";
import { createManyNotifications } from "@/lib/notifications";
import { userCanViewTicket, hasTicketTriageAccess } from "@/lib/ticket-access";
import { assertTicketCommentAttachmentKeys } from "@/lib/ticket-comment-attachments";
import { buildTicketDetailAppUrl } from "@/lib/ticket-urls";
import { buildTicketRefFromParts } from "@/lib/ticket-display-ref";

const CreateCommentSchema = z
  .object({
    body: z.string().max(4000),
    attachmentKeys: z.array(z.string()).max(10).default([]),
    attachmentUrls: z.array(z.string()).max(10).default([]),
    attachmentMimeTypes: z.array(z.string()).max(10).default([]),
    attachmentFileSizeBytes: z.array(z.number().int().positive()).max(10).default([]),
    attachmentCaptions: z.array(z.string()).max(10).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.body.trim().length === 0 && data.attachmentKeys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Comment body or at least one attachment is required",
        path: ["body"],
      });
    }
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

  const isTriage = hasTicketTriageAccess(ctx.user.role, ctx.user.specialPermissions);

  // Only triage users see comments aggregated from linked duplicate tickets.
  // Non-triage users see only comments on the canonical ticket they own.
  const linkedDuplicates = isTriage
    ? await db.ticketDuplicate.findMany({
        where: { canonicalId: ticketId },
        select: {
          duplicateId: true,
          duplicate: {
            select: {
              id: true,
              shortId: true,
              title: true,
              ticketScopeKey: true,
              ticketKeyNumber: true,
              project: { select: { ticketKeyPrefix: true } },
            },
          },
        },
      })
    : [];

  const dupInfoById = new Map(
    linkedDuplicates.map((row) => {
      const d = row.duplicate;
      return [
        row.duplicateId,
        {
          id: d.id,
          shortId: d.shortId,
          ref: buildTicketRefFromParts(d.ticketScopeKey, d.ticketKeyNumber, d.project?.ticketKeyPrefix),
          title: d.title,
        },
      ] as const;
    })
  );
  const ticketIds = [ticketId, ...linkedDuplicates.map((row) => row.duplicateId)];

  const rows = await db.ticketComment.findMany({
    where: { ticketId: { in: ticketIds }, deletedAt: null },
    include: {
      author: { select: { id: true, name: true, email: true } },
      attachments: {
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
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const comments = rows.map((row) => {
    const isFromDuplicate = row.ticketId !== ticketId;
    const originTicket = isFromDuplicate ? dupInfoById.get(row.ticketId) ?? null : null;
    return { ...row, originTicket };
  });

  return NextResponse.json({ comments });
}

export async function POST(req: NextRequest, { params }: { params: Promise<Params> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: ticketId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = CreateCommentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 422 });
  }

  const {
    body: commentBody,
    attachmentKeys,
    attachmentUrls,
    attachmentMimeTypes,
    attachmentFileSizeBytes,
    attachmentCaptions,
  } = parsed.data;

  const keyErr = assertTicketCommentAttachmentKeys(attachmentKeys);
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

  const authorUser = await db.user.findUnique({
    where: { id: ctx.user.id },
    select: { id: true, name: true, email: true },
  });
  if (!authorUser) {
    return NextResponse.json({ error: "User not found" }, { status: 500 });
  }
  const actorName = authorUser.name ?? authorUser.email ?? "Someone";

  const bodyTrimmed = commentBody.trim();

  try {
    const comment = await db.ticketComment.create({
      data: {
        ticketId,
        authorId: ctx.user.id,
        body: bodyTrimmed,
        attachments: {
          create: attachmentKeys.map((key, i) => ({
            storageKey: key,
            storageUrl: attachmentUrls[i] ?? "",
            mimeType: attachmentMimeTypes[i] ?? "application/octet-stream",
            fileSizeBytes: attachmentFileSizeBytes[i] ?? null,
            caption: attachmentCaptions[i] ?? null,
            uploadedById: ctx.user.id,
          })),
        },
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
        attachments: {
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
          },
        },
      },
    });

    const mentionedIds = extractMentionIds(bodyTrimmed);
    if (mentionedIds.length > 0) {
      const mentionedUsers = await db.user.findMany({
        where: { id: { in: mentionedIds } },
        select: { id: true, name: true, email: true },
      });
      if (mentionedUsers.length > 0) {
        await db.$transaction(
          mentionedUsers.map((u) =>
            db.ticketMention.upsert({
              where: {
                ticketId_mentionedUserId: {
                  ticketId,
                  mentionedUserId: u.id,
                },
              },
              create: {
                ticketId,
                mentionedUserId: u.id,
                sourceCommentId: comment.id,
              },
              update: { sourceCommentId: comment.id },
            })
          )
        );
      }

      void (async () => {
        try {
          const mu = await db.user.findMany({
            where: { id: { in: mentionedIds } },
            select: { id: true, name: true, email: true },
          });
          if (mu.length === 0) return;

          await createManyNotifications(
            mu.map((u) => ({
              userId: u.id,
              type: "MENTIONED_IN_COMMENT" as const,
              actorId: ctx.user.id,
              actorName,
              ticketId,
              mentionCommentId: comment.id,
            }))
          );

          const openUrl = buildTicketDetailAppUrl(ticketId, ticket.projectId);
          for (const u of mu) {
            void sendMentionEmail({
              to: u.email,
              actorName,
              contextTitle: bodyTrimmed.slice(0, 120) || "Attachment",
              openUrl,
            }).catch((err: unknown) => console.warn("[mention-email]", err));
          }
        } catch (err) {
          console.warn("[mention-notify]", err);
        }
      })();
    }

    revalidateTicketsList();
    return NextResponse.json(comment, { status: 201 });
  } catch (err) {
    console.error("[tickets comments POST]", err);
    return NextResponse.json({ error: "Failed to create comment" }, { status: 500 });
  }
}
