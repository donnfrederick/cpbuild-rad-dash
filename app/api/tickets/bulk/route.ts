import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { sendTicketAssignedEmail, sendTicketStatusEmail } from "@/lib/email";
import { createNotification } from "@/lib/notifications";
import { isAllowedTicketAssigneeRole } from "@/lib/ticket-assignment";
import {
  canChangeTicketAssignee,
  hasTicketTriageAccess,
  userCanViewTicket,
} from "@/lib/ticket-access";
import { assertValidParentAssignment, TicketParentValidationError } from "@/lib/ticket-parent";
import { revalidateTagsCatalog, revalidateTicketsList } from "@/lib/list-cache";
import { parseTagInput, TAG_NAME_MAX_LENGTH } from "@/lib/tag-normalize";
import { setTicketTagsAdd, setTicketTagsRemove, setTicketTagsReplace } from "@/lib/ticket-tags-db";
import { allocateKeyForProjectMove } from "@/lib/ticket-key";
import { resolveTeamContext } from "@/lib/team-context";

const bulkBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("setStatus"),
    ticketIds: z.array(z.string().min(1)).min(1).max(200),
    status: z.string().min(1).max(100),
  }),
  z.object({
    action: z.literal("setPriority"),
    ticketIds: z.array(z.string().min(1)).min(1).max(200),
    priority: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable(),
  }),
  z.object({
    action: z.literal("setAssignee"),
    ticketIds: z.array(z.string().min(1)).min(1).max(200),
    assigneeId: z.union([z.string().min(1), z.null()]),
  }),
  z.object({
    action: z.literal("archive"),
    ticketIds: z.array(z.string().min(1)).min(1).max(200),
  }),
  z.object({
    action: z.literal("setParent"),
    ticketIds: z.array(z.string().min(1)).min(1).max(200),
    parentId: z.string().min(1),
  }),
  z.object({
    action: z.literal("setProject"),
    ticketIds: z.array(z.string().min(1)).min(1).max(200),
    projectId: z.union([z.string().min(1), z.null()]),
  }),
  z.object({
    action: z.literal("setStoryPoints"),
    ticketIds: z.array(z.string().min(1)).min(1).max(200),
    storyPoints: z.number().int().min(0).max(99).nullable(),
  }),
  z.object({
    action: z.literal("setTags"),
    ticketIds: z.array(z.string().min(1)).min(1).max(200),
    mode: z.enum(["replace", "add", "remove"]),
    tagNames: z.array(z.string().max(TAG_NAME_MAX_LENGTH)),
  }),
]);

export type BulkResultRow = { id: string; ok: boolean; error?: string };

