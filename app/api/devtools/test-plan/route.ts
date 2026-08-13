/**
 * GET /api/devtools/test-plan
 *
 * Dev-only. Analyzes coverage report and test files to produce a test plan:
 * - All source files that should be tested (from coverage config)
 * - Coverage % per file
 * - Whether a test file exists for each source file
 * - Suggested test path for missing tests
 *
 * Requires coverage to be run first (npm run test:coverage).
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdmin } from "@/lib/devtools-auth";

const PROJECT_ROOT = process.cwd();
const COVERAGE_SUMMARY_PATH = path.join(PROJECT_ROOT, "coverage", "coverage-summary.json");
const TESTS_DIR = path.join(PROJECT_ROOT, "__tests__");

/** Infer test file path for a source file. */
function inferTestPath(sourcePath: string): { unit: string; integration: string } {
  const rel = sourcePath.replace(PROJECT_ROOT, "").replace(/^\//, "");
  const base = rel.replace(/\.[^.]+$/, "").replace(/\//g, "-");
  const name = base.split("-").pop() ?? base;

  if (rel.startsWith("app/api/")) {
    const routeDir = path.dirname(rel);
    const routeName = routeDir.replace(/\//g, "-").replace(/\[id\]/g, "id");
    return {
      unit: `__tests__/unit/${name}.unit.test.ts`,
      integration: `__tests__/integration/${routeName}.integration.test.ts`,
    };
  }
  if (rel.startsWith("lib/") || rel.startsWith("hooks/")) {
    return {
      unit: `__tests__/unit/${name}.unit.test.ts`,
      integration: "",
    };
  }
  if (rel.startsWith("components/")) {
    const compName = path.basename(rel, path.extname(rel));
    return {
      unit: `__tests__/unit/${compName}.test.tsx`,
      integration: "",
    };
  }
  return { unit: `__tests__/unit/${name}.unit.test.ts`, integration: "" };
}

/** Map source file to possible test file paths. */
function getTestCandidates(sourcePath: string): string[] {
  const rel = sourcePath.replace(PROJECT_ROOT, "").replace(/^\//, "");
  const name = path.basename(rel, path.extname(rel));
  const dir = path.dirname(rel);

  const candidates: string[] = [];
  if (rel.startsWith("app/api/")) {
    const routeFolder = dir.replace("app/api/", "").split("/")[0] ?? "unknown";
    const routeSlug = dir.replace(/\//g, "-").replace(/\[id\]/g, "id");
    candidates.push(
      path.join(TESTS_DIR, "integration", `${routeFolder}.integration.test.ts`),
      path.join(TESTS_DIR, "integration", `${routeSlug}.integration.test.ts`)
    );
    if (rel.includes("projects")) {
      candidates.push(
        path.join(TESTS_DIR, "integration", "projects-get.integration.test.ts"),
        path.join(TESTS_DIR, "integration", "unifier-projects.integration.test.ts")
      );
    }
  }
  if (dir.includes("validations")) {
    candidates.push(path.join(TESTS_DIR, "unit", "validations.test.ts"));
  }
  candidates.push(
    path.join(TESTS_DIR, "unit", `${name}.test.ts`),
    path.join(TESTS_DIR, "unit", `${name}.test.tsx`),
    path.join(TESTS_DIR, "unit", `${name}.unit.test.ts`),
    path.join(TESTS_DIR, "unit", `${name}.unit.test.tsx`)
  );
  return candidates;
}

/**
 * Walk source directories when no coverage file is available.
 * Returns absolute paths to .ts/.tsx files we care about testing.
 */
function scanSourceFiles(): string[] {
  const dirs = ["app/api", "lib", "components", "hooks"];
  const results: string[] = [];

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules, .next, __tests__, etc.
        if (!["node_modules", ".next", "__tests__", "e2e"].includes(entry.name)) {
          walk(full);
        }
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.") && !entry.name.includes(".spec.")) {
        results.push(full);
      }
    }
  }

  for (const d of dirs) {
    walk(path.join(PROJECT_ROOT, d));
  }
  return results;
}

function findExistingTest(sourcePath: string): string | null {
  for (const p of getTestCandidates(sourcePath)) {
    if (fs.existsSync(p)) {
      return p.replace(PROJECT_ROOT + "/", "");
    }
  }
  return null;
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

  let coverageSummary: Record<string, { lines?: { pct: number }; statements?: { pct: number }; functions?: { pct: number }; branches?: { pct: number } }> = {};
  let totalStats: { lines: number; statements: number; functions: number; branches: number } | null = null;

  let coverageAvailable = false;
  if (fs.existsSync(COVERAGE_SUMMARY_PATH)) {
    try {
      const raw = fs.readFileSync(COVERAGE_SUMMARY_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      coverageSummary = parsed;
      coverageAvailable = true;
      if (parsed.total) {
        totalStats = {
          lines: parsed.total.lines?.pct ?? 0,
          statements: parsed.total.statements?.pct ?? 0,
          functions: parsed.total.functions?.pct ?? 0,
          branches: parsed.total.branches?.pct ?? 0,
        };
      }
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to parse coverage: ${err instanceof Error ? err.message : String(err)}` },
        { status: 500 }
      );
    }
  }
  // Coverage file missing is not an error — the test structure is still useful
  // without coverage percentages. Show entries with null coverage instead of 404.

  const entries: Array<{
    sourceFile: string;
    linesPct: number;
    statementsPct: number;
    functionsPct: number;
    branchesPct: number;
    status: "complete" | "partial" | "missing";
    hasTest: boolean;
    testFile: string | null;
    suggestedTestPath: string;
    category: "api" | "lib" | "components" | "hooks";
  }> = [];

  // When coverage is available, use its file list. Otherwise scan source dirs directly.
  const sourceFiles: string[] = coverageAvailable
    ? Object.keys(coverageSummary).filter((k) => k !== "total")
    : scanSourceFiles();

  for (const absPath of sourceFiles) {
    const stats = coverageSummary[absPath];
    const relPath = absPath.replace(PROJECT_ROOT, "").replace(/^\//, "");
    const linesPct = stats?.lines?.pct ?? null;
    const statementsPct = stats?.statements?.pct ?? null;
    const functionsPct = stats?.functions?.pct ?? null;
    const branchesPct = stats?.branches?.pct ?? null;

    const testFile = findExistingTest(absPath);
    const hasTest = !!testFile;
    const { unit, integration } = inferTestPath(absPath);
    const suggestedTestPath = relPath.startsWith("app/api/") ? integration || unit : unit;

    let category: "api" | "lib" | "components" | "hooks" = "lib";
    if (relPath.startsWith("app/api/")) category = "api";
    else if (relPath.startsWith("components/")) category = "components";
    else if (relPath.startsWith("hooks/")) category = "hooks";

    // When coverage unavailable, status is based solely on whether a test file exists.
    const status: "complete" | "partial" | "missing" = coverageAvailable
      ? ((linesPct ?? 0) >= 100 && (functionsPct ?? 0) >= 100 ? "complete" : (linesPct ?? 0) > 0 ? "partial" : "missing")
      : (hasTest ? "partial" : "missing");

    entries.push({
      sourceFile: relPath,
      linesPct: linesPct ?? 0,
      statementsPct: statementsPct ?? 0,
      functionsPct: functionsPct ?? 0,
      branchesPct: branchesPct ?? 0,
      status,
      hasTest,
      testFile,
      suggestedTestPath,
      category,
    });
  }

  // Sort: missing first, then partial, then complete; within each by linesPct ascending
  entries.sort((a, b) => {
    const order = { missing: 0, partial: 1, complete: 2 };
    const statusDiff = order[a.status] - order[b.status];
    if (statusDiff !== 0) return statusDiff;
    return a.linesPct - b.linesPct;
  });

  return NextResponse.json({
    total: totalStats,
    coverageAvailable,
    entries,
    generatedAt: new Date().toISOString(),
    hint: coverageAvailable
      ? "Run 'npm run test:coverage' to refresh coverage data."
      : "Coverage unavailable — run 'npm run test:coverage' locally to see line/branch percentages. Test file presence is shown regardless.",
  });
}
