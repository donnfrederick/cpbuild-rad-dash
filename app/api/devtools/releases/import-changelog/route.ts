import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdminWithSession } from "@/lib/devtools-auth";
import { parseChangelog } from "@/lib/changelog-parser";

/**
 * POST /api/devtools/releases/import-changelog
 *
 * Reads CHANGELOG.md from the repo root and imports [Merged] entries as
 * Release records. Idempotent — skips any PR already in the DB by prNumber.
 *
 * Returns a summary: { imported, skipped, total }.
 */
export async function POST() {
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }

  const { guard } = await requireDevToolsAdminWithSession();
  if (guard) return guard;

  try {
    const changelogPath = join(process.cwd(), "CHANGELOG.md");
    const content = await readFile(changelogPath, "utf-8").catch(() => null);

    if (!content) {
      return NextResponse.json({ error: "CHANGELOG.md not found" }, { status: 404 });
    }

    const parsed = parseChangelog(content, { includeInProgress: false });

    if (parsed.length === 0) {
      return NextResponse.json({ imported: 0, skipped: 0, total: 0 });
    }

    // Fetch existing prNumbers to skip duplicates
    const existingPrNumbers = new Set(
      (await db.release.findMany({ select: { prNumber: true }, where: { prNumber: { not: null } } }))
        .map((r) => r.prNumber)
        .filter(Boolean)
    );

    let imported = 0;
    let skipped = 0;

    for (const release of parsed) {
      if (release.prNumber && existingPrNumbers.has(release.prNumber)) {
        skipped++;
        continue;
      }

      await db.release.create({
        data: {
          title: release.title,
          prNumber: release.prNumber,
          branch: release.branch,
          environment: release.environment,
          mergedAt: release.mergedAt,
          changes: release.changes as unknown as Prisma.InputJsonValue,
        },
      });

      imported++;
    }

    return NextResponse.json({ imported, skipped, total: parsed.length });
  } catch (err) {
    console.error("[POST /api/devtools/releases/import-changelog]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
