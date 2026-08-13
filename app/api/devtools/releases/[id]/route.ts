import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdminWithSession } from "@/lib/devtools-auth";

/**
 * DELETE /api/devtools/releases/[id]
 *
 * Permanently deletes a release and its associated tour/steps (cascade).
 * Requires DevTools admin access. Dev/staging environments only.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }

  const { guard } = await requireDevToolsAdminWithSession();
  if (guard) return guard;

  const { id } = await params;

  const release = await db.release.findUnique({ where: { id } });
  if (!release) {
    return NextResponse.json({ error: "Release not found" }, { status: 404 });
  }

  await db.release.delete({ where: { id } });

  return NextResponse.json({ deleted: true, id });
}
