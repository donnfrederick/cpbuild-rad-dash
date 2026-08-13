import "server-only";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions-core";
import { hasTicketTriageAccess } from "@/lib/ticket-triage";

export async function canManageTeamProjects(
  userId: string,
  role: string,
  specialPermissions: string[],
  teamId: string
): Promise<boolean> {
  if (hasTicketTriageAccess(role, specialPermissions)) return true;
  if (specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS)) return true;
  const membership = await db.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { teamRole: true },
  });
  return membership?.teamRole === "ADMIN";
}

export async function canManageProject(
  userId: string,
  role: string,
  specialPermissions: string[],
  projectId: string
): Promise<boolean> {
  if (hasTicketTriageAccess(role, specialPermissions)) return true;
  if (specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS)) return true;
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { teamId: true },
  });
  if (!project) return false;
  return canManageTeamProjects(userId, role, specialPermissions, project.teamId);
}

/** Read project pages (overview, tickets list scoped to team projects, etc.). */
export async function canViewTeamProject(
  userId: string,
  role: string,
  specialPermissions: string[],
  teamId: string
): Promise<boolean> {
  if (hasTicketTriageAccess(role, specialPermissions)) return true;
  if (specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS)) return true;
  const membership = await db.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { teamId: true },
  });
  return !!membership;
}

export async function canViewProject(
  userId: string,
  role: string,
  specialPermissions: string[],
  projectId: string
): Promise<boolean> {
  if (hasTicketTriageAccess(role, specialPermissions)) return true;
  if (specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS)) return true;
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { teamId: true },
  });
  if (!project) return false;
  return canViewTeamProject(userId, role, specialPermissions, project.teamId);
}
