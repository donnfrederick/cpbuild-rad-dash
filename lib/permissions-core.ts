/**
 * Permission codes and default role → permission mapping for the ticketing app.
 * Safe for client bundles (no database imports).
 */

export const PERMISSIONS = {
  /** Full inbox triage (list all tickets, status, assign, delete, admin notes). */
  TICKETS_TRIAGE: "tickets:triage",
  /** Grants access to the DevTools panel (logs, diagnostics, tests, release tools).
   * Granted to ADMIN only. */
  ACCESS_DEVTOOLS: "access:devtools",
  /** Grants cross-team visibility: see all teams' dashboards and create new teams.
   * Assigned via UserSpecialPermission to designated super-admin ADMIN users. */
  ACCESS_ALL_TEAMS: "access:all_teams",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Role codes stored in `roles.code`. */
export type RoleCode = "ADMIN" | "MEMBER";

export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  ADMIN: [PERMISSIONS.TICKETS_TRIAGE, PERMISSIONS.ACCESS_DEVTOOLS],
  MEMBER: [],
};

export function hasPermission(
  roleCode: string,
  permission: Permission,
  specialPerms?: string[]
): boolean {
  const normalized = roleCode === "SUPER_ADMIN" ? "ADMIN" : roleCode;
  const rolePerms = ROLE_PERMISSIONS[normalized as RoleCode];
  if (rolePerms?.includes(permission)) return true;
  if (specialPerms?.includes(permission)) return true;
  return false;
}
