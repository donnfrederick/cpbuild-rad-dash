import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdminWithSession } from "@/lib/devtools-auth";

const verifySchema = z.object({
  environment: z.enum(["development", "staging", "production", "all"]),
  notes: z.string().optional().default(""),
});

/**
 * PATCH /api/devtools/releases/[id]/verify
 *
 * Mark a release as verified by the current admin for the given environment.
 * Uses upsert — idempotent if called again.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }

  const { guard, session } = await requireDevToolsAdminWithSession();
  if (guard) return guard;
  const userId = session.user.id;

  const { id: releaseId } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const result = verifySchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: result.error.flatten() }, { status: 400 });
  }

  const { environment, notes } = result.data;

  try {
    const release = await db.release.findUnique({ where: { id: releaseId } });
    if (!release) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const verification = await db.releaseVerification.upsert({
      where: {
        releaseId_userId_environment: { releaseId, userId, environment },
      },
      create: {
        releaseId,
        userId,
        environment,
        notes: notes || null,
      },
      update: {
        verifiedAt: new Date(),
        notes: notes || null,
      },
    });

    return NextResponse.json(verification);
  } catch (err) {
    console.error("[PATCH /api/devtools/releases/[id]/verify]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/devtools/releases/[id]/verify
 *
 * Un-verify a release (uncheck it) for the current admin + environment.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }

  const { guard, session } = await requireDevToolsAdminWithSession();
  if (guard) return guard;
  const userId = session.user.id;

  const { id: releaseId } = await params;
  const { searchParams } = new URL(req.url);
  const environment = searchParams.get("environment") ?? "all";

  try {
    await db.releaseVerification.deleteMany({
      where: { releaseId, userId, environment },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/devtools/releases/[id]/verify]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
