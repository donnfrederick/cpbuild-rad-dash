/**
 * GET /api/devtools/agent-identity
 * Returns all registered agent identities. Used by Memory Registry DevTools panel.
 * Auth: requireDevToolsAdmin() -- ADMIN role only.
 */

import { NextResponse } from "next/server";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdmin } from "@/lib/devtools-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDevToolsAllowed()) {
    return NextResponse.json({ error: DEVTOOLS_BLOCKED_MESSAGE }, { status: 403 });
  }

  const guard = await requireDevToolsAdmin();
  if (guard) return guard;

  const users = await db.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: { select: { code: true, name: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ agents: users });
}
