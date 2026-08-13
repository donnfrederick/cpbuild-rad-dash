export type CCTicketStatus = "IN_PROGRESS" | "RESOLVED";

interface CCStatusChangePayload {
  projectId: string;
  ticketId: string;
  status: CCTicketStatus;
}

/**
 * Fires an outbound webhook to command-center-reboot to sync ticket status.
 * Called fire-and-forget from the ticket PATCH handler — errors are logged but
 * do NOT surface to the end user.
 *
 * Required env vars:
 *   FIELD_TRACKER_WEBHOOK_URL    — full URL of the CC status-change endpoint
 *   FIELD_TRACKER_WEBHOOK_SECRET — Bearer token expected by CC
 */
export async function notifyCommandCenterStatusChange(opts: {
  commandCenterProjectId: string;
  ticketId: string;
  newStatus: CCTicketStatus;
}): Promise<void> {
  const url = process.env.FIELD_TRACKER_WEBHOOK_URL;
  const secret = process.env.FIELD_TRACKER_WEBHOOK_SECRET;

  if (!url || !secret) {
    console.warn(
      "[cc-webhook] FIELD_TRACKER_WEBHOOK_URL or FIELD_TRACKER_WEBHOOK_SECRET is not set — skipping status sync"
    );
    return;
  }

  const payload: CCStatusChangePayload = {
    projectId: opts.commandCenterProjectId,
    ticketId: opts.ticketId,
    status: opts.newStatus,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(unreadable)");
    throw new Error(`[cc-webhook] HTTP ${res.status}: ${text}`);
  }
}
