import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdmin } from "@/lib/devtools-auth";

const REPO = "cp-build-dev-ops/command-center-reboot";

const postSchema = z.object({
  title: z.string().min(1, "title is required"),
  body: z.string().default(""),
  labels: z.array(z.string()).default([]),
  branch: z.string().min(1, "branch is required"),
  base: z.string().default("dev"),
});

/**
 * POST /api/devtools/pr-workflow
 *
 * Creates a GitHub pull request via the REST API using GITHUB_TOKEN.
 * If GITHUB_TOKEN is not configured, returns a fallbackUrl pointing to
 * GitHub's compare/PR creation page with the title and body pre-filled.
 *
 * Auth: requireDevToolsAdmin() — ADMIN role.
 */
export async function POST(req: NextRequest) {
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }

  const guard = await requireDevToolsAdmin();
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const result = postSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: result.error.flatten() }, { status: 400 });
  }

  const { title, body: prBody, labels, branch, base } = result.data;

  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    const encodedTitle = encodeURIComponent(title);
    const encodedBody = encodeURIComponent(prBody);
    const encodedBranch = encodeURIComponent(branch);
    const fallbackUrl = `https://github.com/${REPO}/compare/${base}...${encodedBranch}?quick_pull=1&title=${encodedTitle}&body=${encodedBody}`;
    return NextResponse.json({ fallbackUrl });
  }

  try {
    const apiRes = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        body: prBody,
        head: branch,
        base,
        labels,
      }),
    });

    if (!apiRes.ok) {
      const errBody = await apiRes.json().catch(() => ({})) as { message?: string };
      return NextResponse.json(
        { error: errBody.message ?? `GitHub API returned ${apiRes.status}` },
        { status: apiRes.status >= 400 && apiRes.status < 500 ? 422 : 500 }
      );
    }

    const pr = await apiRes.json() as { number: number; html_url: string };
    return NextResponse.json({ prNumber: pr.number, prUrl: pr.html_url });
  } catch (err) {
    console.error("[POST /api/devtools/pr-workflow]", err);
    return NextResponse.json(
      { error: `Failed to create PR: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
