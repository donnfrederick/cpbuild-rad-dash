import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdminWithSession } from "@/lib/devtools-auth";

const visitSchema = z.object({
  environment: z.enum(["development", "staging", "production", "all"]),
});

/**
 * POST /api/devtools/environment-visit
 *
 * Upsert the "last visited" timestamp for the current admin in the given environment.
 * Called when the admin closes the Release Checklist or marks all items verified.
 */
export async function POST(req: NextRequest) {
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }

  const { guard, session } = await requireDevToolsAdminWithSession();
  if (guard) return guard;
  const userId = session.user.id;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const result = visitSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: result.error.flatten() }, { status: 400 });
  }

  const { environment } = result.data;

  try {
    const visit = await db.environmentVisit.upsert({
      where: { userId_environment: { userId, environment } },
      create: { userId, environment, lastVisitedAt: new Date() },
      update: { lastVisitedAt: new Date() },
    });

    return NextResponse.json(visit);
  } catch (err) {
    console.error("[POST /api/devtools/environment-visit]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
