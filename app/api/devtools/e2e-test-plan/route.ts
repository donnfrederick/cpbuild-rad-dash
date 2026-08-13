/**
 * GET /api/devtools/e2e-test-plan
 *
 * Dev-only. Scans e2e/ folder for Playwright spec files and produces an E2E test plan:
 * - All spec files and their test blocks
 * - User flows that should be covered (auth, projects, team, PWA, offline)
 * - Status: implemented vs suggested
 *
 * Does not require running tests — parses source files.
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdmin } from "@/lib/devtools-auth";

const PROJECT_ROOT = process.cwd();
const E2E_DIR = path.join(PROJECT_ROOT, "e2e");

interface E2eTestBlock {
  describe: string;
  tests: string[];
}

interface E2eSpecEntry {
  file: string;
  blocks: E2eTestBlock[];
  totalTests: number;
}

/** User flows we expect E2E coverage for. */
const EXPECTED_FLOWS = [
  { id: "health", label: "Health & API availability", keywords: ["health", "api"] },
  { id: "auth", label: "Auth routing & login", keywords: ["auth", "login", "redirect", "session"] },
  { id: "invite", label: "Invite flow", keywords: ["invite", "token"] },
  { id: "pwa", label: "PWA manifest & service worker", keywords: ["manifest", "pwa", "service worker"] },
  { id: "accessibility", label: "Accessibility (skip link, focus)", keywords: ["skip", "accessibility", "aria"] },
  { id: "projects", label: "Projects CRUD flows", keywords: ["project", "create", "delete"] },
  { id: "team", label: "Team management", keywords: ["team", "member"] },
  { id: "offline", label: "Offline mode", keywords: ["offline", "navigator.onLine"] },
] as const;

function parseSpecFile(filePath: string): E2eTestBlock[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const blocks: E2eTestBlock[] = [];
  let currentDescribe = "Root";
  const currentTests: string[] = [];

  const lines = content.split("\n");
  for (const line of lines) {
    const describeMatch = line.match(/test\.describe\s*\(\s*["']([^"']+)["']/);
    if (describeMatch) {
      if (currentTests.length > 0) {
        blocks.push({ describe: currentDescribe, tests: [...currentTests] });
        currentTests.length = 0;
      }
      currentDescribe = describeMatch[1];
      continue;
    }

    const testMatch = line.match(/test\s*\(\s*["']([^"']+)["']/);
    if (testMatch) {
      currentTests.push(testMatch[1]);
    }
  }

  if (currentTests.length > 0) {
    blocks.push({ describe: currentDescribe, tests: [...currentTests] });
  }

  return blocks;
}

export async function GET() {
  if (!isDevToolsAllowed()) {
    return NextResponse.json(
      { error: DEVTOOLS_BLOCKED_MESSAGE },
      { status: 403 }
    );
  }

  const authError = await requireDevToolsAdmin();
  if (authError) return authError;

  const entries: E2eSpecEntry[] = [];
  let totalTests = 0;

  if (!fs.existsSync(E2E_DIR)) {
    return NextResponse.json({
      entries: [],
      flows: EXPECTED_FLOWS.map((f) => ({ ...f, covered: false })),
      totalTests: 0,
      generatedAt: new Date().toISOString(),
      hint: "Create e2e/ folder and add Playwright spec files.",
    });
  }

  const files = fs.readdirSync(E2E_DIR).filter((f) => f.endsWith(".spec.ts") || f.endsWith(".spec.tsx"));
  for (const file of files) {
    const filePath = path.join(E2E_DIR, file);
    const blocks = parseSpecFile(filePath);
    const total = blocks.reduce((sum, b) => sum + b.tests.length, 0);
    totalTests += total;
    entries.push({
      file: `e2e/${file}`,
      blocks,
      totalTests: total,
    });
  }

  // Map flows to coverage based on spec content
  const allContent = entries.map((e) => e.blocks.map((b) => b.describe + " " + b.tests.join(" ")).join(" ")).join(" ").toLowerCase();
  const flows = EXPECTED_FLOWS.map((f) => ({
    ...f,
    covered: f.keywords.some((k) => allContent.includes(k.toLowerCase())),
  }));

  return NextResponse.json({
    entries,
    flows,
    totalTests,
    generatedAt: new Date().toISOString(),
    hint: "Run 'npm run test:e2e' to execute E2E tests. Use BASE_URL for deployed environments.",
  });
}
