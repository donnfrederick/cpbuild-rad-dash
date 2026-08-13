/**
 * GET /api/devtools/logs
 *
 * Server-Sent Events (SSE) stream of server log entries captured by
 * lib/dev-logger.ts. Hard-blocked in production.
 *
 * Protocol:
 *   - On connect: sends all buffered entries as individual SSE events.
 *   - Ongoing:    sends new entries as they arrive.
 *   - Keep-alive: sends a comment ping every 15 s to prevent proxy timeouts.
 *   - On close:   client disconnects, subscription is cleaned up.
 *
 * Event format:
 *   data: {"id":1,"timestamp":"...","level":"info","message":"..."}
 */

import { getLogBuffer, subscribeToLogs } from "@/lib/dev-logger";
import type { LogEntry } from "@/lib/dev-logger";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdmin } from "@/lib/devtools-auth";
export const dynamic = "force-dynamic";

function encode(entry: LogEntry): string {
  return `data: ${JSON.stringify(entry)}\n\n`;
}

export async function GET() {
  if (!isDevToolsAllowed()) {
    return new Response(
      JSON.stringify({ error: DEVTOOLS_BLOCKED_MESSAGE }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const authError = await requireDevToolsAdmin();
  if (authError) return authError;

  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | undefined;
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      // Send all buffered entries immediately on connect.
      for (const entry of getLogBuffer()) {
        controller.enqueue(encoder.encode(encode(entry)));
      }

      // Keep-alive ping every 5 s — Railway's proxy may close idle SSE
      // connections faster than the previous 15 s interval.
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(keepAlive);
        }
      }, 5_000);

      // Stream new entries as they arrive.
      unsubscribe = subscribeToLogs((entry) => {
        try {
          controller.enqueue(encoder.encode(encode(entry)));
        } catch {
          unsubscribe?.();
          clearInterval(keepAlive);
        }
      });
    },

    cancel() {
      // Called by the browser when the client disconnects (tab close, unmount).
      unsubscribe?.();
      clearInterval(keepAlive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable Nginx proxy buffering
    },
  });
}
