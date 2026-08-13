import type { Prisma } from "@prisma/client";
import { hasTicketTriageAccess } from "@/lib/ticket-triage";

export { hasTicketTriageAccess } from "@/lib/ticket-triage";

export async function getMentionedTicketIds(userId: string): Promise<string[]> {
  const { db } = await import("@/lib/db");
  const rows = await db.ticketMention.findMany({
    where: { mentionedUserId: userId },
    select: { ticketId: true },
  });
  return [...new Set(rows.map((r) => r.ticketId))];
}

export function ticketListWhereClause(
  userId: string,
  role: string,
  mentionedIds: string[],
  specialPermissions?: string[],
  teamId?: string | null
): Prisma.TicketWhereInput | undefined {
  if (hasTicketTriageAccess(role, specialPermissions)) return undefined;
  const or: Prisma.TicketWhereInput[] = [{ userId }];
  if (mentionedIds.length > 0) {
    or.push({ id: { in: mentionedIds } });
  }
  // Team members can see all tickets scoped to their team (project tickets and
  // sprint-linked general tickets), not just their own.
  if (teamId) {
    or.push({ project: { teamId } });
    or.push({ projectId: null, sprintTickets: { some: { sprint: { teamId } } } });
  }
  return { OR: or };
}

/** Main inbox: not archived, not hidden as a duplicate-of row. */
export function ticketMainInboxVisibilityWhere(): Prisma.TicketWhereInput {
  return {
    status: { not: "ARCHIVED" },
    duplicateOf: { is: null },
  };
}

export type TicketViewerContext = "submitter" | "mentioned";

export function viewerContextForTicket(
  viewerId: string,
  canViewAll: boolean,
  ticket: { userId: string }
): TicketViewerContext | undefined {
  if (canViewAll) return undefined;
  if (ticket.userId === viewerId) return "submitter";
  return "mentioned";
}

export async function userCanViewTicket(args: {
  viewerId: string;
  role: string;
  ticket: { id: string; userId: string };
  specialPermissions?: string[];
}): Promise<boolean> {
  const { viewerId, role, ticket, specialPermissions } = args;
  const { db } = await import("@/lib/db");
  const row = await db.ticket.findUnique({
    where: { id: ticket.id },
    select: { userId: true, status: true, projectId: true },
  });
  if (!row) return false;

  const triage = hasTicketTriageAccess(role, specialPermissions);
  if (row.status === "ARCHIVED" && !triage) return false;
  if (triage) return true;
  if (row.userId === viewerId) return true;

  const m = await db.ticketMention.findUnique({
    where: {
      ticketId_mentionedUserId: {
        ticketId: ticket.id,
        mentionedUserId: viewerId,
      },
    },
    select: { id: true },
  });
  if (m) return true;

  // Team members can view any ticket that belongs to their team's projects or sprints.
  if (row.projectId) {
    const project = await db.project.findUnique({
      where: { id: row.projectId },
      select: { teamId: true },
    });
    if (project?.teamId) {
      const membership = await db.teamMembership.findUnique({
        where: { userId_teamId: { userId: viewerId, teamId: project.teamId } },
        select: { teamId: true },
      });
      if (membership) return true;
    }
  } else {
    const sprintLink = await db.sprintTicket.findFirst({
      where: { ticketId: ticket.id },
      select: { sprint: { select: { teamId: true } } },
    });
    if (sprintLink?.sprint?.teamId) {
      const membership = await db.teamMembership.findUnique({
        where: { userId_teamId: { userId: viewerId, teamId: sprintLink.sprint.teamId } },
        select: { teamId: true },
      });
      if (membership) return true;
    }
  }

  return false;
}

export function canChangeTicketAssignee(args: {
  viewerId: string;
  role: string;
  ticketUserId: string;
  specialPermissions?: string[];
}): boolean {
  const { viewerId, role, ticketUserId, specialPermissions } = args;
  if (ticketUserId === viewerId) return true;
  return hasTicketTriageAccess(role, specialPermissions);
}
