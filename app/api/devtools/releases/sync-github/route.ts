import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdminWithSession } from "@/lib/devtools-auth";
import { inferRoute, inferCategory } from "@/lib/changelog-parser";

const REPO = "cp-build-dev-ops/command-center-reboot";
const GITHUB_API = "https://api.github.com";

interface GitHubPR {
  number: number;
  title: string;
  body: string | null;
  head: { ref: string };
  merged_at: string | null;
  html_url: string;
  user: { login: string } | null;
}

/** Extract bullet-point changes from the "## Summary" section of a PR body. */
function extractChanges(
  prNumber: number,
  title: string,
  branch: string,
  body: string | null
): Prisma.InputJsonValue {
  const lines = (body ?? "").split("\n");

  // Find the Summary section
  const summaryStart = lines.findIndex((l) => /^##\s+summary/i.test(l.trim()));
  const summaryEnd =
    summaryStart === -1
      ? -1
      : lines.findIndex((l, i) => i > summaryStart && /^##\s/.test(l.trim()));

  const slice =
    summaryStart === -1
      ? lines
      : lines.slice(summaryStart + 1, summaryEnd === -1 ? undefined : summaryEnd);

  const bullets = slice
    .map((l) => l.match(/^[-*]\s+(.+)/)?.[1]?.trim())
    .filter((b): b is string => !!b && b.length > 2)
    .slice(0, 6);

  if (bullets.length === 0) {
    // Fall back to the PR title as a single change
    return [
      {
        id: randomUUID(),
        description: title,
        route: inferRoute(branch, title),
        category: inferCategory(title),
      },
    ];
  }

  return bullets.map((description) => ({
    id: randomUUID(),
    description,
    route: inferRoute(branch, description),
    category: inferCategory(description),
  }));
}

/**
 * POST /api/devtools/releases/sync-github
 *
 * Fetches all merged PRs from GitHub API (using GITHUB_TOKEN) and upserts
 * them as Release records. Idempotent by prNumber. Returns a summary.
 *
 * Falls back to a 503 when GITHUB_TOKEN is not configured.
 */
export async function POST() {
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }

  const { guard } = await requireDevToolsAdminWithSession();
  if (guard) return guard;

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN is not set — add it to your Railway environment variables" },
      { status: 503 }
    );
  }

  const headers: HeadersInit = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Fetch merged PRs — paginate through up to 3 pages (300 PRs)
  const mergedPRs: GitHubPR[] = [];
  for (let page = 1; page <= 3; page++) {
    const url = `${GITHUB_API}/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
      return NextResponse.json(
        { error: `GitHub API error: ${res.status} ${res.statusText}` },
        { status: 502 }
      );
    }

    const page_prs: GitHubPR[] = await res.json();
    const merged = page_prs.filter((pr) => !!pr.merged_at);
    mergedPRs.push(...merged);

    // If we got fewer than 100, there are no more pages
    if (page_prs.length < 100) break;
  }

  if (mergedPRs.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0, total: 0 });
  }

  // Fetch existing prNumbers to avoid duplicate inserts
  const existingPrNumbers = new Set(
    (
      await db.release.findMany({
        select: { prNumber: true },
        where: { prNumber: { not: null } },
      })
    )
      .map((r) => r.prNumber)
      .filter(Boolean)
  );

  let imported = 0;
  let skipped = 0;

  for (const pr of mergedPRs) {
    if (existingPrNumbers.has(pr.number)) {
      skipped++;
      continue;
    }

    const branch = pr.head.ref;
    const title = `PR #${pr.number} — ${pr.title}`;
    const changes = extractChanges(pr.number, pr.title, branch, pr.body);

    await db.release.create({
      data: {
        title,
        prNumber: pr.number,
        branch,
        environment: "all",
        mergedAt: new Date(pr.merged_at!),
        changes: changes as Prisma.InputJsonValue,
      },
    });

    imported++;
  }

  return NextResponse.json({ imported, skipped, total: mergedPRs.length });
}
