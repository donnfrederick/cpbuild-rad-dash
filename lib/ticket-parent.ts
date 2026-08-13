import type { PrismaClient } from "@prisma/client";

export class TicketParentValidationError extends Error {
  constructor(
    message: string,
    readonly code: "SELF_PARENT" | "CYCLE" | "PARENT_NOT_FOUND"
  ) {
    super(message);
    this.name = "TicketParentValidationError";
  }
}

/**
 * Walks upward from `proposedParentId` using `getParent`. Returns true if `ticketId` is reached
 * (assigning `ticketId.parentId = proposedParentId` would create a cycle).
 */
export function wouldAssigningParentCreateCycle(
  ticketId: string,
  proposedParentId: string,
  getParent: (id: string) => string | null | undefined
): boolean {
  const visited = new Set<string>();
  let current: string | null | undefined = proposedParentId;
  while (current) {
    if (current === ticketId) return true;
    if (visited.has(current)) return true;
    visited.add(current);
    const next = getParent(current);
    current = next ?? null;
  }
  return false;
}

export async function assertValidParentAssignment(
  db: Pick<PrismaClient, "ticket">,
  args: { ticketId: string; parentId: string | null }
): Promise<void> {
  const { ticketId, parentId } = args;

  if (parentId === null) {
    return;
  }

  if (parentId === ticketId) {
    throw new TicketParentValidationError("A ticket cannot be its own parent", "SELF_PARENT");
  }

  const parentRow = await db.ticket.findUnique({
    where: { id: parentId },
    select: { id: true },
  });
  if (!parentRow) {
    throw new TicketParentValidationError("Parent ticket not found", "PARENT_NOT_FOUND");
  }

  let cursor: string | null = parentId;
  const visited = new Set<string>();
  while (cursor !== null) {
    const current: string = cursor;
    if (current === ticketId) {
      throw new TicketParentValidationError(
        "That parent would create a cycle in the ticket hierarchy",
        "CYCLE"
      );
    }
    if (visited.has(current)) {
      break;
    }
    visited.add(current);
    const node: { parentId: string | null } | null = await db.ticket.findUnique({
      where: { id: current },
      select: { parentId: true },
    });
    if (!node) break;
    cursor = node.parentId;
  }
}
