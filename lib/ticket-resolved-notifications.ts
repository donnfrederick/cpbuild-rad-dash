import "server-only";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { sendTicketStatusEmail } from "@/lib/email";
import { notifyCommandCenterStatusChange, type CCTicketStatus } from "@/lib/command-center-webhook";
import { notifyFieldTrackerStatusChange, type FTTicketStatus } from "@/lib/field-tracker-webhook";

/**
 * Same outbound notifications as PATCH when a ticket moves to RESOLVED (email, in-app, CC, Field Tracker).
 */
export async function dispatchTicketResolvedNotifications(ticketId: string): Promise<void> {
  const existing = await db.ticket.findUnique({
    where: { id: ticketId },
    select: {
      userId: true,
      title: true,
      type: true,
      adminNote: true,
      projectId: true,
      fieldTrackerItemId: true,
      source: true,
      project: { select: { id: true, commandCenterProjectId: true } },
      user: { select: { email: true, name: true } },
    },
  });
  if (!existing) return;

  void createNotification({
    userId: existing.userId,
    ticketId,
    type: "TICKET_RESOLVED",
  }).catch((err: unknown) => console.error("[tickets] notification:", err));

  void sendTicketStatusEmail({
    to: existing.user.email,
    userName: existing.user.name,
    ticketTitle: existing.title,
    ticketType: existing.type,
    newStatus: "RESOLVED",
    adminNote: existing.adminNote ?? null,
    ticketId,
  }).catch((err: unknown) => console.error("[tickets] status email:", err));

  const ccProjectId =
    existing.project?.commandCenterProjectId ?? existing.project?.id ?? existing.projectId;
  if (ccProjectId) {
    if (!existing.project?.commandCenterProjectId) {
      console.warn(
        "[cc-webhook] commandCenterProjectId not set on project — falling back to rad-dash projectId:",
        ccProjectId
      );
    }
    const ccStatus: CCTicketStatus = "RESOLVED";
    void notifyCommandCenterStatusChange({
      commandCenterProjectId: ccProjectId,
      ticketId,
      newStatus: ccStatus,
    }).catch((err: unknown) => console.warn("[cc-webhook] status sync failed:", err));
  } else {
    console.warn("[cc-webhook] skipping status sync — ticket has no project assigned (ticketId:", ticketId, ")");
  }

  const ftItemId = existing.fieldTrackerItemId;
  const ftProjectId = existing.project?.id ?? existing.projectId;
  if (existing.source === "FIELD_TRACKER" && ftItemId && ftProjectId) {
    const ftStatus: FTTicketStatus = "RESOLVED";
    void notifyFieldTrackerStatusChange({
      projectId: ftProjectId,
      fieldTrackerItemId: ftItemId,
      newStatus: ftStatus,
    }).catch((err: unknown) => console.warn("[ft-webhook] status sync failed:", err));
  }
}
