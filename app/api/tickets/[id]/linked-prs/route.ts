import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { userCanViewTicket } from "@/lib/ticket-access";
import { revalidateTicketsList } from "@/lib/list-cache";
import { buildGitHubPrUrl, parseGitHubPrUrl } from "@/lib/github-pr-url";

const postSchema = z.object({
  prUrl: z.string().min(1).max(2000),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: ticketId } = await params;

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, userId: true },
  });
  if (!ticket) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allowed = await userCanViewTicket({
    viewerId: ctx.user.id,
    role: ctx.user.role,
    ticket: { id: ticket.id, userId: ticket.userId },
    specialPermissions: ctx.user.specialPermissions,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const gh = parseGitHubPrUrl(parsed.data.prUrl);
  if (!gh) {
    return NextResponse.json({ error: "Invalid GitHub pull request URL" }, { status: 422 });
  }

  const prUrl = buildGitHubPrUrl(gh.repoOwner, gh.repoName, gh.prNumber);

  const row = await db.ticketLinkedPR.upsert({
    where: {
      ticketId_repoOwner_repoName_prNumber: {
        ticketId,
        repoOwner: gh.repoOwner,
        repoName: gh.repoName,
        prNumber: gh.prNumber,
      },
    },
    create: {
      ticketId,
      repoOwner: gh.repoOwner,
      repoName: gh.repoName,
      prNumber: gh.prNumber,
      prUrl,
    },
    update: {
      prUrl,
    },
    select: {
      id: true,
      repoOwner: true,
      repoName: true,
      prNumber: true,
      prUrl: true,
      prTitle: true,
      status: true,
      createdAt: true,
    },
  });

  revalidateTicketsList();

  return NextResponse.json({ linkedPR: row }, { status: 201 });
}
