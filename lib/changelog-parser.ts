/**
 * changelog-parser.ts
 *
 * Parses CHANGELOG.md into structured Release objects suitable for inserting
 * into the `releases` table. Used by the DevTools "Sync from CHANGELOG" feature.
 *
 * Expected CHANGELOG format:
 *   ## [Merged] branch-name — YYYY-MM-DD · PR #N
 *   - Bullet point description
 *   - Another bullet
 *
 * Also handles [In Progress] entries (treated as environment: "development").
 */

import { randomUUID } from "crypto";

export interface ParsedReleaseChange {
  id: string;
  description: string;
  route: string;
  category: string;
}

export interface ParsedRelease {
  title: string;
  prNumber: number | null;
  branch: string | null;
  environment: "development" | "staging" | "production" | "all";
  mergedAt: Date;
  changes: ParsedReleaseChange[];
}

/** Lines that are structural (not actual change bullets). */
const SKIP_LINE_PATTERNS = [
  /^\*\*Branch:\*\*/,
  /^\*\*PR #/,
  /^###\s/,
  /^---/,
  /^>\s/,
  /^\s*$/,
];

function shouldSkipLine(line: string): boolean {
  return SKIP_LINE_PATTERNS.some((re) => re.test(line));
}

/**
 * Infer a navigation route from a branch name or change description.
 * Returns an empty string when no obvious route can be determined.
 */
export function inferRoute(branch: string | null, description: string): string {
  const haystack = `${branch ?? ""} ${description}`.toLowerCase();

  if (haystack.includes("unit") && haystack.includes("modal")) return "/projects";
  if (haystack.includes("unit-card") || haystack.includes("unit card")) return "/projects";
  if (haystack.includes("unit")) return "/projects";
  if (haystack.includes("project-hub") || haystack.includes("projects page") || haystack.includes("project card")) return "/projects";
  if (haystack.includes("project")) return "/projects";
  if (haystack.includes("user") || haystack.includes("team") || haystack.includes("invite")) return "/users";
  if (haystack.includes("feedback")) return "/feedback";
  if (haystack.includes("login") || haystack.includes("auth") || haystack.includes("password")) return "/login";
  if (haystack.includes("dashboard")) return "/";
  if (haystack.includes("mobile") || haystack.includes("nav")) return "/";

  return "";
}

/**
 * Infer a category label from a description string.
 */
export function inferCategory(description: string): string {
  const d = description.toLowerCase();
  if (d.includes("fix:") || d.startsWith("fix ")) return "bug-fix";
  if (d.includes("feature:") || d.startsWith("feature ")) return "feature";
  if (d.includes("database") || d.includes("migration") || d.includes("prisma") || d.includes("schema")) return "database";
  if (d.includes("api") || d.includes("route")) return "api";
  if (d.includes("test") || d.includes("coverage")) return "testing";
  if (d.includes("doc") || d.includes("readme") || d.includes("changelog")) return "docs";
  if (d.includes("devtools") || d.includes("dev tools")) return "devtools";
  if (d.includes("mobile") || d.includes("responsive") || d.includes("nav")) return "ui";
  return "feature";
}

/**
 * Parse a raw CHANGELOG.md string into an array of ParsedRelease objects.
 * Only returns `[Merged]` entries by default; pass `includeInProgress: true`
 * to also return in-progress entries (treated as environment: "development").
 */
export function parseChangelog(
  content: string,
  opts: { includeInProgress?: boolean } = {}
): ParsedRelease[] {
  const { includeInProgress = false } = opts;
  const releases: ParsedRelease[] = [];

  // Split on H2 headings (##)
  const sections = content.split(/^## /m).slice(1); // drop the preamble

  for (const section of sections) {
    const lines = section.split("\n");
    const heading = lines[0].trim();

    // Match: [Merged] branch — YYYY-MM-DD · PR #N
    // or:    [In Progress] branch — YYYY-MM-DD
    const mergedMatch = heading.match(
      /^\[Merged\]\s+(.+?)\s+[—–-]+\s+(\d{4}-\d{2}-\d{2})\s*[·•]?\s*PR\s*#(\d+)/i
    );
    const inProgressMatch = includeInProgress
      ? heading.match(/^\[In Progress\]\s+(.+?)\s+[—–-]+\s+(\d{4}-\d{2}-\d{2})/)
      : null;

    const match = mergedMatch ?? inProgressMatch;
    if (!match) continue;

    const branch = match[1].trim();
    const dateStr = match[2];
    const prNumber = mergedMatch ? parseInt(match[3], 10) : null;
    const isMerged = !!mergedMatch;

    const mergedAt = new Date(`${dateStr}T12:00:00Z`);
    if (isNaN(mergedAt.getTime())) continue;

    // Collect bullet points as change items
    const changes: ParsedReleaseChange[] = [];
    for (let i = 1; i < lines.length; i++) {
      const raw = lines[i];

      // Stop only at the next H2 heading (which starts a new release entry).
      // H3 (### SubSection) lines are skipped below via shouldSkipLine, not a break.
      if (/^## /.test(raw)) break;

      if (shouldSkipLine(raw)) continue;

      // Extract bullet text (- text or * text)
      const bulletMatch = raw.match(/^[-*]\s+(.+)/);
      if (!bulletMatch) continue;

      const description = bulletMatch[1].trim();
      if (!description) continue;

      changes.push({
        id: randomUUID(),
        description,
        route: inferRoute(branch, description),
        category: inferCategory(description),
      });
    }

    // Build a clean title from branch name
    const title = branch
      .replace(/^(feat|fix|chore|docs|refactor|test)\//i, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();

    releases.push({
      title: prNumber ? `PR #${prNumber} — ${title}` : title,
      prNumber,
      branch,
      environment: isMerged ? "all" : "development",
      mergedAt,
      changes,
    });
  }

  return releases;
}
