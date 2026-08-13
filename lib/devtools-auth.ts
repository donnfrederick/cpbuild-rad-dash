/**
 * Shared auth helpers for DevTools API routes.
 * All DevTools routes must call requireDevToolsAdmin() before handling any request.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";

interface ApiError {
  error: string;
}

async function getSession() {
  const isBypass =
    process.env.DEV_BYPASS_AUTH === "true" && process.env.NODE_ENV !== "production";
  if (isBypass) {
    const { db } = await import("@/lib/db");
    const admin = await db.user.findFirst({
      where: { role: { code: "ADMIN" } },
      select: { id: true, name: true, email: true },
    });
    if (admin) return { user: { id: admin.id, name: admin.name, email: admin.email, role: "ADMIN" } };
  }
  return auth();
}

/**
 * Returns a 401/403 NextResponse if the caller is not an authenticated devtools user,
 * or `null` if the request is allowed to proceed.
 */
export async function requireDevToolsAdmin(): Promise<NextResponse<ApiError> | null> {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json<ApiError>({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user.role, PERMISSIONS.ACCESS_DEVTOOLS)) {
    return NextResponse.json<ApiError>({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

type DevToolsSession = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/**
 * Combined auth check + session retrieval in a single `auth()` call.
 * Preferred over calling requireDevToolsAdmin() separately.
 *
 * Usage:
 *   const { guard, session } = await requireDevToolsAdminWithSession();
 *   if (guard) return guard;
 *   const userId = session.user.id;
 */
export async function requireDevToolsAdminWithSession(): Promise<
  { guard: NextResponse<ApiError>; session: null } | { guard: null; session: DevToolsSession }
> {
  const session = await getSession();
  if (!session?.user) {
    return { guard: NextResponse.json<ApiError>({ error: "Unauthorized" }, { status: 401 }), session: null };
  }
  if (!hasPermission(session.user.role, PERMISSIONS.ACCESS_DEVTOOLS)) {
    return { guard: NextResponse.json<ApiError>({ error: "Forbidden" }, { status: 403 }), session: null };
  }
  return { guard: null, session: session as DevToolsSession };
}
