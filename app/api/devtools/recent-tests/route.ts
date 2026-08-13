/**
 * GET /api/devtools/recent-tests?since=commitHash&commits=5
 *
 * Dev-only. Returns test files that have been added or modified recently.
 * Uses git to find changes. Helps you see "what's new" since last run.
 *
 * Query params:
 *   since  — (optional) Git commit hash to compare against. If omitted, uses last N commits.
 *   commits — (optional) Number of commits to look back when since is not provided. Default 10.
 *
 * Returns: { files: string[], currentCommit: string, sinceCommit?: string }
 */

import { NextResponse } from "next/server";
import { execSync, execFileSync } from "child_process";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdmin } from "@/lib/devtools-auth";
const PROJECT_ROOT = process.cwd();

function isTestFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.includes("__tests__/") && (normalized.includes(".test.") || normalized.includes(".spec."))) return true;
  if (normalized.includes("e2e/") && (normalized.endsWith(".spec.ts") || normalized.endsWith(".spec.tsx"))) return true;
  return false;
}

function getCurrentCommit(): string {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
    }).trim();
  } catch {
    return "";
  }
}

function getChangedTestFiles(sinceCommit: string): string[] {
  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-only", sinceCommit, "HEAD"],
      { cwd: PROJECT_ROOT, encoding: "utf-8" }
    );
    const files = output
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean)
      .filter(isTestFile);
    return [...new Set(files)];
  } catch {
    return [];
  }
}

function getTestFilesFromRecentCommits(n: number): string[] {
  try {
    const output = execFileSync(
      "git",
      ["log", `-${n}`, "--name-only", "--pretty=format:"],
      { cwd: PROJECT_ROOT, encoding: "utf-8" }
    );
    const files = output
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean)
      .filter(isTestFile);
    return [...new Set(files)];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  if (!isDevToolsAllowed()) {
    return NextResponse.json(
      { error: DEVTOOLS_BLOCKED_MESSAGE },
      { status: 403 }
    );
  }

  const authError = await requireDevToolsAdmin();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const since = searchParams.get("since")?.trim();
  const commitsParam = searchParams.get("commits");
  const commits = Math.min(50, Math.max(1, parseInt(commitsParam ?? "10", 10) || 10));

  // Validate 'since' is a valid git commit hash (7–40 hex chars) to prevent injection
  const GIT_HASH_REGEX = /^[0-9a-f]{7,40}$/i;
  if (since && !GIT_HASH_REGEX.test(since)) {
    return NextResponse.json(
      { error: "Invalid 'since' parameter. Must be a valid git commit hash." },
      { status: 400 }
    );
  }

  const currentCommit = getCurrentCommit();
  if (!currentCommit) {
    return NextResponse.json({
      files: [],
      currentCommit: "",
      hint: "Not a git repository or git not available.",
    });
  }

  let files: string[];
  let sinceCommit: string | undefined;

  if (since) {
    sinceCommit = since;
    files = getChangedTestFiles(since);
  } else {
    files = getTestFilesFromRecentCommits(commits);
  }

  return NextResponse.json({
    files,
    currentCommit,
    sinceCommit,
    commits: since ? undefined : commits,
    hint: since
      ? `Tests changed since commit ${since.slice(0, 7)}. Store currentCommit in localStorage to track "since last opened".`
      : `Tests in last ${commits} commits. Use ?since=commitHash to compare against a specific commit.`,
  });
}
