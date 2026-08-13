import { PERMISSIONS } from "@/lib/permissions-core";
import { hasTicketTriageAccess } from "@/lib/ticket-triage";

/** Client-safe: create/edit/delete projects for the current team context. */
export function canManageProjects(
  role: string,
  specialPermissions: string[] | undefined,
  teamRole: "ADMIN" | "MEMBER" | null | undefined
): boolean {
  if (hasTicketTriageAccess(role, specialPermissions)) return true;
  if (specialPermissions?.includes(PERMISSIONS.ACCESS_ALL_TEAMS)) return true;
  return teamRole === "ADMIN";
}

/** Client-safe: view project overview and other read-only project pages. */
export function canViewProject(
  role: string,
  specialPermissions: string[] | undefined,
  teamRole: "ADMIN" | "MEMBER" | null | undefined
): boolean {
  if (hasTicketTriageAccess(role, specialPermissions)) return true;
  if (specialPermissions?.includes(PERMISSIONS.ACCESS_ALL_TEAMS)) return true;
  return teamRole === "ADMIN" || teamRole === "MEMBER";
}
