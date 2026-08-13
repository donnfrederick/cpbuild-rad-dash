export type FTTicketStatus = "IN_PROGRESS" | "RESOLVED";

interface FTStatusChangePayload {
  projectId: string;
  ticketId: string;
  status: FTTicketStatus;
}

/**
 * Fires an outbound webhook to Field Tracker to sync a ticket status change.
 * Called fire-and-forget from the ticket PATCH handler — errors are logged but
 * do NOT surface to the end user.
 *
 * Required env vars:
 *   FIELD_TRACKER_BASE_URL     — base URL of the Field Tracker app (no trailing slash)
 *   FIELD_TRACKER_WEBHOOK_SECRET — Bearer token expected by Field Tracker
 *
 * Endpoint called: POST {FIELD_TRACKER_BASE_URL}/api/webhooks/status-change
 */
export async function notifyFieldTrackerStatusChange(opts: {
  projectId: string;
  fieldTrackerItemId: string;
  newStatus: FTTicketStatus;
}): Promise<void> {
  const baseUrl = process.env.FIELD_TRACKER_BASE_URL;
  const secret = process.env.FIELD_TRACKER_WEBHOOK_SECRET;

  if (!baseUrl || !secret) {
    console.warn(
      "[ft-webhook] FIELD_TRACKER_BASE_URL or FIELD_TRACKER_WEBHOOK_SECRET is not set — skipping status sync"
    );
    return;
  }

  const payload: FTStatusChangePayload = {
    projectId: opts.projectId,
    ticketId: opts.fieldTrackerItemId,
    status: opts.newStatus,
  };

  const url = `${baseUrl.replace(/\/$/, "")}/api/webhooks/status-change`;

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
    throw new Error(`[ft-webhook] HTTP ${res.status}: ${text}`);
  }
}
