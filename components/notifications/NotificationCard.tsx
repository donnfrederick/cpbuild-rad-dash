"use client";

import { useTranslations } from "next-intl";
import {
  Bug,
  Lightbulb,
  CheckCircle,
  Clock,
  AtSign,
  UserCheck,
  MessageSquare,
  Zap,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { ticketDetailPageHref } from "@/lib/ticket-urls";
import type { TicketTypeKind } from "@/components/tickets/ticket-types";
import { ticketTypeKindLabelKey, formatCustomTypeKey } from "@/components/tickets/ticket-types";

export interface NotificationItem {
  id: string;
  type: "TICKET_IN_PROGRESS" | "TICKET_RESOLVED" | "TICKET_ASSIGNED" | "MENTIONED_IN_COMMENT";
  read: boolean;
  createdAt: string;
  ticket: {
    id: string;
    type: TicketTypeKind;
    title: string;
    status: string;
    projectId?: string | null;
  } | null;
  actorName?: string | null;
  mentionCommentId?: string | null;
}

interface NotificationCardProps {
  notification: NotificationItem;
  onMarkRead: (id: string) => void;
  onClose: () => void;
}

function relativeTime(iso: string, t: ReturnType<typeof useTranslations>): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 2) return t("justNow");
  if (diffMins < 60) return t("minutesAgo", { n: diffMins });
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return t("hoursAgo", { n: diffHrs });
  return t("daysAgo", { n: Math.floor(diffHrs / 24) });
}

export function NotificationCard({ notification, onMarkRead, onClose }: NotificationCardProps) {
  const t = useTranslations("notifications");
  const tTickets = useTranslations("tickets");
  const router = useRouter();

  const { type, read, createdAt, ticket } = notification;

  function handleMarkRead() {
    if (!read) onMarkRead(notification.id);
  }

  function openTicket(commentId?: string | null) {
    if (!ticket) return;
    handleMarkRead();
    onClose();
    const q = commentId ? `?c=${encodeURIComponent(commentId)}` : "";
    router.push(`${ticketDetailPageHref(ticket.id, ticket.projectId)}${q}`);
  }

  if (type === "MENTIONED_IN_COMMENT") {
    const actor = notification.actorName ?? "Someone";
    const headline = t("mentionedInComment", { actor });
    return (
      <div
        onClick={() => openTicket(notification.mentionCommentId)}
        style={{
          display: "flex",
          gap: 12,
          padding: "12px 16px",
          borderBottom: "1px solid var(--neutral-100)",
          backgroundColor: read ? "transparent" : "var(--primary-50)",
          cursor: ticket ? "pointer" : "default",
          transition: "background-color 0.15s",
        }}
        role={ticket ? "button" : undefined}
        tabIndex={ticket ? 0 : undefined}
        onKeyDown={
          ticket
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openTicket(notification.mentionCommentId);
                }
              }
            : undefined
        }
      >
        <div style={{ flexShrink: 0, marginTop: 2 }}>
          <AtSign size={16} style={{ color: "var(--primary-500)" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: read ? 400 : 600,
              color: "var(--neutral-900)",
            }}
          >
            {headline}
          </p>
          {ticket && (
            <p
              style={{
                margin: "2px 0 0",
                fontSize: 12,
                color: "var(--neutral-600)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={ticket.title}
            >
              {ticket.title}
            </p>
          )}
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--neutral-400)" }}>
            {relativeTime(createdAt, t)}
          </p>
          {!read && (
            <span
              style={{
                display: "inline-block",
                marginTop: 6,
                width: 7,
                height: 7,
                borderRadius: "50%",
                backgroundColor: "var(--primary-500)",
              }}
              aria-label={t("unread")}
            />
          )}
        </div>
      </div>
    );
  }

  if (type === "TICKET_ASSIGNED" && ticket) {
    const actor = notification.actorName;
    const headline = actor ? t("ticketAssignedBy", { actor }) : t("ticketAssignedYou");
    return (
      <div
        onClick={() => openTicket()}
        style={{
          display: "flex",
          gap: 12,
          padding: "12px 16px",
          borderBottom: "1px solid var(--neutral-100)",
          backgroundColor: read ? "transparent" : "var(--primary-50)",
          cursor: "pointer",
          transition: "background-color 0.15s",
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openTicket();
          }
        }}
      >
        <div style={{ flexShrink: 0, marginTop: 2 }}>
          <UserCheck size={16} style={{ color: "var(--primary-600)" }} aria-hidden />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: read ? 400 : 600,
              color: "var(--neutral-900)",
            }}
          >
            {headline}
          </p>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 12,
              color: "var(--neutral-600)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={ticket.title}
          >
            {ticket.title}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--neutral-400)" }}>
            {relativeTime(createdAt, t)}
          </p>
          {!read && (
            <span
              style={{
                display: "inline-block",
                marginTop: 6,
                width: 7,
                height: 7,
                borderRadius: "50%",
                backgroundColor: "var(--primary-500)",
              }}
              aria-label={t("unread")}
            />
          )}
        </div>
      </div>
    );
  }

  if (!ticket) return null;

  const typeLabelKey = ticketTypeKindLabelKey(ticket.type);
  const typeLabel = typeLabelKey ? tTickets(typeLabelKey) : formatCustomTypeKey(ticket.type);
  const headline =
    type === "TICKET_RESOLVED"
      ? t("ticketResolved", { type: typeLabel })
      : t("ticketInProgress", { type: typeLabel });

  return (
    <div
      onClick={() => openTicket()}
      style={{
        display: "flex",
        gap: 12,
        padding: "12px 16px",
        borderBottom: "1px solid var(--neutral-100)",
        backgroundColor: read ? "transparent" : "var(--primary-50)",
        cursor: "pointer",
        transition: "background-color 0.15s",
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openTicket();
        }
      }}
    >
      <div style={{ flexShrink: 0, marginTop: 2 }}>
        {ticket.type === "BUG" ? (
          <Bug size={16} style={{ color: "var(--error-600)" }} />
        ) : ticket.type === "FEATURE_REQUEST" ? (
          <Lightbulb size={16} style={{ color: "var(--primary-500)" }} />
        ) : ticket.type === "FEEDBACK" ? (
          <MessageSquare size={16} style={{ color: "var(--teal-600)" }} />
        ) : ticket.type === "MINOR_ENHANCEMENT" ? (
          <Zap size={16} style={{ color: "var(--amber-600)" }} />
        ) : ticket.type === "REGRESSION" ? (
          <RotateCcw size={16} style={{ color: "var(--orange-600)" }} />
        ) : (
          <ShieldCheck size={16} style={{ color: "var(--primary-600)" }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {type === "TICKET_RESOLVED" ? (
            <CheckCircle size={14} style={{ color: "var(--success-600)", flexShrink: 0 }} />
          ) : (
            <Clock size={14} style={{ color: "var(--primary-500)", flexShrink: 0 }} />
          )}
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: read ? 400 : 600,
              color: "var(--neutral-900)",
            }}
          >
            {headline}
          </p>
        </div>
        <p
          style={{
            margin: "2px 0 0",
            fontSize: 12,
            color: "var(--neutral-600)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={ticket.title}
        >
          {ticket.title}
        </p>
        <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--neutral-400)" }}>
          {relativeTime(createdAt, t)}
        </p>
        {!read && (
          <span
            style={{
              display: "inline-block",
              marginTop: 6,
              width: 7,
              height: 7,
              borderRadius: "50%",
              backgroundColor: "var(--primary-500)",
            }}
            aria-label={t("unread")}
          />
        )}
      </div>
    </div>
  );
}
