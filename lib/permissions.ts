import type { Permission } from "./permissions-core";
import { hasPermission } from "./permissions-core";

export * from "./permissions-core";

export async function hasPermissionWithOverrides(
  roleCode: string,
  userId: string,
  permission: Permission
): Promise<boolean> {
  if (hasPermission(roleCode, permission)) return true;
  const { db } = await import("@/lib/db");
  const row = await db.userSpecialPermission.findUnique({
    where: { userId_permission: { userId, permission } },
    select: { id: true },
  });
  return row !== null;
}
