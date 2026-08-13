import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { sendTicketAssignedEmail, sendTicketStatusEmail } from "@/lib/email";
import { isAllowedTicketAssigneeRole } from "@/lib/ticket-assignment";
import {
  canChangeTicketAssignee,
  hasTicketTriageAccess,
  userCanViewTicket,
  viewerContextForTicket,
} from "@/lib/ticket-access";
import { assertValidParentAssignment, TicketParentValidationError } from "@/lib/ticket-parent";
import { revalidateTagsCatalog, revalidateTicketsList } from "@/lib/list-cache";
import { parseTagInput, TAG_NAME_MAX_LENGTH } from "@/lib/tag-normalize";
import { setTicketTagsReplace } from "@/lib/ticket-tags-db";
import { createNotification } from "@/lib/notifications";
import { buildTicketRefFromParts } from "@/lib/ticket-display-ref";
import { allocateKeyForProjectMove } from "@/lib/ticket-key";
import { generateTicketEmbedding, storeTicketEmbedding } from "@/lib/embeddings";
import { resolveTeamContext } from "@/lib/team-context";
import { notifyCommandCenterStatusChange, type CCTicketStatus } from "@/lib/command-center-webhook";
import { notifyFieldTrackerStatusChange, type FTTicketStatus } from "@/lib/field-tracker-webhook";
import {
  loadOtherActiveSprintsForScope,
  ticketIdsBlockedByOtherActiveSprints,
} from "@/lib/sprint-other-active-scope";

const updateTicketSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  status: z.string().min(1).max(100).optional(),
  adminNote: z.string().max(2000).optional().nullable(),
  assigneeId: z.union([z.string().min(1), z.null()]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable().optional(),
  parentId: z.union([z.string().min(1), z.null()]).optional(),
  projectId: z.union([z.string().min(1), z.null()]).optional(),
  storyPoints: z.number().int().min(0).max(99).nullable().optional(),
  tagNames: z.array(z.string().max(TAG_NAME_MAX_LENGTH)).optional(),
  description: z.string().min(1).max(10000).optional(),
  type: z.string().min(1).max(100).optional(),
  sprintId: z.union([z.string().min(1), z.null()]).optional(),
});

