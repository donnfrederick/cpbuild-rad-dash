import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { sendTicketAssignedEmail, sendTicketSubmittedNotificationEmail } from "@/lib/email";
import { isAllowedTicketAssigneeRole } from "@/lib/ticket-assignment";
import { canChangeTicketAssignee, hasTicketTriageAccess } from "@/lib/ticket-access";
import { revalidateTagsCatalog, revalidateTicketsList } from "@/lib/list-cache";
import { TAG_NAME_MAX_LENGTH } from "@/lib/tag-normalize";
import { setTicketTagsReplace } from "@/lib/ticket-tags-db";
import { getCachedTicketsList, loadTicketsListPayload } from "@/lib/tickets-list-loader";
import { buildTicketRefFromParts, buildLegacyRadRef } from "@/lib/ticket-display-ref";
import { allocateNewTicketKey } from "@/lib/ticket-key";
import { createNotification } from "@/lib/notifications";
import { resolveTeamContext } from "@/lib/team-context";
import { PERMISSIONS } from "@/lib/permissions-core";
import {
  generateTicketEmbedding,
  storeTicketEmbedding,
  findSimilarByEmbedding,
  DEFAULT_DUPLICATE_THRESHOLD,
} from "@/lib/embeddings";
import {
  loadOtherActiveSprintsForScope,
  newTicketProjectBlockedByOtherActiveImplicitSprint,
} from "@/lib/sprint-other-active-scope";
export const dynamic = "force-dynamic";


