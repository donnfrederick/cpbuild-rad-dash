import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/encrypt";
import { verifyGitHubWebhookSignature256 } from "@/lib/github-webhook-signature";
import { revalidateTicketsList } from "@/lib/list-cache";
import { dispatchTicketResolvedNotifications } from "@/lib/ticket-resolved-notifications";
import type { ChecksStatus, PRCommentType } from "@prisma/client";

interface GitHubUserPayload {
  login?: string | null;
  avatar_url?: string | null;
}

interface GitHubRepoPayload {
  owner?: { login?: string };
  name?: string;
}

interface GitHubPullRequestPayload {
  number?: number;
  merged?: boolean;
  title?: string | null;
}

interface GitHubCheckSuitePayload {
  status?: string | null;
  conclusion?: string | null;
  pull_requests?: Array<{ number?: number }>;
}

interface GitHubReviewPayload {
  id?: number;
  body?: string | null;
  state?: string | null;
  html_url?: string | null;
  submitted_at?: string | null;
  user?: GitHubUserPayload;
}

interface GitHubCommentPayload {
  id?: number;
  body?: string | null;
  html_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  user?: GitHubUserPayload;
}

interface GitHubIssuePayload {
  number?: number;
  pull_request?: unknown;
}

interface GitHubEventPayload {
  action?: string;
  repository?: GitHubRepoPayload;
  pull_request?: GitHubPullRequestPayload;
  check_suite?: GitHubCheckSuitePayload;
  review?: GitHubReviewPayload;
  comment?: GitHubCommentPayload;
  issue?: GitHubIssuePayload;
}

interface RepoIdentity {
  repoOwner: string;
  repoName: string;
}

function extractRepo(payload: GitHubEventPayload): RepoIdentity | null {
  const login = payload.repository?.owner?.login?.trim().toLowerCase();
  const name = payload.repository?.name?.trim().toLowerCase();
  if (!login || !name) return null;
  return { repoOwner: login, repoName: name };
}

/** Map a `check_suite` payload to our internal `ChecksStatus`. */
function mapCheckSuiteStatus(
  action: string | undefined,
  suite: GitHubCheckSuitePayload | undefined
): ChecksStatus | null {
  if (action === "requested" || action === "rerequested") {
    return "IN_PROGRESS";
  }
  if (action !== "completed") return null;
  const conclusion = suite?.conclusion?.toLowerCase() ?? null;
  if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped" || conclusion === "stale") {
    return "SUCCESS";
  }
  if (
    conclusion === "failure" ||
    conclusion === "cancelled" ||
    conclusion === "timed_out" ||
    conclusion === "action_required" ||
    conclusion === "startup_failure"
  ) {
    return "FAILURE";
  }
  return null;
}

