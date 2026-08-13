import "server-only";
import { db } from "@/lib/db";
import { sseEmit } from "@/lib/sse-notification-registry";
import type { NotificationItem } from "@/components/notifications/NotificationCard";
import type { TicketTypeKind } from "@/components/tickets/ticket-types";

export interface NotificationCreateInput {
  userId: string;
  type: "TICKET_IN_PROGRESS" | "TICKET_RESOLVED" | "TICKET_ASSIGNED" | "MENTIONED_IN_COMMENT";
  ticketId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  mentionCommentId?: string | null;
}

const ticketSelect = {
  id: true,
  type: true,
  title: true,
  status: true,
  projectId: true,
} as const;

export async function createNotification(data: NotificationCreateInput): Promise<void> {
  const n = await db.notification.create({
    data,
    include: { ticket: { select: ticketSelect } },
  });

  const item: NotificationItem = {
    id: n.id,
    type: n.type as NotificationItem["type"],
    read: n.read,
    createdAt: n.createdAt.toISOString(),
    ticket: n.ticket
      ? {
          ...n.ticket,
          type: n.ticket.type as TicketTypeKind,
        }
      : null,
    actorName: n.actorName,
    mentionCommentId: n.mentionCommentId,
  };

  sseEmit(n.userId, item);
}

export async function createManyNotifications(data: NotificationCreateInput[]): Promise<void> {
  if (data.length === 0) return;

  const created = await db.notification.createManyAndReturn({ data });

  const ticketIds = [...new Set(data.map((d) => d.ticketId).filter((id): id is string => !!id))];
  const tickets =
    ticketIds.length > 0
      ? await db.ticket.findMany({ where: { id: { in: ticketIds } }, select: ticketSelect })
      : [];
  const ticketMap = new Map(tickets.map((t) => [t.id, t]));

  for (const n of created) {
    const ticket = n.ticketId ? (ticketMap.get(n.ticketId) ?? null) : null;
    const item: NotificationItem = {
      id: n.id,
      type: n.type as NotificationItem["type"],
      read: n.read,
      createdAt: n.createdAt.toISOString(),
      ticket: ticket
        ? {
            ...ticket,
            type: ticket.type as TicketTypeKind,
          }
        : null,
      actorName: n.actorName,
      mentionCommentId: n.mentionCommentId,
    };

    sseEmit(n.userId, item);
  }
}