const createTicketSchema = z.object({
  type: z.string().min(1).max(100),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(4000),
  screenshot: z.string().optional().nullable(),
  videoUrl: z.string().url().optional().nullable(),
  pageUrl: z.string().url().optional().nullable(),
  /** Omit, null, or empty string = ticket not tied to a project (unassigned scope). */
  projectId: z.preprocess(
    (val) => {
      if (val === undefined) return undefined;
      if (val === null) return null;
      if (typeof val === "string" && val.trim() === "") return null;
      return typeof val === "string" ? val.trim() : val;
    },
    z.union([z.string().min(1), z.null()]).optional()
  ),
  assigneeId: z.union([z.string().min(1), z.null()]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable().optional(),
  storyPoints: z.number().int().min(0).max(99).nullable().optional(),
  tagNames: z.array(z.string().max(TAG_NAME_MAX_LENGTH)).optional(),
  /** When set, links the new ticket to this sprint by creating an explicit `sprint_tickets` row; triage only. */
  sprintId: z.string().min(1).optional(),
  /** Initial status — defaults to BACKLOG when omitted. */
  status: z.string().min(1).max(100).optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createTicketSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid input",
        details: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      },
      { status: 400 }
    );
  }

  const {
    type,
    title,
    description,
    screenshot,
    videoUrl,
    pageUrl,
    projectId: rawProjectId,
    assigneeId: rawAssigneeId,
    priority: rawPriority,
    storyPoints: rawStoryPoints,
    tagNames: rawTagNames,
    sprintId: rawSprintId,
    status: rawStatus,
  } = parsed.data;

  const wantsAssign = rawAssigneeId !== undefined;
  const wantsPriority = rawPriority !== undefined;
  const wantsStoryPoints = rawStoryPoints !== undefined;
  const wantsTags = rawTagNames !== undefined;
  const wantsSprintLink = rawSprintId !== undefined;
  const inbox = hasTicketTriageAccess(ctx.user.role, ctx.user.specialPermissions);

  if ((wantsPriority || wantsStoryPoints || wantsTags || wantsSprintLink) && !inbox) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (
    wantsAssign &&
    !canChangeTicketAssignee({
      viewerId: ctx.user.id,
      role: ctx.user.role,
      ticketUserId: ctx.user.id,
      specialPermissions: ctx.user.specialPermissions,
    })
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let projectId: string | null = null;
  let statusTeamId: string | null = null;
  if (rawProjectId) {
    const p = await db.project.findUnique({ where: { id: rawProjectId }, select: { id: true, teamId: true } });
    if (!p) {
      return NextResponse.json({ error: "Project not found" }, { status: 400 });
    }
    projectId = p.id;
    statusTeamId = p.teamId;
  }

  let sprintLink: { id: string } | null = null;
  if (wantsSprintLink) {
    const s = await db.sprint.findUnique({
      where: { id: rawSprintId },
      select: { id: true, teamId: true },
    });
    if (!s) {
      return NextResponse.json({ error: "Sprint not found" }, { status: 400 });
    }
    sprintLink = { id: s.id };
    statusTeamId ??= s.teamId;
    if (projectId) {
      const otherActive = await loadOtherActiveSprintsForScope(rawSprintId!);
      const implicitBlock = newTicketProjectBlockedByOtherActiveImplicitSprint(projectId, otherActive);
      if (implicitBlock) {
        return NextResponse.json(
          {
            error:
              "That project is already in another active sprint that includes all tickets from that project. Choose a different project or change sprint dates.",
          },
          { status: 400 }
        );
      }
    }
  }

  const teamParam = req.nextUrl.searchParams.get("team")?.trim() ?? null;
  const teamCtx = await resolveTeamContext(ctx.user.id, ctx.user.specialPermissions, teamParam);
  statusTeamId ??= teamCtx?.teamId ?? null;

  if (rawStatus) {
    if (!statusTeamId) {
      return NextResponse.json({ error: "A team context is required to set an initial status" }, { status: 400 });
    }
    const validStatus = await db.teamBoardStatus.findUnique({
      where: { teamId_key: { teamId: statusTeamId, key: rawStatus } },
      select: { isEnabled: true },
    });
    if (!validStatus?.isEnabled) {
      return NextResponse.json({ error: `Invalid status "${rawStatus}" for this team.` }, { status: 400 });
    }
  }

  let resolvedAssigneeId: string | null | undefined = undefined;
  if (wantsAssign) {
    if (rawAssigneeId === null) {
      resolvedAssigneeId = null;
    } else {
      const candidate = await db.user.findUnique({
        where: { id: rawAssigneeId },
        select: {
          id: true,
          role: { select: { code: true } },
        },
      });
      if (!candidate) {
        return NextResponse.json({ error: "Assignee not found" }, { status: 400 });
      }
      if (!isAllowedTicketAssigneeRole(candidate.role.code)) {
        return NextResponse.json({ error: "That user cannot be assigned" }, { status: 400 });
      }
      resolvedAssigneeId = candidate.id;
    }
  }

  // allocateNewTicketKey uses INSERT...ON CONFLICT...RETURNING which is
  // already atomic at the SQL level — no interactive transaction needed.
  // Interactive transactions cause "Transaction not found" errors on Railway
  // when the connection pool drops the connection mid-flight.
  const { ticketScopeKey, ticketKeyNumber } = await allocateNewTicketKey(db, projectId);
  const ticket = await db.ticket.create({
    data: {
      userId: ctx.user.id,
      type,
      title: title.trim(),
      description: description.trim(),
      screenshot: screenshot ?? null,
      videoUrl: videoUrl ?? null,
      pageUrl: pageUrl ?? null,
      projectId,
      ticketScopeKey,
      ticketKeyNumber,
      ...(rawStatus && { status: rawStatus }),
      ...(wantsAssign && { assigneeId: resolvedAssigneeId }),
      ...(wantsPriority && { priority: rawPriority }),
      ...(wantsStoryPoints && { storyPoints: rawStoryPoints }),
    },
    include: {
      user: { select: { name: true, email: true } },
      project: { select: { ticketKeyPrefix: true } },
    },
  });
  if (sprintLink) {
    await db.sprintTicket
      .create({
        data: { sprintId: sprintLink.id, ticketId: ticket.id },
      })
      .catch((err: unknown) => {
        // Idempotent: duplicate link (e.g. retry) is fine
        const isDuplicate =
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code: string }).code === "P2002";
        if (!isDuplicate) throw err;
      });
  }

  if (wantsTags && rawTagNames && rawTagNames.length > 0) {
    await setTicketTagsReplace(db, ticket.id, rawTagNames);
  }

  void sendTicketSubmittedNotificationEmail({
    submitterName: ticket.user.name,
    submitterEmail: ticket.user.email,
    type,
    title: ticket.title,
    description: ticket.description,
    pageUrl: ticket.pageUrl,
    ticketId: ticket.id,
  }).catch((err: unknown) => {
    console.error("[tickets] Notification email failed (non-fatal):", err);
  });

  if (
    wantsAssign &&
    resolvedAssigneeId !== null &&
    resolvedAssigneeId !== undefined &&
    resolvedAssigneeId !== ctx.user.id
  ) {
    const assigneeRow = await db.user.findUnique({
      where: { id: resolvedAssigneeId },
      select: { email: true, name: true },
    });
    if (assigneeRow?.email) {
      void createNotification({
        userId: resolvedAssigneeId,
        ticketId: ticket.id,
        type: "TICKET_ASSIGNED",
        actorId: ctx.user.id,
        actorName: ctx.user.name ?? ctx.user.email ?? null,
      }).catch((err: unknown) => console.error("[tickets] assign notification:", err));

      void sendTicketAssignedEmail({
        to: assigneeRow.email,
        assigneeName: assigneeRow.name,
        assignerName: ctx.user.name ?? ctx.user.email ?? "Someone",
        ticketTitle: ticket.title,
        ticketType: ticket.type,
        ticketId: ticket.id,
        projectId: ticket.projectId ?? null,
      }).catch((err: unknown) => console.error("[tickets] assign email:", err));
    }
  }

  const { user, project, ...ticketPayload } = ticket;
  void user;
  const createRef = buildTicketRefFromParts(
    ticket.ticketScopeKey,
    ticket.ticketKeyNumber,
    project?.ticketKeyPrefix
  );
  revalidateTicketsList();
  if (wantsTags && rawTagNames && rawTagNames.length > 0) {
    revalidateTagsCatalog();
  }

  // Semantic duplicate detection: embed the new ticket, store it, and look
  // up similar existing tickets so the UI can offer a "link as duplicate"
  // prompt. Errors here are non-fatal — ticket creation already succeeded.
  let duplicateCandidates: Array<{
    id: string;
    ref: string;
    shortId: number;
    title: string;
    similarity: number;
  }> = [];
  try {
    const embedding = await generateTicketEmbedding(ticket.title, ticket.description);
    await storeTicketEmbedding(ticket.id, embedding);
    const similar = await findSimilarByEmbedding(embedding, {
      threshold: DEFAULT_DUPLICATE_THRESHOLD,
      limit: 5,
      excludeId: ticket.id,
      projectId: ticket.projectId ?? undefined,
    });
    const withRefs = await db.ticket.findMany({
      where: { id: { in: similar.map((c) => c.id) } },
      select: {
        id: true,
        shortId: true,
        ticketScopeKey: true,
        ticketKeyNumber: true,
        project: { select: { ticketKeyPrefix: true } },
      },
    });
    const refBy = new Map(
      withRefs.map((row) => [
        row.id,
        buildTicketRefFromParts(
          row.ticketScopeKey,
          row.ticketKeyNumber,
          row.project?.ticketKeyPrefix
        ),
      ])
    );
    duplicateCandidates = similar.map((s) => ({
      id: s.id,
      ref: refBy.get(s.id) ?? buildLegacyRadRef(s.shortId),
      shortId: s.shortId,
      title: s.title,
      similarity: s.similarity,
    }));
  } catch (err) {
    console.warn("[tickets] duplicate detection skipped:", err);
  }

  return NextResponse.json(
    { ...ticketPayload, ref: createRef, duplicateCandidates },
    { status: 201 }
  );
}

