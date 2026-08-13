import "server-only";

import type { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import {
  getMentionedTicketIds,
  hasTicketTriageAccess,
  ticketListWhereClause,
  ticketMainInboxVisibilityWhere,
  viewerContextForTicket,
} from "@/lib/ticket-access";
import { buildTicketRefFromParts } from "@/lib/ticket-display-ref";
import type { TicketRow } from "@/components/tickets/ticket-types";
import { listCacheTags, LIST_CACHE_REVALIDATE_SECONDS } from "@/lib/list-cache";
import { ticketWhereForSprintScope } from "@/lib/sprint-ticket-where";
import { loadActiveSprintScopesForList, computeTicketSprintsForBoardAlignment } from "@/lib/ticket-list-implicit-sprints";

export interface TicketsListLoaderInput {
  userId: string;
  role: string;
  specialPermissions: string[];
  projectIdParam: string | null;
  /** When set, tickets are limited to projects linked to this sprint (mutually exclusive with projectIdParam at the API layer). */
  sprintIdParam: string | null;
  /** Multiple projects (e.g. sprint create wizard). Mutually exclusive with projectIdParam and sprintIdParam at the API layer. */
  projectIdsParam: string[] | null;
  /**
   * Multi-sprint filter (e.g. global tickets page). Tickets must belong to ANY of the listed sprints.
   * Mutually exclusive with `projectIdParam` / `projectIdsParam` / `sprintIdParam`; CAN combine with `globalProjectFilter`.
   */
  sprintIdsParam: string[] | null;
  archivedList: boolean;
  /**
   * Global all-tickets view (`gpf=1`):
   * - `projectIdList`: selected project CUIDs (empty means no project rows unless `includeUnassigned`).
   * - `includeUnassignedGlobal`: add tickets with `projectId === null`.
   * Mutually exclusive with legacy `projectIdParam` (single) / `sprintId` at the API.
   */
  globalProjectFilter: boolean;
  globalProjectIdList: string[];
  includeUnassignedGlobal: boolean;
  /** When set, limit tickets to those whose project belongs to this team (unassigned tickets always visible). */
  teamId: string | null;
}

function specialPermissionsKey(perms: string[]): string {
  return [...perms].sort().join("\u001f");
}

export function ticketsListCacheKeyParts(input: TicketsListLoaderInput): string[] {
  const multi =
    input.projectIdsParam && input.projectIdsParam.length > 0
      ? [...input.projectIdsParam].sort().join("\u001f")
      : "";
  const globalPids =
    input.globalProjectIdList && input.globalProjectIdList.length > 0
      ? [...input.globalProjectIdList].sort().join("\u001f")
      : "";
  const sprintIds =
    input.sprintIdsParam && input.sprintIdsParam.length > 0
      ? [...input.sprintIdsParam].sort().join("\u001f")
      : "";
  return [
    "tickets-list",
    input.userId,
    input.role,
    specialPermissionsKey(input.specialPermissions),
    input.projectIdParam ?? "",
    input.sprintIdParam ?? "",
    multi,
    input.archivedList ? "archived" : "active",
    input.globalProjectFilter ? "gpf" : "",
    globalPids,
    input.includeUnassignedGlobal ? "unassigned" : "",
    sprintIds,
    input.teamId ?? "",
  ];
}

/** Prisma query + mapping for GET /api/tickets (list view fields only — no screenshot/videoUrl/pageUrl/adminNote). */
export async function loadTicketsListPayload(input: TicketsListLoaderInput): Promise<{
  tickets: TicketRow[];
}> {
  const {
    userId,
    role,
    specialPermissions,
    projectIdParam,
    sprintIdParam,
    projectIdsParam,
    sprintIdsParam,
    archivedList,
    globalProjectFilter,
    globalProjectIdList,
    includeUnassignedGlobal,
    teamId,
  } = input;
  const canViewAll = hasTicketTriageAccess(role, specialPermissions);
  const mentionedIds = canViewAll ? [] : await getMentionedTicketIds(userId);
  const accessWhere = ticketListWhereClause(userId, role, mentionedIds, specialPermissions, teamId);

  let projectFilter: Prisma.TicketWhereInput | undefined;
  if (globalProjectFilter) {
    const pids = globalProjectIdList.filter((id) => id.length > 0);
    const inProjects = pids.length > 0 ? ({ projectId: { in: pids } } as const) : null;
    if (inProjects && includeUnassignedGlobal) {
      projectFilter = { OR: [inProjects, { projectId: null }] };
    } else if (inProjects) {
      projectFilter = inProjects;
    } else if (includeUnassignedGlobal) {
      projectFilter = { projectId: null };
    } else {
      projectFilter = { id: { in: [] } };
    }
  } else if (projectIdParam === "unassigned") {
    projectFilter = { projectId: null };
  } else if (projectIdParam) {
    projectFilter = { projectId: projectIdParam };
  } else if (projectIdsParam && projectIdsParam.length > 0) {
    projectFilter = { projectId: { in: projectIdsParam } };
  } else if (sprintIdParam) {
    const sprint = await db.sprint.findUnique({
      where: { id: sprintIdParam },
      select: {
        projects: { select: { projectId: true } },
        sprintTickets: { select: { ticketId: true } },
      },
    });
    projectFilter = ticketWhereForSprintScope(sprint);
  } else {
    projectFilter = undefined;
  }

  let sprintFilter: Prisma.TicketWhereInput | undefined;
  if (sprintIdsParam && sprintIdsParam.length > 0) {
    const sprints = await db.sprint.findMany({
      where: { id: { in: sprintIdsParam } },
      select: {
        id: true,
        projects: { select: { projectId: true } },
        sprintTickets: { select: { ticketId: true } },
      },
    });
    const perSprintClauses: Prisma.TicketWhereInput[] = [];
    for (const s of sprints) {
      // Mirror ticketWhereForSprintScope priority: explicit tickets win over project filter.
      const explicitTicketIds = s.sprintTickets.map((row) => row.ticketId);
      if (explicitTicketIds.length > 0) {
        perSprintClauses.push({ id: { in: explicitTicketIds } });
      } else {
        const projectIds = s.projects.map((row) => row.projectId);
        if (projectIds.length > 0) {
          perSprintClauses.push({ projectId: { in: projectIds } });
        }
        // Sprint with no tickets and no projects → empty (skip, contributes nothing)
      }
    }
    if (perSprintClauses.length === 0) {
      sprintFilter = { AND: [{ projectId: { equals: null } }, { NOT: { projectId: { equals: null } } }] };
    } else if (perSprintClauses.length === 1) {
      sprintFilter = perSprintClauses[0];
    } else {
      sprintFilter = { OR: perSprintClauses };
    }
  }

  const extraAnd: Prisma.TicketWhereInput[] = [];
  if (accessWhere) extraAnd.push(accessWhere);
  if (projectFilter) extraAnd.push(projectFilter);
  if (sprintFilter) extraAnd.push(sprintFilter);
  // Team scoping:
  // - Project tickets: must belong to this team's projects.
  // - Sprint-linked general tickets (no project, has a sprintTicket row): scoped
  //   exclusively by the sprint's teamId — prevents cross-team bleed when a user
  //   is a member of multiple teams.
  // - Purely general tickets (no project, no sprint): shown if the creator is a
  //   member of this team.
  if (teamId) {
    extraAnd.push({
      OR: [
        { project: { teamId } },
        { projectId: null, sprintTickets: { some: { sprint: { teamId } } } },
        {
          projectId: null,
          sprintTickets: { none: {} },
          user: { teamMemberships: { some: { teamId } } },
        },
      ],
    });
  }

  let combinedWhere: Prisma.TicketWhereInput;
  if (archivedList) {
    combinedWhere = {
      status: "ARCHIVED",
      ...(extraAnd.length > 0 ? { AND: extraAnd } : {}),
    };
  } else {
    combinedWhere = {
      AND: [ticketMainInboxVisibilityWhere(), ...extraAnd],
    };
  }

  const [tickets, activeSprintScopes] = await Promise.all([
    db.ticket.findMany({
      where: combinedWhere,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
        shortId: true,
        ticketScopeKey: true,
        ticketKeyNumber: true,
        type: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        source: true,
        environment: true,
        projectId: true,
        storyPoints: true,
        parentId: true,
        assigneeId: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: { id: true, name: true, email: true },
        },
        assignee: { select: { id: true, name: true, email: true } },
        parent: {
          select: {
            id: true,
            title: true,
            ticketScopeKey: true,
            ticketKeyNumber: true,
            project: { select: { ticketKeyPrefix: true } },
          },
        },
        project: { select: { id: true, name: true, ticketKeyPrefix: true } },
        tags: { select: { id: true, name: true }, orderBy: { name: "asc" } },
        linkedPRs: { select: { id: true, status: true } },
        sprintTickets: {
          select: { sprint: { select: { id: true, name: true } } },
        },
        duplicateOf: { select: { canonicalId: true } },
        _count: {
          select: {
            comments: { where: { deletedAt: null } },
            canonicalDuplicates: true,
          },
        },
      },
    }),
    loadActiveSprintScopesForList(),
  ]);

  const payload: TicketRow[] = tickets.map((r) => {
    const {
      _count,
      duplicateOf: dupOf,
      parent: parentRow,
      createdAt,
      updatedAt,
      project: pr,
      sprintTickets,
      ...core
    } = r;
    const ref = buildTicketRefFromParts(
      r.ticketScopeKey,
      r.ticketKeyNumber,
      pr?.ticketKeyPrefix
    );
    const parent = parentRow
      ? {
          id: parentRow.id,
          title: parentRow.title,
          ref: buildTicketRefFromParts(
            parentRow.ticketScopeKey,
            parentRow.ticketKeyNumber,
            parentRow.project?.ticketKeyPrefix
          ),
        }
      : null;
    return {
      id: core.id,
      userId: core.userId,
      shortId: core.shortId,
      ref,
      type: core.type,
      title: core.title,
      description: core.description,
      status: core.status,
      priority: core.priority,
      source: core.source,
      projectId: core.projectId,
      project: pr ? { id: pr.id, name: pr.name, ticketKeyPrefix: pr.ticketKeyPrefix } : null,
      storyPoints: core.storyPoints,
      parentId: core.parentId,
      user: core.user,
      assignee: core.assignee,
      parent,
      tags: core.tags,
      linkedPRs: core.linkedPRs,
      sprints: computeTicketSprintsForBoardAlignment(
        { id: core.id, projectId: core.projectId },
        sprintTickets.map((st) => st.sprint),
        activeSprintScopes
      ),
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      commentsCount: _count.comments,
      duplicatesCount: _count.canonicalDuplicates,
      duplicateOf: dupOf,
      viewerContext: viewerContextForTicket(userId, canViewAll, r),
    };
  });

  return { tickets: payload };
}

