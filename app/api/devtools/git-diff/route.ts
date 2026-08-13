import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdmin } from "@/lib/devtools-auth";

/**
 * GET /api/devtools/git-diff
 *
 * Returns the current branch name and its diff against origin/dev.
 * Used by the PR Workflow Panel to auto-capture the diff without requiring
 * the developer to paste it manually.
 *
 * Auth: requireDevToolsAdmin() — ADMIN role.
 */
export async function GET() {
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }

  const guard = await requireDevToolsAdmin();
  if (guard) return guard;

  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: process.cwd(),
      encoding: "utf-8",
    }).trim();

    let diff = "";
    try {
      diff = execSync("git diff origin/dev", {
        cwd: process.cwd(),
        encoding: "utf-8",
        // Large diffs: cap at 500 KB to avoid overwhelming Gemini
        maxBuffer: 512 * 1024,
      });
    } catch {
      // origin/dev may not be fetched yet — return empty diff with a hint
      diff = "";
    }

    const isEmpty = diff.trim().length === 0;

    return NextResponse.json({ branch, diff, isEmpty });
  } catch (err) {
    console.error("[GET /api/devtools/git-diff]", err);
    return NextResponse.json(
      { error: `Failed to read git state: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