async function handlePullRequest(
  payload: GitHubEventPayload,
  repo: RepoIdentity
): Promise<NextResponse> {
  const action = payload.action;
  const pr = payload.pull_request;
  const prNumber = pr?.number;
  if (typeof prNumber !== "number" || prNumber < 1) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const title = typeof pr?.title === "string" ? pr.title : null;
  const { repoOwner, repoName } = repo;

  if (action === "opened" || action === "reopened" || action === "synchronize") {
    await db.ticketLinkedPR.updateMany({
      where: { repoOwner, repoName, prNumber },
      data: { checksStatus: "IN_PROGRESS", prTitle: title },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "edited") {
    await db.ticketLinkedPR.updateMany({
      where: { repoOwner, repoName, prNumber },
      data: { prTitle: title },
    });
    return NextResponse.json({ ok: true });
  }

  if (action !== "closed") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const merged = pr?.merged === true;

  if (!merged) {
    await db.ticketLinkedPR.updateMany({
      where: { repoOwner, repoName, prNumber },
      data: { status: "CLOSED", prTitle: title },
    });
    revalidateTicketsList();
    return NextResponse.json({ ok: true });
  }

  const resolvedTicketIds = new Set<string>();

  await db.$transaction(async (tx) => {
    const links = await tx.ticketLinkedPR.findMany({
      where: { repoOwner, repoName, prNumber },
      select: { id: true, ticketId: true },
    });

    for (const link of links) {
      await tx.ticketLinkedPR.update({
        where: { id: link.id },
        data: { status: "MERGED", prTitle: title },
      });

      const remainingUnmerged = await tx.ticketLinkedPR.count({
        where: { ticketId: link.ticketId, status: { not: "MERGED" } },
      });
      if (remainingUnmerged > 0) continue;

      const t = await tx.ticket.findUnique({
        where: { id: link.ticketId },
        select: { status: true },
      });
      if (
        t &&
        t.status !== "RESOLVED" &&
        t.status !== "DONE" &&
        t.status !== "ARCHIVED"
      ) {
        await tx.ticket.update({
          where: { id: link.ticketId },
          data: { status: "RESOLVED" },
        });
        resolvedTicketIds.add(link.ticketId);
      }
    }
  });

  revalidateTicketsList();

  for (const tid of resolvedTicketIds) {
    void dispatchTicketResolvedNotifications(tid).catch((err: unknown) =>
      console.error("[webhooks/github] resolved notifications:", err)
    );
  }

  return NextResponse.json({ ok: true, resolvedTickets: resolvedTicketIds.size });
}

async function handleCheckSuite(
  payload: GitHubEventPayload,
  repo: RepoIdentity
): Promise<NextResponse> {
  const next = mapCheckSuiteStatus(payload.action, payload.check_suite);
  if (!next) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const prNumbers = (payload.check_suite?.pull_requests ?? [])
    .map((p) => p?.number)
    .filter((n): n is number => typeof n === "number" && n > 0);

  if (prNumbers.length === 0) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  await db.ticketLinkedPR.updateMany({
    where: {
      repoOwner: repo.repoOwner,
      repoName: repo.repoName,
      prNumber: { in: prNumbers },
    },
    data: { checksStatus: next },
  });

  return NextResponse.json({ ok: true });
}

/** Locate the matching linked PRs for a given repo + PR number. */
async function findLinkedPRsByNumber(
  repo: RepoIdentity,
  prNumber: number
): Promise<Array<{ id: string }>> {
  return db.ticketLinkedPR.findMany({
    where: { repoOwner: repo.repoOwner, repoName: repo.repoName, prNumber },
    select: { id: true },
  });
}

async function upsertCommentForLinks(args: {
  linkIds: string[];
  githubCommentId: bigint;
  commentType: PRCommentType;
  authorLogin: string;
  authorAvatarUrl: string | null;
  body: string;
  htmlUrl: string;
  reviewState: string | null;
  postedAt: Date;
}): Promise<void> {
  for (const linkedPRId of args.linkIds) {
    await db.ticketLinkedPRComment.upsert({
      where: {
        linkedPRId_githubCommentId_commentType: {
          linkedPRId,
          githubCommentId: args.githubCommentId,
          commentType: args.commentType,
        },
      },
      create: {
        linkedPRId,
        githubCommentId: args.githubCommentId,
        commentType: args.commentType,
        authorLogin: args.authorLogin,
        authorAvatarUrl: args.authorAvatarUrl,
        body: args.body,
        htmlUrl: args.htmlUrl,
        reviewState: args.reviewState,
        postedAt: args.postedAt,
      },
      update: {
        authorLogin: args.authorLogin,
        authorAvatarUrl: args.authorAvatarUrl,
        body: args.body,
        htmlUrl: args.htmlUrl,
        reviewState: args.reviewState,
      },
    });
  }
}

async function handlePullRequestReview(
  payload: GitHubEventPayload,
  repo: RepoIdentity
): Promise<NextResponse> {
  const action = payload.action;
  const review = payload.review;
  const prNumber = payload.pull_request?.number;
  const reviewId = review?.id;
  if (typeof prNumber !== "number" || typeof reviewId !== "number") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const links = await findLinkedPRsByNumber(repo, prNumber);
  if (links.length === 0) {
    return NextResponse.json({ ok: true });
  }
  const linkIds = links.map((l) => l.id);

  if (action === "dismissed") {
    await db.ticketLinkedPRComment.deleteMany({
      where: {
        linkedPRId: { in: linkIds },
        githubCommentId: BigInt(reviewId),
        commentType: "REVIEW",
      },
    });
    return NextResponse.json({ ok: true });
  }

  if (action !== "submitted" && action !== "edited") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const body = typeof review?.body === "string" ? review.body : "";
  // Reviews can have an empty body (e.g. "approved" with no comment); still record so
  // the approval/changes-requested signal is visible on the ticket.
  const reviewState = typeof review?.state === "string" ? review.state.toLowerCase() : null;
  const htmlUrl = typeof review?.html_url === "string" ? review.html_url : "";
  const submitted = review?.submitted_at ? new Date(review.submitted_at) : new Date();
  const authorLogin = review?.user?.login?.trim() ?? "unknown";
  const authorAvatarUrl = review?.user?.avatar_url?.trim() || null;

  await upsertCommentForLinks({
    linkIds,
    githubCommentId: BigInt(reviewId),
    commentType: "REVIEW",
    authorLogin,
    authorAvatarUrl,
    body,
    htmlUrl,
    reviewState,
    postedAt: submitted,
  });

  return NextResponse.json({ ok: true });
}

async function handleIssueComment(
  payload: GitHubEventPayload,
  repo: RepoIdentity
): Promise<NextResponse> {
  // `issue_comment` covers both Issues and PRs. The `issue.pull_request` field
  // is only present when the comment was posted on a pull request.
  if (!payload.issue?.pull_request) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const action = payload.action;
  const prNumber = payload.issue.number;
  const comment = payload.comment;
  const commentId = comment?.id;
  if (typeof prNumber !== "number" || typeof commentId !== "number") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const links = await findLinkedPRsByNumber(repo, prNumber);
  if (links.length === 0) {
    return NextResponse.json({ ok: true });
  }
  const linkIds = links.map((l) => l.id);

  if (action === "deleted") {
    await db.ticketLinkedPRComment.deleteMany({
      where: {
        linkedPRId: { in: linkIds },
        githubCommentId: BigInt(commentId),
        commentType: "ISSUE_COMMENT",
      },
    });
    return NextResponse.json({ ok: true });
  }

  if (action !== "created" && action !== "edited") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const body = typeof comment?.body === "string" ? comment.body : "";
  const htmlUrl = typeof comment?.html_url === "string" ? comment.html_url : "";
  const postedAt = comment?.created_at ? new Date(comment.created_at) : new Date();
  const authorLogin = comment?.user?.login?.trim() ?? "unknown";
  const authorAvatarUrl = comment?.user?.avatar_url?.trim() || null;

  await upsertCommentForLinks({
    linkIds,
    githubCommentId: BigInt(commentId),
    commentType: "ISSUE_COMMENT",
    authorLogin,
    authorAvatarUrl,
    body,
    htmlUrl,
    reviewState: null,
    postedAt,
  });

  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const event = req.headers.get("x-github-event");
  const sig = req.headers.get("x-hub-signature-256");

  let payload: GitHubEventPayload;
  try {
    payload = JSON.parse(rawBody) as GitHubEventPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const repo = extractRepo(payload);
  if (!repo) {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  const config = await db.projectGithubConfig.findUnique({
    where: {
      repoOwner_repoName: {
        repoOwner: repo.repoOwner,
        repoName: repo.repoName,
      },
    },
    select: { webhookSecretEncrypted: true },
  });

  if (!config) {
    return NextResponse.json({ error: "Repository not configured" }, { status: 404 });
  }

  let secret: string;
  try {
    secret = decrypt(config.webhookSecretEncrypted);
  } catch (err) {
    console.error("[webhooks/github] decrypt failed:", err);
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (!verifyGitHubWebhookSignature256(rawBody, sig, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (event === "ping") {
    return NextResponse.json({ ok: true });
  }

  switch (event) {
    case "pull_request":
      return handlePullRequest(payload, repo);
    case "check_suite":
      return handleCheckSuite(payload, repo);
    case "pull_request_review":
      return handlePullRequestReview(payload, repo);
    case "issue_comment":
      return handleIssueComment(payload, repo);
    default:
      return NextResponse.json({ ok: true, ignored: true });
  }
}
