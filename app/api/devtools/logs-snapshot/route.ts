/**
 * GET /api/devtools/logs-snapshot
 *
 * Returns the current log buffer as JSON (for Error Wrap-Up aggregation).
 * Same auth as /api/devtools/logs.
 */

import { NextResponse } from "next/server";
import { getLogBuffer } from "@/lib/dev-logger";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdmin } from "@/lib/devtools-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }

  const authError = await requireDevToolsAdmin();
  if (authError) return authError;

  const entries = getLogBuffer();
  return NextResponse.json({ entries });
}
