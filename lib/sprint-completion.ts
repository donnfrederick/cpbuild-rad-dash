import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ticketMainInboxVisibilityWhere } from "@/lib/ticket-access";
import { ticketWhereForSprintScope, type SprintScopeRow } from "@/lib/sprint-ticket-where";
import type { SprintCompletionTicketRow } from "@/lib/sprint-completion-preview";
export type { SprintCompletionCarryoverRow, SprintCompletionPreview } from "@/lib/sprint-completion-types";
export type { SprintCompletionTicketRow } from "@/lib/sprint-completion-preview";
export { buildSprintCompletionPreview } from "@/lib/sprint-completion-preview";

const sprintScopeSelect = {
  teamId: true,
  completedAt: true,
  projects: { select: { projectId: true } },
  sprintTickets: { select: { ticketId: true } },
  _count: { select: { sprintTickets: true } },
} satisfies Prisma.SprintSelect;

export interface SprintCompletionScopeRow {
  teamId: string;
  completedAt: Date | null;
  projects: Array<{ projectId: string }>;
  sprintTickets: Array<{ ticketId: string }>;
  _count: { sprintTickets: number };
}

function scopeFromRow(row: SprintCompletionScopeRow): SprintScopeRow {
  return {
    projects: row.projects,
    sprintTickets: row.sprintTickets,
  };
}

export function ticketWhereForSprintCompletion(row: SprintCompletionScopeRow): Prisma.TicketWhereInput {
  return {
    AND: [ticketMainInboxVisibilityWhere(), ticketWhereForSprintScope(scopeFromRow(row))],
  };
}

const ticketSelectForCompletion = {
  id: true,
  title: true,
  status: true,
  storyPoints: true,
  ticketScopeKey: true,
  ticketKeyNumber: true,
  project: { select: { ticketKeyPrefix: true } },
} satisfies Prisma.TicketSelect;

export async function loadSprintCompletionScopeRow(
  tx: Prisma.TransactionClient | typeof db,
  sprintId: string
): Promise<SprintCompletionScopeRow | null> {
  const row = await tx.sprint.findUnique({
    where: { id: sprintId },
    select: sprintScopeSelect,
  });
  return row as SprintCompletionScopeRow | null;
}

export async function loadTicketsForSprintCompletion(
  tx: Prisma.TransactionClient | typeof db,
  scopeRow: SprintCompletionScopeRow
): Promise<SprintCompletionTicketRow[]> {
  const rows = await tx.ticket.findMany({
    where: ticketWhereForSprintCompletion(scopeRow),
    select: ticketSelectForCompletion,
  });
  return rows as SprintCompletionTicketRow[];
}

/**
 * When the target sprint uses implicit membership (no `sprint_tickets` rows), materialize
 * every in-scope ticket so the board stays complete after we add explicit carried-over rows.
 */
export async function materializeImplicitSprintTicketSet(
  tx: Prisma.TransactionClient,
  nextSprintId: string
): Promise<void> {
  const next = await tx.sprint.findUnique({
    where: { id: nextSprintId },
    select: sprintScopeSelect,
  });
  if (!next) {
    throw new Error("NEXT_SPRINT_NOT_FOUND");
  }
  if (next._count.sprintTickets > 0) {
    return;
  }
  const ids = await tx.ticket.findMany({
    where: ticketWhereForSprintCompletion(next),
    select: { id: true },
  });
  if (ids.length === 0) return;
  await tx.sprintTicket.createMany({
    data: ids.map(({ id }) => ({
      sprintId: nextSprintId,
      ticketId: id,
      isCarriedOver: false,
    })),
    skipDuplicates: true,
  });
}

export async function upsertCarriedTickets(
  tx: Prisma.TransactionClient,
  nextSprintId: string,
  carryoverTicketIds: string[]
): Promise<void> {
  for (const ticketId of carryoverTicketIds) {
    await tx.sprintTicket.upsert({
      where: { sprintId_ticketId: { sprintId: nextSprintId, ticketId } },
      create: { sprintId: nextSprintId, ticketId, isCarriedOver: true },
      update: { isCarriedOver: true },
    });
  }
}
