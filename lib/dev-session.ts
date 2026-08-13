/**
 * When `DEV_BYPASS_AUTH=true` (non-production), API routes use a synthetic or DB-backed dev user.
 * Set `DEV_BYPASS_USER_EMAIL` to a real user email for consistent assignee / mention behavior.
 */

import { ROLE_PERMISSIONS, type RoleCode } from "@/lib/permissions";

const VALID_ROLES = new Set(Object.keys(ROLE_PERMISSIONS));

export async function getSession() {
  const isBypass =
    process.env.DEV_BYPASS_AUTH === "true" && process.env.NODE_ENV !== "production";
  if (isBypass) {
    // If the user signed in with NextAuth, always use that session. Otherwise a bad
    // DEV_BYPASS_USER_EMAIL (no DB row) yields synthetic `dev-user`, which breaks /api/me.
    try {
      const { auth } = await import("@/lib/auth");
      const authed = await auth();
      const u = authed?.user as
        | { id?: string; email?: string | null; name?: string | null; role?: string }
        | undefined;
      if (u?.id && typeof u.role === "string") {
        const role = u.role === "SUPER_ADMIN" ? "ADMIN" : u.role;
        return {
          user: {
            id: u.id,
            email: u.email ?? "",
            name: u.name ?? null,
            role,
          },
        };
      }
    } catch {
      // DB or auth init unavailable during early boot
    }

    const envEmail = process.env.DEV_BYPASS_USER_EMAIL?.trim();
    if (envEmail) {
      try {
        const { db } = await import("@/lib/db");
        const user = await db.user.findUnique({
          where: { email: envEmail },
          include: { role: true },
        });
        if (user) {
          return {
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              role: user.role.code,
            },
          };
        }
        console.warn(`[dev-session] No user for DEV_BYPASS_USER_EMAIL=${envEmail}`);
      } catch {
        // DB unavailable
      }
    }
    const roleEnv = process.env.DEV_USER_ROLE;
    const role =
      roleEnv && VALID_ROLES.has(roleEnv) ? (roleEnv as RoleCode) : "ADMIN";
    return {
      user: {
        id: "dev-user",
        name: "Dev User",
        email: "dev@localhost",
        role,
      },
    };
  }
  const { auth } = await import("@/lib/auth");
  const session = await auth();
  if (session?.user && (session.user as { role?: string }).role === "SUPER_ADMIN") {
    return { ...session, user: { ...session.user, role: "ADMIN" } };
  }
  return session;
}