export async function GET(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = ctx.user.id;
  const role = ctx.user.role;
  const canViewAll = hasTicketTriageAccess(role, ctx.user.specialPermissions);
  const archivedList =
    req.nextUrl.searchParams.get("archived") === "true" ||
    req.nextUrl.searchParams.get("deleted") === "true";
  /** Client soft-refetch: skip `unstable_cache` so the UI sees writes immediately after bulk/PATCH. */
  const listFresh = req.nextUrl.searchParams.get("fresh") === "1";

  if (archivedList && !canViewAll) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const gpf = req.nextUrl.searchParams.get("gpf") === "1";
  const pidsRaw = req.nextUrl.searchParams.get("pids")?.trim() ?? "";
  const includeUnGlobal = req.nextUrl.searchParams.get("un") === "1";
  const projectIdParam = req.nextUrl.searchParams.get("projectId")?.trim() ?? "";
  const sprintIdParam = req.nextUrl.searchParams.get("sprintId")?.trim() ?? "";
  const projectIdsRaw = req.nextUrl.searchParams.get("projectIds")?.trim() ?? "";
  const projectIdsList =
    projectIdsRaw.length > 0
      ? [...new Set(projectIdsRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0))]
      : [];
  const sprintIdsRaw = req.nextUrl.searchParams.get("sprintIds")?.trim() ?? "";
  const sprintIdsList =
    sprintIdsRaw.length > 0
      ? [...new Set(sprintIdsRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0))]
      : [];

  if (gpf && (projectIdParam || sprintIdParam || projectIdsList.length > 0)) {
    return NextResponse.json(
      { error: "Do not mix gpf=1 with projectId, sprintId, or projectIds" },
      { status: 400 }
    );
  }

  if (projectIdParam && sprintIdParam) {
    return NextResponse.json({ error: "Use either projectId or sprintId, not both" }, { status: 400 });
  }
  if (projectIdParam && projectIdsList.length > 0) {
    return NextResponse.json({ error: "Use either projectId or projectIds, not both" }, { status: 400 });
  }
  if (sprintIdParam && projectIdsList.length > 0) {
    return NextResponse.json({ error: "Do not combine sprintId with projectIds" }, { status: 400 });
  }
  if (sprintIdParam && sprintIdsList.length > 0) {
    return NextResponse.json(
      { error: "Use either sprintId or sprintIds, not both" },
      { status: 400 }
    );
  }
  if (sprintIdsList.length > 0 && (projectIdParam || projectIdsList.length > 0)) {
    return NextResponse.json(
      { error: "Do not combine sprintIds with projectId or projectIds (use gpf for project narrowing)" },
      { status: 400 }
    );
  }

  let globalProjectIdList: string[] = [];
  if (gpf) {
    globalProjectIdList = pidsRaw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (globalProjectIdList.length > 0) {
      const found = await db.project.findMany({
        where: { id: { in: globalProjectIdList } },
        select: { id: true },
      });
      if (found.length !== globalProjectIdList.length) {
        return NextResponse.json({ error: "One or more projects not found" }, { status: 404 });
      }
    }
  }

  if (projectIdParam && projectIdParam !== "unassigned") {
    const projectExists = await db.project.findUnique({
      where: { id: projectIdParam },
      select: { id: true },
    });
    if (!projectExists) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
  }

  if (sprintIdParam) {
    const sprintExists = await db.sprint.findUnique({
      where: { id: sprintIdParam },
      select: { id: true },
    });
    if (!sprintExists) {
      return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
    }
  }

  if (sprintIdsList.length > 0) {
    const found = await db.sprint.findMany({
      where: { id: { in: sprintIdsList } },
      select: { id: true },
    });
    if (found.length !== sprintIdsList.length) {
      return NextResponse.json({ error: "One or more sprints were not found" }, { status: 404 });
    }
  }

  if (projectIdsList.length > 0) {
    const found = await db.project.findMany({
      where: { id: { in: projectIdsList } },
      select: { id: true },
    });
    if (found.length !== projectIdsList.length) {
      return NextResponse.json({ error: "One or more projects were not found" }, { status: 400 });
    }
  }

  const teamParam = req.nextUrl.searchParams.get("team")?.trim() ?? null;
  const teamCtx = await resolveTeamContext(ctx.user.id, ctx.user.specialPermissions, teamParam);

  const loaderInput = {
    userId,
    role,
    specialPermissions: ctx.user.specialPermissions,
    projectIdParam: projectIdParam || null,
    sprintIdParam: sprintIdParam || null,
    projectIdsParam: projectIdsList.length > 0 ? projectIdsList : null,
    sprintIdsParam: sprintIdsList.length > 0 ? sprintIdsList : null,
    archivedList,
    globalProjectFilter: gpf,
    globalProjectIdList,
    includeUnassignedGlobal: gpf && includeUnGlobal,
    teamId: teamCtx?.teamId ?? null,
  };

  const { tickets: payload } = listFresh
    ? await loadTicketsListPayload(loaderInput)
    : await getCachedTicketsList(loaderInput);

  return NextResponse.json(
    { tickets: payload },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}
