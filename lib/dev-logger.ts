/**
 * Dev-only server log interceptor.
 *
 * Patches global console methods to capture log entries into an in-memory ring
 * buffer and notify any active SSE subscribers. The buffer persists on
 * `globalThis` so it survives Next.js hot-reloads without being reset.
 *
 * Active when NODE_ENV !== "production" OR isDevToolsAllowed() (e.g. Railway dev
 * with APP_ENV=dev or RAILWAY_GIT_BRANCH=dev).
 */

import { isDevToolsAllowed } from "@/lib/devtools-env";

export type LogLevel = "log" | "info" | "warn" | "error" | "debug";

export interface LogEntry {
  id: number;
  timestamp: string; // ISO-8601
  level: LogLevel;
  message: string;
}

type Listener = (entry: LogEntry) => void;

// ─── Max entries kept in memory ───────────────────────────────────────────────
const MAX_ENTRIES = 500;

// ─── globalThis keys (survive hot-reload) ────────────────────────────────────
declare global {
  var __devLogBuffer: LogEntry[] | undefined;
  var __devLogListeners: Set<Listener> | undefined;
  var __devLogCounter: number | undefined;
  var __devLogPatched: boolean | undefined;
}

const IS_DEV = process.env.NODE_ENV !== "production" || isDevToolsAllowed();

function getBuffer(): LogEntry[] {
  globalThis.__devLogBuffer ??= [];
  return globalThis.__devLogBuffer;
}

function getListeners(): Set<Listener> {
  globalThis.__devLogListeners ??= new Set();
  return globalThis.__devLogListeners;
}

function nextId(): number {
  globalThis.__devLogCounter = (globalThis.__devLogCounter ?? 0) + 1;
  return globalThis.__devLogCounter;
}

function push(level: LogLevel, args: unknown[]) {
  const message = args
    .map((a) =>
      typeof a === "string"
        ? a
        : a instanceof Error
        ? `${a.message}\n${a.stack ?? ""}`
        : JSON.stringify(a, null, 2)
    )
    .join(" ");

  const entry: LogEntry = {
    id: nextId(),
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  const buf = getBuffer();
  buf.push(entry);
  if (buf.length > MAX_ENTRIES) buf.splice(0, buf.length - MAX_ENTRIES);

  for (const listener of getListeners()) {
    try {
      listener(entry);
    } catch {
      // ignore broken listeners
    }
  }
}

// ─── Console patch (once per process) ────────────────────────────────────────

if (IS_DEV && !globalThis.__devLogPatched) {
  globalThis.__devLogPatched = true;

  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  console.log = (...args) => { orig.log(...args); push("log", args); };
  console.info = (...args) => { orig.info(...args); push("info", args); };
  console.warn = (...args) => { orig.warn(...args); push("warn", args); };
  console.error = (...args) => { orig.error(...args); push("error", args); };
  console.debug = (...args) => { orig.debug(...args); push("debug", args); };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns a snapshot of the current log buffer (newest last). */
export function getLogBuffer(): LogEntry[] {
  if (!IS_DEV) return [];
  return [...getBuffer()];
}

/** Subscribe to new log entries. Returns an unsubscribe function. */
export function subscribeToLogs(listener: Listener): () => void {
  if (!IS_DEV) return () => {};
  const listeners = getListeners();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
