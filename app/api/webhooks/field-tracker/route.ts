import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { revalidateTicketsList } from "@/lib/list-cache";
import { allocateNewTicketKey } from "@/lib/ticket-key";

const feedbackItemSchema = z.object({
  id: z.string().min(1),
  shortId: z.number().int().positive(),
  type: z.enum(["BUG", "FEATURE_REQUEST"]),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(4000),
  screenshot: z.string().optional().nullable(),
  videoUrl: z.string().optional().nullable(),
  pageUrl: z.string().optional().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable().optional(),
  submittedBy: z.string().optional().default(""),
  createdAt: z.string().optional()
});

const webhookPayloadSchema = z.object({
  environment: z.enum(["dev", "prod"]),
  projectId: z.string().optional().nullable(),
  feedbackItems: z.array(feedbackItemSchema).min(1).max(50),
});

export type FieldTrackerWebhookPayload = z.infer<typeof webhookPayloadSchema>;
export type FieldTrackerWebhookResult = {
  created: number;
  tickets: Array<{ id: string; shortId: number }>;
};

function getWebhookSecret(): string | undefined {
  return process.env.FIELD_TRACKER_WEBHOOK_SECRET;
}

function verifySecret(req: NextRequest): boolean {
  const secret = getWebhookSecret();
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  const [scheme, token] = auth.split(" ");
  return scheme === "Bearer" && token === secret;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifySecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = webhookPayloadSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { environment, projectId, feedbackItems } = parsed.data;

  // Find the bootstrap admin to act as ticket author for webhook-created tickets.
  const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
  let authorId: string | null = null;
  if (bootstrapEmail) {
    const admin = await db.user.findFirst({
      where: { email: bootstrapEmail },
      select: { id: true },
    });
    authorId = admin?.id ?? null;
  }
  if (!authorId) {
    const fallbackAdmin = await db.user.findFirst({
      where: { role: { code: "ADMIN" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true },
    });
    authorId = fallbackAdmin?.id ?? null;
  }
  if (!authorId) {
    return NextResponse.json(
      { error: "No admin user found — cannot attribute webhook tickets" },
      { status: 503 }
    );
  }

  const created: Array<{ id: string; shortId: number }> = [];

  for (const item of feedbackItems) {
    const note = [
      `Imported from Field Tracker (${environment === "prod" ? "production" : "development"})`,
      `Original ID: FB-${String(item.shortId).padStart(4, "0")}`,
      item.submittedBy ? `Submitted by: ${item.submittedBy}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    // allocateNewTicketKey is already atomic at the SQL level. Avoid Prisma
    // interactive transactions here because Railway can drop those connections.
    const { ticketScopeKey, ticketKeyNumber } = await allocateNewTicketKey(db, projectId ?? null);
    const ticket = await db.ticket.create({
      data: {
        userId: authorId,
        type: item.type,
        title: item.title,
        description: item.description,
        screenshot: item.screenshot ?? null,
        videoUrl: item.videoUrl ?? null,
        pageUrl: item.pageUrl ?? null,
        priority: item.priority ?? null,
        source: "FIELD_TRACKER",
        environment,
        adminNote: note,
        status: "BACKLOG",
        projectId: projectId ?? null,
        fieldTrackerItemId: item.id,
        ticketScopeKey,
        ticketKeyNumber,
      },
      select: { id: true, shortId: true },
    });

    created.push({ id: ticket.id, shortId: ticket.shortId });
  }

  revalidateTicketsList();

  return NextResponse.json(
    { created: created.length, tickets: created },
    { status: 201 }
  );
}
