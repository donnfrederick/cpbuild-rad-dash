import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdminWithSession } from "@/lib/devtools-auth";

const releaseChangeSchema = z.object({
  id: z.string(),
  description: z.string().min(1),
  route: z.string().optional().default(""),
  category: z.string().optional().default(""),
});

const createReleaseSchema = z.object({
  title: z.string().min(1).max(500),
  prNumber: z.number().int().positive().nullable().optional(),
  branch: z.string().optional().default(""),
  environment: z.enum(["development", "staging", "production", "all"]).optional().default("all"),
  mergedAt: z.string().datetime(),
  changes: z.array(releaseChangeSchema).default([]),
});

/**
 * GET /api/devtools/releases
 *
 * Returns all releases for the current environment, with verification status
 * for the calling user. Also returns the user's lastVisitedAt for this env.
 *
 * Query params:
 *   environment — "development" | "staging" | "production" | "all" (required)
 */
export async function GET(req: NextRequest) {
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }

  const { guard, session } = await requireDevToolsAdminWithSession();
  if (guard) return guard;
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const environment = searchParams.get("environment") ?? "all";

  try {
    // Fetch last visit for this user+environment
    const visit = await db.environmentVisit.findUnique({
      where: { userId_environment: { userId, environment } },
    });

    // Fetch releases targeting this environment or "all", ordered newest first
    const releases = await db.release.findMany({
      where: {
        OR: [{ environment }, { environment: "all" }],
      },
      orderBy: { mergedAt: "desc" },
      include: {
        verifications: {
          where: { userId, environment },
          select: { id: true, verifiedAt: true },
        },
      },
    });

    const releasesWithStatus = releases.map((r) => ({
      ...r,
      verified: r.verifications.length > 0,
      verifiedAt: r.verifications[0]?.verifiedAt ?? null,
      isNew: visit ? r.mergedAt > visit.lastVisitedAt : true,
    }));

    return NextResponse.json({
      releases: releasesWithStatus,
      lastVisitedAt: visit?.lastVisitedAt ?? null,
    });
  } catch (err) {
    console.error("[GET /api/devtools/releases]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/devtools/releases
 *
 * Create a new release entry manually.
 */
export async function POST(req: NextRequest) {
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }

  const { guard } = await requireDevToolsAdminWithSession();
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const result = createReleaseSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: result.error.flatten() }, { status: 400 });
  }

  const { title, prNumber, branch, environment, mergedAt, changes } = result.data;

  try {
    // Prevent duplicate imports by prNumber
    if (prNumber) {
      const existing = await db.release.findFirst({ where: { prNumber } });
      if (existing) {
        return NextResponse.json({ error: "A release with this PR number already exists", id: existing.id }, { status: 409 });
      }
    }

    const release = await db.release.create({
      data: {
        title,
        prNumber: prNumber ?? null,
        branch: branch || null,
        environment,
        mergedAt: new Date(mergedAt),
        changes,
      },
    });

    return NextResponse.json(release, { status: 201 });
  } catch (err) {
    console.error("[POST /api/devtools/releases]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