const assigneeInclude = {
  assignee: { select: { id: true, name: true, email: true } },
} as const;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const ticket = await db.ticket.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      ...assigneeInclude,
      duplicateOf: {
        include: {
          canonical: {
            select: {
              id: true,
              shortId: true,
              title: true,
              ticketScopeKey: true,
              ticketKeyNumber: true,
              project: { select: { ticketKeyPrefix: true } },
            },
          },
        },
      },
      canonicalDuplicates: {
        include: {
          duplicate: {
            select: {
              id: true,
              shortId: true,
              title: true,
              description: true,
              screenshot: true,
              pageUrl: true,
              createdAt: true,
              ticketScopeKey: true,
              ticketKeyNumber: true,
              user: { select: { id: true, name: true, email: true } },
              project: { select: { ticketKeyPrefix: true } },
            },
          },
        },
      },
      parent: {
        select: {
          id: true,
          title: true,
          ticketScopeKey: true,
          ticketKeyNumber: true,
          project: { select: { ticketKeyPrefix: true } },
        },
      },
      project: {
        select: {
          id: true,
          name: true,
          ticketKeyPrefix: true,
          githubConfig: { select: { id: true } },
        },
      },
      tags: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      sprintTickets: {
        take: 1,
        orderBy: { sprintId: "asc" },
        select: { sprint: { select: { id: true, name: true } } },
      },
      linkedPRs: {
        select: {
          id: true,
          repoOwner: true,
          repoName: true,
          prNumber: true,
          prUrl: true,
          prTitle: true,
          status: true,
          checksStatus: true,
          createdAt: true,
          comments: {
            select: {
              id: true,
              commentType: true,
              authorLogin: true,
              authorAvatarUrl: true,
              body: true,
              htmlUrl: true,
              reviewState: true,
              postedAt: true,
            },
            orderBy: { postedAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      _count: {
        select: {
          comments: { where: { deletedAt: null } },
          canonicalDuplicates: true,
        },
      },
    },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allowed = await userCanViewTicket({
    viewerId: ctx.user.id,
    role: ctx.user.role,
    ticket: { id: ticket.id, userId: ticket.userId },
    specialPermissions: ctx.user.specialPermissions,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const viewerArgs = {
    viewerId: ctx.user.id,
    role: ctx.user.role,
    specialPermissions: ctx.user.specialPermissions,
  } as const;

  const childRows = await db.ticket.findMany({
    where: { parentId: id },
    select: {
      id: true,
      shortId: true,
      title: true,
      userId: true,
      ticketScopeKey: true,
      ticketKeyNumber: true,
      project: { select: { ticketKeyPrefix: true } },
    },
    orderBy: { ticketKeyNumber: "asc" },
  });
  const childTickets: Array<{ id: string; ref: string; shortId: number; title: string }> = [];
  for (const row of childRows) {
    const can = await userCanViewTicket({
      ...viewerArgs,
      ticket: { id: row.id, userId: row.userId },
    });
    if (can) {
      childTickets.push({
        id: row.id,
        ref: buildTicketRefFromParts(row.ticketScopeKey, row.ticketKeyNumber, row.project?.ticketKeyPrefix),
        shortId: row.shortId,
        title: row.title,
      });
    }
  }

  const siblingTickets: Array<{ id: string; ref: string; shortId: number; title: string }> = [];
  if (ticket.parentId) {
    const sibRows = await db.ticket.findMany({
      where: { parentId: ticket.parentId, id: { not: id } },
      select: {
        id: true,
        shortId: true,
        title: true,
        userId: true,
        ticketScopeKey: true,
        ticketKeyNumber: true,
        project: { select: { ticketKeyPrefix: true } },
      },
      orderBy: { ticketKeyNumber: "asc" },
    });
    for (const row of sibRows) {
      const can = await userCanViewTicket({
        ...viewerArgs,
        ticket: { id: row.id, userId: row.userId },
      });
      if (can) {
        siblingTickets.push({
          id: row.id,
          ref: buildTicketRefFromParts(row.ticketScopeKey, row.ticketKeyNumber, row.project?.ticketKeyPrefix),
          shortId: row.shortId,
          title: row.title,
        });
      }
    }
  }

  const canViewAll = hasTicketTriageAccess(ctx.user.role, ctx.user.specialPermissions);
  const {
    _count,
    duplicateOf: dupRel,
    canonicalDuplicates: canonRels,
    parent: parentRow,
    sprintTickets,
    ...base
  } = ticket;
  const { project: rawProject, ...restBase } = base;
  const project = rawProject
    ? {
        id: rawProject.id,
        name: rawProject.name,
        ticketKeyPrefix: rawProject.ticketKeyPrefix,
        githubConnected: rawProject.githubConfig !== null,
      }
    : null;
  const sprintMembership = sprintTickets[0]?.sprint ?? null;
  const selfRef = buildTicketRefFromParts(
    base.ticketScopeKey,
    base.ticketKeyNumber,
    rawProject?.ticketKeyPrefix
  );
  return NextResponse.json({
    ...restBase,
    project,
    ref: selfRef,
    sprint: sprintMembership,
    parent: parentRow
      ? {
          id: parentRow.id,
          title: parentRow.title,
          ref: buildTicketRefFromParts(
            parentRow.ticketScopeKey,
            parentRow.ticketKeyNumber,
            parentRow.project?.ticketKeyPrefix
          ),
        }
      : null,
    commentsCount: _count.comments,
    duplicatesCount: _count.canonicalDuplicates,
    duplicateOf: dupRel
      ? {
          canonicalId: dupRel.canonicalId,
          canonical: {
            ...dupRel.canonical,
            ref: buildTicketRefFromParts(
              dupRel.canonical.ticketScopeKey,
              dupRel.canonical.ticketKeyNumber,
              dupRel.canonical.project?.ticketKeyPrefix
            ),
          },
        }
      : null,
    canonicalDuplicates: canonRels.map((link) => {
      const d = link.duplicate;
      return {
        id: link.id,
        duplicateId: link.duplicateId,
        duplicate: {
          ...d,
          ref: buildTicketRefFromParts(d.ticketScopeKey, d.ticketKeyNumber, d.project?.ticketKeyPrefix),
        },
      };
    }),
    childTickets,
    siblingTickets,
    viewerContext: viewerContextForTicket(ctx.user.id, canViewAll, ticket),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateTicketSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const wantsTitle = parsed.data.title !== undefined;
  const wantsTriage = parsed.data.status !== undefined || parsed.data.adminNote !== undefined;
  const wantsAssign = parsed.data.assigneeId !== undefined;
  const wantsPriority = parsed.data.priority !== undefined;
  const wantsParent = parsed.data.parentId !== undefined;
  const wantsProject = parsed.data.projectId !== undefined;
  const wantsStoryPoints = parsed.data.storyPoints !== undefined;
  const wantsTags = parsed.data.tagNames !== undefined;
  const wantsDescription = parsed.data.description !== undefined;
  const wantsType = parsed.data.type !== undefined;
  const wantsSprint = parsed.data.sprintId !== undefined;

  if (
    !wantsTitle &&
    !wantsTriage &&
    !wantsAssign &&
    !wantsPriority &&
    !wantsParent &&
    !wantsProject &&
    !wantsStoryPoints &&
    !wantsTags &&
    !wantsDescription &&
    !wantsType &&
    !wantsSprint
  ) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const existing = await db.ticket.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      assignee: { select: { id: true, name: true, email: true } },
      project: { select: { id: true, teamId: true, commandCenterProjectId: true } },
      sprintTickets: {
        take: 1,
        select: { sprint: { select: { teamId: true } } },
      },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const viewerId = ctx.user.id;
  const role = ctx.user.role;

  const canView = await userCanViewTicket({
    viewerId,
    role,
    ticket: { id: existing.id, userId: existing.userId },
    specialPermissions: ctx.user.specialPermissions,
  });
  if (!canView) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const inbox = hasTicketTriageAccess(role, ctx.user.specialPermissions);

  if (
    (wantsTriage ||
      wantsPriority ||
      wantsParent ||
      wantsProject ||
      wantsStoryPoints ||
      wantsTags ||
      wantsType ||
      wantsSprint) &&
    !inbox
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (parsed.data.status !== undefined) {
    let statusTeamId: string | null = existing.project?.teamId ?? existing.sprintTickets?.[0]?.sprint.teamId ?? null;
    if (!statusTeamId) {
      const teamParam = req.nextUrl.searchParams.get("team")?.trim() ?? null;
      const teamCtx = await resolveTeamContext(ctx.user.id, ctx.user.specialPermissions, teamParam);
      statusTeamId = teamCtx?.teamId ?? null;
    }
    if (!statusTeamId) {
      return NextResponse.json({ error: "A team context is required to update status" }, { status: 400 });
    }
    const validStatus = await db.teamBoardStatus.findUnique({
      where: { teamId_key: { teamId: statusTeamId, key: parsed.data.status } },
      select: { isEnabled: true },
    });
    if (!validStatus?.isEnabled) {
      return NextResponse.json({ error: `Invalid status "${parsed.data.status}" for this team.` }, { status: 400 });
    }
  }

  if (wantsDescription && existing.status === "ARCHIVED") {
    return NextResponse.json({ error: "Cannot edit description of an archived ticket" }, { status: 409 });
  }

  if (wantsTitle && existing.status === "ARCHIVED") {
    return NextResponse.json({ error: "Cannot edit title of an archived ticket" }, { status: 409 });
  }

  if (
    wantsAssign &&
    !canChangeTicketAssignee({
      viewerId,
      role,
      ticketUserId: existing.userId,
      specialPermissions: ctx.user.specialPermissions,
    })
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let nextAssigneeId: string | null | undefined = undefined;
  if (wantsAssign) {
    const raw = parsed.data.assigneeId;
    if (raw === null) {
      nextAssigneeId = null;
    } else {
      const candidate = await db.user.findUnique({
        where: { id: raw },
        select: {
          id: true,
          email: true,
          name: true,
          role: { select: { code: true } },
        },
      });
      if (!candidate) {
        return NextResponse.json({ error: "Assignee not found" }, { status: 400 });
      }
      if (!isAllowedTicketAssigneeRole(candidate.role.code)) {
        return NextResponse.json({ error: "That user cannot be assigned" }, { status: 400 });
      }
      nextAssigneeId = candidate.id;
    }
  }

  if (wantsParent) {
    const nextParentId = parsed.data.parentId ?? null;
    if (nextParentId !== null) {
      const parentTicket = await db.ticket.findUnique({
        where: { id: nextParentId },
        select: { userId: true },
      });
      if (!parentTicket) {
        return NextResponse.json({ error: "Parent ticket not found" }, { status: 400 });
      }
      const canViewParent = await userCanViewTicket({
        viewerId,
        role,
        ticket: { id: nextParentId, userId: parentTicket.userId },
        specialPermissions: ctx.user.specialPermissions,
      });
      if (!canViewParent) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }
    try {
      await assertValidParentAssignment(db, { ticketId: id, parentId: nextParentId });
    } catch (e) {
      if (e instanceof TicketParentValidationError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
      }
      throw e;
    }
  }

  if (wantsProject) {
    const nextPid = parsed.data.projectId ?? null;
    if (nextPid !== null) {
      const p = await db.project.findUnique({ where: { id: nextPid }, select: { id: true } });
      if (!p) {
        return NextResponse.json({ error: "Project not found" }, { status: 400 });
      }
    }
  }

  const detailInclude = {
    user: { select: { id: true, name: true, email: true } },
    ...assigneeInclude,
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
    tags: { select: { id: true, name: true }, orderBy: { name: "asc" as const } },
    duplicateOf: {
      include: {
        canonical: {
          select: {
            id: true,
            shortId: true,
            title: true,
            ticketScopeKey: true,
            ticketKeyNumber: true,
            project: { select: { ticketKeyPrefix: true } },
          },
        },
      },
    },
    canonicalDuplicates: {
      include: {
        duplicate: {
          select: {
            id: true,
            shortId: true,
            title: true,
            description: true,
            screenshot: true,
            pageUrl: true,
            createdAt: true,
            ticketScopeKey: true,
            ticketKeyNumber: true,
            user: { select: { id: true, name: true, email: true } },
            project: { select: { ticketKeyPrefix: true } },
          },
        },
      },
    },
    _count: {
      select: {
        comments: { where: { deletedAt: null } },
        canonicalDuplicates: true,
      },
    },
    sprintTickets: {
      take: 1,
      orderBy: { sprintId: "asc" },
      select: { sprint: { select: { id: true, name: true } } },
    },
  } as const;

  const nextDescription = wantsDescription ? parsed.data.description!.trim() : undefined;
  const nextTitle = wantsTitle ? parsed.data.title!.trim() : undefined;

  const nextProjectId = wantsProject ? (parsed.data.projectId ?? null) : undefined;
  const projectMove =
    wantsProject && nextProjectId !== undefined && nextProjectId !== existing.projectId;

  const baseData = {
    ...(nextTitle !== undefined && { title: nextTitle }),
    ...(parsed.data.status !== undefined && { status: parsed.data.status }),
    ...(parsed.data.adminNote !== undefined && {
      adminNote: parsed.data.adminNote,
    }),
    ...(wantsPriority && { priority: parsed.data.priority }),
    ...(wantsAssign && { assigneeId: nextAssigneeId }),
    ...(wantsParent && { parentId: parsed.data.parentId ?? null }),
    ...(wantsStoryPoints && { storyPoints: parsed.data.storyPoints }),
    ...(nextDescription !== undefined && { description: nextDescription }),
    ...(wantsType && { type: parsed.data.type }),
  };

  if (projectMove) {
    await db.$transaction(async (tx) => {
      const { ticketScopeKey, ticketKeyNumber } = await allocateKeyForProjectMove(tx, nextProjectId!);
      await tx.ticket.update({
        where: { id },
        data: {
          ...baseData,
          projectId: nextProjectId,
          ticketScopeKey,
          ticketKeyNumber,
        },
      });
    });
  } else {
    await db.ticket.update({
      where: { id },
      data: {
        ...baseData,
        ...(wantsProject && { projectId: nextProjectId ?? null }),
      },
    });
  }

  if (wantsSprint) {
    const nextSprintId = parsed.data.sprintId ?? null;
    if (nextSprintId !== null) {
      const sprintOk = await db.sprint.findUnique({ where: { id: nextSprintId }, select: { id: true } });
      if (!sprintOk) {
        return NextResponse.json({ error: "Sprint not found" }, { status: 400 });
      }
    }
    try {
      await db.$transaction(async (tx) => {
        await tx.sprintTicket.deleteMany({ where: { ticketId: id } });
        if (nextSprintId === null) return;
        const ticketRows = await tx.ticket.findMany({
          where: { id },
          select: { id: true, projectId: true },
        });
        if (ticketRows.length !== 1) {
          throw new Error("Ticket not found");
        }
        const otherActive = await loadOtherActiveSprintsForScope(nextSprintId);
        const blocked = ticketIdsBlockedByOtherActiveSprints(ticketRows, otherActive);
        if (blocked.has(id)) {
          throw new Error("SPRINT_CONFLICT");
        }
        await tx.sprintTicket.create({
          data: { sprintId: nextSprintId, ticketId: id },
        });
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "SPRINT_CONFLICT") {
        return NextResponse.json(
          {
            error:
              "One or more tickets are already part of another active sprint. Remove them from the other sprint or wait until that sprint is no longer active before adding them here.",
          },
          { status: 400 }
        );
      }
      throw e;
    }
  }

  const embedTitle = wantsTitle && nextTitle !== undefined ? nextTitle : existing.title;
  const embedDescription =
    wantsDescription && nextDescription !== undefined ? nextDescription : existing.description ?? "";
  const titleChangedForEmbed = wantsTitle && nextTitle !== undefined && nextTitle !== existing.title;
  const descriptionChangedForEmbed =
    wantsDescription && nextDescription !== undefined && nextDescription !== existing.description;
  if (titleChangedForEmbed || descriptionChangedForEmbed) {
    try {
      const embedding = await generateTicketEmbedding(embedTitle, embedDescription);
      await storeTicketEmbedding(id, embedding);
    } catch (err) {
      console.warn("[tickets PATCH] failed to refresh embedding:", err);
    }
  }

  if (wantsTags) {
    const raw = parsed.data.tagNames ?? [];
    const normalized = raw.flatMap((s) => parseTagInput(s));
    await setTicketTagsReplace(db, id, normalized);
  }

  const updated = await db.ticket.findUnique({
    where: { id },
    include: detailInclude,
  });
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const statusChanged =
    parsed.data.status !== undefined && parsed.data.status !== existing.status;

  if (
    statusChanged &&
    (parsed.data.status === "IN_PROGRESS" ||
      parsed.data.status === "RESOLVED" ||
      parsed.data.status === "DONE")
  ) {
    const notifType =
      parsed.data.status === "IN_PROGRESS" ? "TICKET_IN_PROGRESS" : "TICKET_RESOLVED";

    void createNotification({
      userId: existing.userId,
      ticketId: id,
      type: notifType,
    }).catch((err: unknown) => console.error("[tickets] notification:", err));

    const noteForEmail = parsed.data.adminNote ?? existing.adminNote;
    void sendTicketStatusEmail({
      to: existing.user.email,
      userName: existing.user.name,
      ticketTitle: existing.title,
      ticketType: existing.type,
      newStatus:
        parsed.data.status === "IN_PROGRESS" ? "IN_PROGRESS" : parsed.data.status === "DONE" ? "DONE" : "RESOLVED",
      adminNote: noteForEmail ?? null,
      ticketId: id,
    }).catch((err: unknown) => console.error("[tickets] status email:", err));

    const ccProjectId =
      existing.project?.commandCenterProjectId ??
      existing.project?.id ??
      existing.projectId;
    if (
      ccProjectId &&
      (parsed.data.status === "IN_PROGRESS" || parsed.data.status === "RESOLVED")
    ) {
      if (!existing.project?.commandCenterProjectId) {
        console.warn(
          "[cc-webhook] commandCenterProjectId not set on project — falling back to rad-dash projectId:",
          ccProjectId
        );
      }
      const ccStatus: CCTicketStatus = parsed.data.status === "IN_PROGRESS" ? "IN_PROGRESS" : "RESOLVED";
      void notifyCommandCenterStatusChange({
        commandCenterProjectId: ccProjectId,
        ticketId: id,
        newStatus: ccStatus,
      }).catch((err: unknown) => console.warn("[cc-webhook] status sync failed:", err));
    } else if (!ccProjectId) {
      console.warn(
        "[cc-webhook] skipping status sync — ticket has no project assigned (ticketId:",
        id,
        ")"
      );
    }

    const ftItemId = existing.fieldTrackerItemId;
    const ftProjectId = existing.project?.id ?? existing.projectId;
    if (
      existing.source === "FIELD_TRACKER" &&
      ftItemId &&
      ftProjectId &&
      (parsed.data.status === "IN_PROGRESS" || parsed.data.status === "RESOLVED")
    ) {
      const ftStatus: FTTicketStatus = parsed.data.status === "IN_PROGRESS" ? "IN_PROGRESS" : "RESOLVED";
      void notifyFieldTrackerStatusChange({
        projectId: ftProjectId,
        fieldTrackerItemId: ftItemId,
        newStatus: ftStatus,
      }).catch((err: unknown) => console.warn("[ft-webhook] status sync failed:", err));
    }
  }

  if (wantsAssign) {
    const prevId = existing.assigneeId;
    const newId = nextAssigneeId ?? null;
    const assigneeChanged = newId !== prevId;
    const shouldNotify = assigneeChanged && newId !== null && newId !== viewerId;

    if (shouldNotify) {
      const assigneeRow = await db.user.findUnique({
        where: { id: newId },
        select: { email: true, name: true },
      });
      if (assigneeRow?.email) {
        void createNotification({
          userId: newId,
          ticketId: id,
          type: "TICKET_ASSIGNED",
          actorId: viewerId,
          actorName: ctx.user.name ?? ctx.user.email ?? null,
        }).catch((err: unknown) => console.error("[tickets] assign notification:", err));

        void sendTicketAssignedEmail({
          to: assigneeRow.email,
          assigneeName: assigneeRow.name,
          assignerName: ctx.user.name ?? ctx.user.email ?? "Someone",
          ticketTitle: updated.title,
          ticketType: updated.type,
          ticketId: id,
          projectId: updated.project?.id ?? null,
        }).catch((err: unknown) => console.error("[tickets] assign email:", err));
      }
    }
  }

  const {
    _count,
    duplicateOf: dupPatch,
    canonicalDuplicates: canonPatch,
    parent: parentUpdated,
    sprintTickets: sprintTicketsPatch,
    ...baseUpdated
  } = updated;

  revalidateTicketsList();
  if (wantsTags) {
    revalidateTagsCatalog();
  }

  const patchRef = buildTicketRefFromParts(
    baseUpdated.ticketScopeKey,
    baseUpdated.ticketKeyNumber,
    baseUpdated.project?.ticketKeyPrefix
  );
  return NextResponse.json({
    ...baseUpdated,
    ref: patchRef,
    sprint: sprintTicketsPatch[0]?.sprint ?? null,
    parent: parentUpdated
      ? {
          id: parentUpdated.id,
          title: parentUpdated.title,
          ref: buildTicketRefFromParts(
            parentUpdated.ticketScopeKey,
            parentUpdated.ticketKeyNumber,
            parentUpdated.project?.ticketKeyPrefix
          ),
        }
      : null,
    commentsCount: _count.comments,
    duplicatesCount: _count.canonicalDuplicates,
    duplicateOf: dupPatch
      ? {
          canonicalId: dupPatch.canonicalId,
          canonical: {
            ...dupPatch.canonical,
            ref: buildTicketRefFromParts(
              dupPatch.canonical.ticketScopeKey,
              dupPatch.canonical.ticketKeyNumber,
              dupPatch.canonical.project?.ticketKeyPrefix
            ),
          },
        }
      : null,
    canonicalDuplicates: canonPatch.map((link) => {
      const d = link.duplicate;
      return {
        id: link.id,
        duplicateId: link.duplicateId,
        duplicate: {
          ...d,
          ref: buildTicketRefFromParts(d.ticketScopeKey, d.ticketKeyNumber, d.project?.ticketKeyPrefix),
        },
      };
    }),
    viewerContext: viewerContextForTicket(ctx.user.id, inbox, updated),
  });
}
