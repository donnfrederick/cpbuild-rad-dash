import "server-only";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions-core";

export interface ResolvedTeamContext {
  /** The single team id to filter data by. */
  teamId: string;
  teamSlug: string;
  teamName: string;
}

/**
 * Resolve which team's data to show for a given request.
 *
 * Priority:
 *   1. If a `team` query param is supplied, use it (team id or slug).
 *      - Super admins (access:all_teams) may resolve any team.
 *      - Regular users may only resolve teams they belong to.
 *   2. Otherwise fall back to the first team the user is a member of.
 *
 * Returns `null` if the user has no team memberships and is not a super admin.
 */
export async function resolveTeamContext(
  userId: string,
  specialPermissions: string[],
  teamParam: string | null
): Promise<ResolvedTeamContext | null> {
  const isSuperAdmin = specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS);

  if (teamParam) {
    const team = await db.team.findFirst({
      where: {
        OR: [{ id: teamParam }, { slug: teamParam }],
      },
      select: { id: true, slug: true, name: true },
    });

    if (!team) return null;

    if (!isSuperAdmin) {
      const membership = await db.teamMembership.findUnique({
        where: { userId_teamId: { userId, teamId: team.id } },
        select: { teamId: true },
      });
      if (!membership) return null;
    }

    return { teamId: team.id, teamSlug: team.slug, teamName: team.name };
  }

  // No param: return the user's first team (alphabetical)
  const membership = await db.teamMembership.findFirst({
    where: { userId },
    orderBy: { team: { name: "asc" } },
    select: {
      team: { select: { id: true, slug: true, name: true } },
    },
  });

  if (!membership) return null;
  return {
    teamId: membership.team.id,
    teamSlug: membership.team.slug,
    teamName: membership.team.name,
  };
}

/**
 * Return all team ids the user has access to.
 * Super admins get every team. Regular users get their memberships.
 */
export async function resolveAccessibleTeamIds(
  userId: string,
  specialPermissions: string[]
): Promise<string[]> {
  const isSuperAdmin = specialPermissions.includes(PERMISSIONS.ACCESS_ALL_TEAMS);

  if (isSuperAdmin) {
    const teams = await db.team.findMany({ select: { id: true } });
    return teams.map((t) => t.id);
  }

  const memberships = await db.teamMembership.findMany({
    where: { userId },
    select: { teamId: true },
  });
  return memberships.map((m) => m.teamId);
}
