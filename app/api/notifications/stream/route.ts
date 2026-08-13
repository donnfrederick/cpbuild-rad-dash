import { getSessionContext } from "@/lib/session-context";
import { sseSubscribe, sseUnsubscribe } from "@/lib/sse-notification-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_INTERVAL_MS = 25_000;

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userId = ctx.user.id;
  const encoder = new TextEncoder();
  let capturedController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      capturedController = controller;
      sseSubscribe(userId, controller);
      controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (capturedController) {
        sseUnsubscribe(userId, capturedController);
        capturedController = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