/**
 * Module-level cached function — must live outside any per-request function so
 * that revalidateTag("list:tickets-list") can correctly invalidate it.
 * Next.js includes the runtime arguments in the full cache key.
 */
const _cachedTicketsListFetch = unstable_cache(
  async (
    userId: string,
    role: string,
    specialPermsKey: string,
    projectIdParam: string,
    sprintIdParam: string,
    projectIdsKey: string,
    archivedList: boolean,
    globalFilterFlag: string,
    globalProjectIdsKey: string,
    includeUnassignedFlag: string,
    sprintIdsKey: string,
    teamId: string
  ) => {
    const projectIdsList = projectIdsKey.length > 0 ? projectIdsKey.split("\u001f").filter(Boolean) : [];
    const sprintIdsList = sprintIdsKey.length > 0 ? sprintIdsKey.split("\u001f").filter(Boolean) : [];
    return loadTicketsListPayload({
      userId,
      role,
      specialPermissions: specialPermsKey.length > 0 ? specialPermsKey.split("\u001f") : [],
      projectIdParam: projectIdParam || null,
      sprintIdParam: sprintIdParam || null,
      projectIdsParam: projectIdsList.length > 0 ? projectIdsList : null,
      sprintIdsParam: sprintIdsList.length > 0 ? sprintIdsList : null,
      archivedList,
      globalProjectFilter: globalFilterFlag === "1",
      globalProjectIdList:
        globalProjectIdsKey.length > 0 ? globalProjectIdsKey.split("\u001f").filter(Boolean) : [],
      includeUnassignedGlobal: includeUnassignedFlag === "1",
      teamId: teamId || null,
    });
  },
  ["tickets-list", "v5"],
  {
    tags: [listCacheTags.ticketsList],
    revalidate: LIST_CACHE_REVALIDATE_SECONDS,
  }
);

export async function getCachedTicketsList(input: TicketsListLoaderInput): Promise<{
  tickets: TicketRow[];
}> {
  const pids = input.projectIdsParam?.filter((id) => id.length > 0) ?? [];
  const projectIdsKey = pids.length > 0 ? [...pids].sort().join("\u001f") : "";
  const gPids = input.globalProjectIdList?.filter((id) => id.length > 0) ?? [];
  const globalProjectIdsKey = gPids.length > 0 ? [...gPids].sort().join("\u001f") : "";
  const sIds = input.sprintIdsParam?.filter((id) => id.length > 0) ?? [];
  const sprintIdsKey = sIds.length > 0 ? [...sIds].sort().join("\u001f") : "";

  return _cachedTicketsListFetch(
    input.userId,
    input.role,
    specialPermissionsKey(input.specialPermissions),
    input.projectIdParam ?? "",
    input.sprintIdParam ?? "",
    projectIdsKey,
    input.archivedList,
    input.globalProjectFilter ? "1" : "0",
    globalProjectIdsKey,
    input.includeUnassignedGlobal ? "1" : "0",
    sprintIdsKey,
    input.teamId ?? ""
  );
}
