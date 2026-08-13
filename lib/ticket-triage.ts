import { hasPermission, PERMISSIONS } from "@/lib/permissions-core";

/** Client-safe triage check (no server / DB imports). */
export function hasTicketTriageAccess(role: string, specialPermissions?: string[]): boolean {
  return hasPermission(role, PERMISSIONS.TICKETS_TRIAGE, specialPermissions);
}
