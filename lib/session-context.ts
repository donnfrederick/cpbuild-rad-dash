import "server-only";
import { getSession } from "@/lib/dev-session";
import { db } from "@/lib/db";

export interface SessionUserContext {
  id: string;
  email: string;
  name: string | null;
  role: string;
  specialPermissions: string[];
}

/** Session plus `specialPermissions` from the database (for triage overrides). */
export async function getSessionContext(): Promise<{ user: SessionUserContext } | null> {
  const session = await getSession();
  if (!session?.user?.id) return null;

  let specialPermissions: string[] = [];
  try {
    const rows = await db.userSpecialPermission.findMany({
      where: { userId: session.user.id },
      select: { permission: true },
    });
    specialPermissions = rows.map((r) => r.permission);
  } catch {
    // dev-user or missing DB
  }

  return {
    user: {
      id: session.user.id,
      email: session.user.email ?? "",
      name: session.user.name ?? null,
      role: session.user.role,
      specialPermissions,
    },
  };
}