function respondWithBulkResults(
  results: BulkResultRow[],
  options?: { invalidateTags?: boolean }
): NextResponse {
  revalidateTicketsList();
  if (options?.invalidateTags) {
    revalidateTagsCatalog();
  }
  return NextResponse.json({ results });
}

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bulkBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const viewerId = ctx.user.id;
  const role = ctx.user.role;
  const inbox = hasTicketTriageAccess(role, ctx.user.specialPermissions);

  const data = parsed.data;
  const ticketIds = [...new Set(data.ticketIds)];

  const results: BulkResultRow[] = [];

  if (data.action === "setStatus") {
    if (!inbox) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { status: nextStatus } = data;
    const teamParam = req.nextUrl.searchParams.get("team")?.trim() ?? null;
    const teamCtx = await resolveTeamContext(ctx.user.id, ctx.user.specialPermissions, teamParam);
    for (const id of ticketIds) {
      const row = await db.ticket.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, name: true, email: true } },
          project: { select: { teamId: true } },
          sprintTickets: {
            take: 1,
            select: { sprint: { select: { teamId: true } } },
          },
        },
      });
      if (!row) {
        results.push({ id, ok: false, error: "Not found" });
        continue;
      }
      const canView = await userCanViewTicket({
        viewerId,
        role,
        ticket: { id: row.id, userId: row.userId },
        specialPermissions: ctx.user.specialPermissions,
      });
      if (!canView) {
        results.push({ id, ok: false, error: "Not found" });
        continue;
      }
      if (row.status === nextStatus) {
        results.push({ id, ok: true });
        continue;
      }
      const statusTeamId = row.project?.teamId ?? row.sprintTickets[0]?.sprint.teamId ?? teamCtx?.teamId ?? null;
      if (!statusTeamId) {
        results.push({ id, ok: false, error: "A team context is required to update status" });
        continue;
      }
      const validStatus = await db.teamBoardStatus.findUnique({
        where: { teamId_key: { teamId: statusTeamId, key: nextStatus } },
        select: { isEnabled: true },
      });
      if (!validStatus?.isEnabled) {
        results.push({ id, ok: false, error: `Invalid status "${nextStatus}" for this team.` });
        continue;
      }
      await db.ticket.update({
        where: { id },
        data: { status: nextStatus },
      });
      if (nextStatus === "IN_PROGRESS" || nextStatus === "RESOLVED" || nextStatus === "DONE") {
        const notifType = nextStatus === "IN_PROGRESS" ? "TICKET_IN_PROGRESS" : "TICKET_RESOLVED";
        void createNotification({
          userId: row.userId,
          ticketId: id,
          type: notifType,
        }).catch((err: unknown) => console.error("[tickets/bulk] notification:", err));

        void sendTicketStatusEmail({
          to: row.user.email,
          userName: row.user.name,
          ticketTitle: row.title,
          ticketType: row.type,
          newStatus:
            nextStatus === "IN_PROGRESS" ? "IN_PROGRESS" : nextStatus === "DONE" ? "DONE" : "RESOLVED",
          adminNote: row.adminNote ?? null,
          ticketId: id,
        }).catch((err: unknown) => console.error("[tickets/bulk] status email:", err));
      }
      results.push({ id, ok: true });
    }
    return respondWithBulkResults(results);
  }

  if (data.action === "setPriority") {
    if (!inbox) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { priority } = data;
    for (const id of ticketIds) {
      const row = await db.ticket.findUnique({ where: { id }, select: { id: true, userId: true } });
      if (!row) {
        results.push({ id, ok: false, error: "Not found" });
        continue;
      }
      const canView = await userCanViewTicket({
        viewerId,
        role,
        ticket: { id: row.id, userId: row.userId },
        specialPermissions: ctx.user.specialPermissions,
      });
      if (!canView) {
        results.push({ id, ok: false, error: "Not found" });
        continue;
      }
      await db.ticket.update({ where: { id }, data: { priority } });
      results.push({ id, ok: true });
    }
    return respondWithBulkResults(results);
  }

  if (data.action === "setAssignee") {
    const { assigneeId: rawAssignee } = data;
    let nextAssigneeId: string | null;
    if (rawAssignee === null) {
      nextAssigneeId = null;
    } else {
      const candidate = await db.user.findUnique({
        where: { id: rawAssignee },
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

    for (const id of ticketIds) {
      const row = await db.ticket.findUnique({
        where: { id },
        select: {
          id: true,
          userId: true,
          assigneeId: true,
          title: true,
          type: true,
          projectId: true,
          user: { select: { email: true, name: true } },
        },
      });
      if (!row) {
        results.push({ id, ok: false, error: "Not found" });
        continue;
      }
      const canView = await userCanViewTicket({
        viewerId,
        role,
        ticket: { id: row.id, userId: row.userId },
        specialPermissions: ctx.user.specialPermissions,
      });
      if (!canView) {
        results.push({ id, ok: false, error: "Not found" });
        continue;
      }
      if (
        !canChangeTicketAssignee({
          viewerId,
          role,
          ticketUserId: row.userId,
          specialPermissions: ctx.user.specialPermissions,
        })
      ) {
        results.push({ id, ok: false, error: "Forbidden" });
        continue;
      }
      const prevId = row.assigneeId;
      const newId = nextAssigneeId;
      await db.ticket.update({ where: { id }, data: { assigneeId: newId } });
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
          }).catch((err: unknown) => console.error("[tickets/bulk] assign notification:", err));

          void sendTicketAssignedEmail({
            to: assigneeRow.email,
            assigneeName: assigneeRow.name,
            assignerName: ctx.user.name ?? ctx.user.email ?? "Someone",
            ticketTitle: row.title,
            ticketType: row.type,
            ticketId: id,
            projectId: row.projectId,
          }).catch((err: unknown) => console.error("[tickets/bulk] assign email:", err));
        }
      }
      results.push({ id, ok: true });
    }
    return respondWithBulkResults(results);
  }

  if (data.action === "archive") {
    if (!inbox) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    for (const id of ticketIds) {
      const row = await db.ticket.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });
      if (!row) {
        results.push({ id, ok: false, error: "Not found" });
        continue;
      }
      const canView = await userCanViewTicket({
        viewerId,
        role,
        ticket: { id: row.id, userId: row.userId },
        specialPermissions: ctx.user.specialPermissions,
      });
      if (!canView) {
        results.push({ id, ok: false, error: "Not found" });
        continue;
      }
      if (row.status === "ARCHIVED") {
        results.push({ id, ok: true });
        continue;
      }
      await db.ticket.update({ where: { id }, data: { status: "ARCHIVED" } });
      results.push({ id, ok: true });
    }
    return respondWithBulkResults(results);
  }

  if (data.action === "setParent") {
    if (!inbox) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { parentId } = data;
    const parentTicket = await db.ticket.findUnique({
      where: { id: parentId },
      select: { userId: true },
    });
    if (!parentTicket) {
      return NextResponse.json({ error: "Parent ticket not found" }, { status: 400 });
    }
    const canViewParent = await userCanViewTicket({
      viewerId,
      role,
      ticket: { id: parentId, userId: parentTicket.userId },
      specialPermissions: ctx.user.specialPermissions,
    });
    if (!canViewParent) {
      return NextResponse.json({ error: "Parent not found" }, { status: 404 });
    }

    const targets = ticketIds.filter((tid) => tid !== parentId);

    for (const id of targets) {
      const row = await db.ticket.findUnique({ where: { id }, select: { id: true, userId: true } });
      if (!row) {
        results.push({ id, ok: false, error: "Not found" });
        continue;
      }
      const canView = await userCanViewTicket({
        viewerId,
        role,
        ticket: { id: row.id, userId: row.userId },
        specialPermissions: ctx.user.specialPermissions,
      });
      if (!canView) {
        results.push({ id, ok: false, error: "Not found" });
        continue;
      }
      try {
        await assertValidParentAssignment(db, { ticketId: id, parentId });
      } catch (e) {
        if (e instanceof TicketParentValidationError) {
          results.push({ id, ok: false, error: e.message });
          continue;
        }
        throw e;
      }
      await db.ticket.update({ where: { id }, data: { parentId } });
      results.push({ id, ok: true });
    }

    return respondWithBulkResults(results);
  }

  if (data.action === "setProject") {
    if (!inbox) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { projectId: nextPid } = data;
    if (nextPid !== null) {
      const p = await db.project.findUnique({ where: { id: nextPid }, select: { id: true } });
      if (!p) {
        return NextResponse.json({ error: "Project not found" }, { status: 400 });
      }
    }
    for (const id of ticketIds) {
      const row = await db.ticket.findUnique({
        where: { id },
        select: { id: true, userId: true, projectId: true },
      });
      if (!row) {
        results.push({ id, ok: false, error: "Not found" });
        continue;
      }
      const canView = await userCanViewTicket({
        viewerId,
        role,
        ticket: { id: row.id, userId: row.userId },
        specialPermissions: ctx.user.specialPermissions,
      });
      if (!canView) {
        results.push({ id, ok: false, error: "Not found" });
        continue;
      }
      if (row.projectId === nextPid) {
        results.push({ id, ok: true });
        continue;
      }
      try {
        await db.$transaction(async (tx) => {
          const { ticketScopeKey, ticketKeyNumber } = await allocateKeyForProjectMove(tx, nextPid);
          await tx.ticket.update({
            where: { id },
            data: { projectId: nextPid, ticketScopeKey, ticketKeyNumber },
          });
        });
        results.push({ id, ok: true });
      } catch {
        results.push({ id, ok: false, error: "Update failed" });
      }
    }
    return respondWithBulkResults(results);
  }

  if (data.action === "setStoryPoints") {
    if (!inbox) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { storyPoints } = data;
    for (const id of ticketIds) {
      const row = await db.ticket.findUnique({ where: { id }, select: { id: true, userId: true } });
      if (!row) {
        results.push({ id, ok: false, error: "Not found" });
        continue;
      }
      const canView = await userCanViewTicket({
        viewerId,
        role,
        ticket: { id: row.id, userId: row.userId },
        specialPermissions: ctx.user.specialPermissions,
      });
      if (!canView) {
        results.push({ id, ok: false, error: "Not found" });
        continue;
      }
      await db.ticket.update({ where: { id }, data: { storyPoints } });
      results.push({ id, ok: true });
    }
    return respondWithBulkResults(results);
  }

  if (data.action === "setTags") {
    if (!inbox) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { mode, tagNames: rawNames } = data;
    const normalized = rawNames.flatMap((s) => parseTagInput(s));
    for (const id of ticketIds) {
      const row = await db.ticket.findUnique({ where: { id }, select: { id: true, userId: true } });
      if (!row) {
        results.push({ id, ok: false, error: "Not found" });
        continue;
      }
      const canView = await userCanViewTicket({
        viewerId,
        role,
        ticket: { id: row.id, userId: row.userId },
        specialPermissions: ctx.user.specialPermissions,
      });
      if (!canView) {
        results.push({ id, ok: false, error: "Not found" });
        continue;
      }
      try {
        if (mode === "replace") {
          await setTicketTagsReplace(db, id, normalized);
        } else if (mode === "add") {
          await setTicketTagsAdd(db, id, normalized);
        } else {
          await setTicketTagsRemove(db, id, normalized);
        }
      } catch (e: unknown) {
        results.push({ id, ok: false, error: e instanceof Error ? e.message : "Tag update failed" });
        continue;
      }
      results.push({ id, ok: true });
    }
    return respondWithBulkResults(results, { invalidateTags: true });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 500 });
}
