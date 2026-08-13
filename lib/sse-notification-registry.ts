import "server-only";
import type { NotificationItem } from "@/components/notifications/NotificationCard";

type Controller = ReadableStreamDefaultController<Uint8Array>;

const encoder = new TextEncoder();
const registry = new Map<string, Set<Controller>>();

export function sseSubscribe(userId: string, controller: Controller): void {
  let controllers = registry.get(userId);
  if (!controllers) {
    controllers = new Set();
    registry.set(userId, controllers);
  }
  controllers.add(controller);
}

export function sseUnsubscribe(userId: string, controller: Controller): void {
  const controllers = registry.get(userId);
  if (!controllers) return;
  controllers.delete(controller);
  if (controllers.size === 0) {
    registry.delete(userId);
  }
}

function sendToController(controller: Controller, notification: NotificationItem): void {
  try {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(notification)}\n\n`));
  } catch {
    // Stream already closed; the cleanup in the route handler will unsubscribe it
  }
}

export function sseEmit(userId: string, notification: NotificationItem): void {
  const controllers = registry.get(userId);
  if (!controllers || controllers.size === 0) return;
  for (const controller of controllers) {
    sendToController(controller, notification);
  }
}

export function sseEmitMany(notifications: { userId: string; notification: NotificationItem }[]): void {
  for (const { userId, notification } of notifications) {
    sseEmit(userId, notification);
  }
}
