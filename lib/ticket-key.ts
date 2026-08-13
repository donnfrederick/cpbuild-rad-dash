import type { Prisma, PrismaClient } from "@prisma/client";
import { UNASSIGNED_TICKET_SCOPE } from "@/lib/ticket-scopes";

type DbLike = PrismaClient | Prisma.TransactionClient;

/**
 * Atomically increments the counter for a scope and returns the new `ticketKeyNumber` (1-based sequence).
 * Uses Postgres upsert with RETURNING.
 */
export async function nextTicketKeyNumberInScope(tx: DbLike, scopeKey: string): Promise<number> {
  const result = await tx.$queryRaw<Array<{ n: number }>>`
    INSERT INTO "ticket_key_counters" ("scopeKey", "lastNumber")
    VALUES (${scopeKey}, 1)
    ON CONFLICT ("scopeKey")
    DO UPDATE SET "lastNumber" = "ticket_key_counters"."lastNumber" + 1
    RETURNING "lastNumber" AS n
  `;
  const n = result[0]?.n;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) {
    throw new Error("ticket_key_counters: failed to allocate number");
  }
  return n;
}

export function scopeKeyForProjectId(projectId: string): string {
  return projectId;
}

export function isUnassignedScopeKey(scope: string): boolean {
  return scope === UNASSIGNED_TICKET_SCOPE;
}

export async function allocateNewTicketKey(
  tx: DbLike,
  projectId: string | null
): Promise<{ ticketScopeKey: string; ticketKeyNumber: number }> {
  if (projectId) {
    const n = await nextTicketKeyNumberInScope(tx, scopeKeyForProjectId(projectId));
    return { ticketScopeKey: projectId, ticketKeyNumber: n };
  }
  const n = await nextTicketKeyNumberInScope(tx, UNASSIGNED_TICKET_SCOPE);
  return { ticketScopeKey: UNASSIGNED_TICKET_SCOPE, ticketKeyNumber: n };
}

/**
 * Reassigns key when a ticket's project (or unassigned) changes. Allocates a new number in the target scope.
 * Caller must set `projectId` on the ticket in the same transaction after this returns.
 */
export async function allocateKeyForProjectMove(
  _tx: DbLike,
  nextProjectId: string | null
): Promise<{ ticketScopeKey: string; ticketKeyNumber: number }> {
  // Note: do not deallocate from old scope — number stays a gap (acceptable).
  return allocateNewTicketKey(_tx, nextProjectId);
}

/**
 * Re-sync counters with existing max (e.g. after data migration or manual fix).
 */
export async function resyncKeyCounterForScope(
  client: PrismaClient,
  scopeKey: string
): Promise<void> {
  const agg = await client.ticket.aggregate({
    where: { ticketScopeKey: scopeKey },
    _max: { ticketKeyNumber: true },
  });
  const maxN = agg._max.ticketKeyNumber ?? 0;
  if (maxN < 1) {
    return;
  }
  await client.ticketKeyCounter.upsert({
    where: { scopeKey },
    create: { scopeKey, lastNumber: maxN },
    update: { lastNumber: maxN },
  });
}