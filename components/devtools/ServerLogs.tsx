"use client";

/**
 * ServerLogs
 *
 * Streams live server log entries from GET /api/devtools/logs (SSE).
 *
 * Entries that begin with `[API]` (emitted by lib/api-logger.ts) are rendered
 * as rich activity cards showing HTTP method, path, status code, result detail,
 * and timing — making it immediately obvious when a request succeeded or failed.
 *
 * All other log entries render as standard monospace log lines with level badges.
 *
 * Per-entry "Copy AI Prompt" button generates a structured prompt ready to
 * paste directly into Cursor or any AI agent.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useDevToolsContext } from "./DevToolsContext";
import {
  Terminal, Search, Trash2, Pause, Play,
  Wifi, WifiOff, Copy, Check, CheckCircle2, XCircle,
} from "lucide-react";
import type { LogEntry, LogLevel } from "@/lib/dev-logger";

// ─── Level config ─────────────────────────────────────────────────────────────

const LEVELS: { id: LogLevel | "all"; label: string }[] = [
  { id: "all",   label: "All"   },
  { id: "log",   label: "Log"   },
  { id: "info",  label: "Info"  },
  { id: "warn",  label: "Warn"  },
  { id: "error", label: "Error" },
  { id: "debug", label: "Debug" },
];

const LEVEL_COLORS: Record<LogLevel, { bg: string; text: string; border: string }> = {
  log:   { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" },
  info:  { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" },
  warn:  { bg: "#fefce8", text: "#a16207", border: "#fde68a" },
  error: { bg: "#fef2f2", text: "#b91c1c", border: "#fecaca" },
  debug: { bg: "#faf5ff", text: "#7c3aed", border: "#e9d5ff" },
};

function levelDot(level: LogLevel): string {
  return LEVEL_COLORS[level]?.text ?? "#6b7280";
}

// ─── API entry parser ─────────────────────────────────────────────────────────

const API_PATTERN =
  /^\[API\] (GET|POST|PATCH|PUT|DELETE) (\S+) → (\d+) [✓✗] (.+?)(?:\s+\((\d+)ms\))?/;

const RESPONSE_PREFIX = "\n\nResponse:\n";

interface ParsedApiEntry {
  method: string;
  path: string;
  status: number;
  detail: string;
  durationMs: number | null;
  success: boolean;
  responseBody: string | null;
}

function parseApiEntry(message: string): ParsedApiEntry | null {
  const firstLine = message.split("\n")[0];
  const m = API_PATTERN.exec(firstLine);
  if (!m) return null;
  const status = parseInt(m[3], 10);
  const responseBody = message.includes(RESPONSE_PREFIX)
    ? message.slice(message.indexOf(RESPONSE_PREFIX) + RESPONSE_PREFIX.length).trim()
    : null;
  return {
    method:        m[1],
    path:          m[2],
    status,
    detail:        m[4],
    durationMs:    m[5] ? parseInt(m[5], 10) : null,
    success:       status < 400,
    responseBody,
  };
}

const METHOD_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  GET:    { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" },
  POST:   { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" },
  PATCH:  { bg: "#fff7ed", text: "#c2410c", border: "#fed7aa" },
  PUT:    { bg: "#faf5ff", text: "#7c3aed", border: "#e9d5ff" },
  DELETE: { bg: "#fef2f2", text: "#b91c1c", border: "#fecaca" },
};

function statusColors(status: number): { bg: string; text: string; border: string } {
  if (status < 300) return { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" };
  if (status < 400) return { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" };
  if (status < 500) return { bg: "#fefce8", text: "#a16207", border: "#fde68a" };
  return { bg: "#fef2f2", text: "#b91c1c", border: "#fecaca" };
}

// ─── AI prompt builder ────────────────────────────────────────────────────────

function buildAIPrompt(entry: LogEntry, allEntries: LogEntry[]): string {
  const idx = allEntries.findIndex((e) => e.id === entry.id);
  const before = allEntries.slice(Math.max(0, idx - 8), idx);
  const after  = allEntries.slice(idx + 1, Math.min(allEntries.length, idx + 4));

  const fmt = (e: LogEntry) => {
    const t = new Date(e.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `[${t}] [${e.level.toUpperCase()}] ${e.message}`;
  };

  const isError = entry.level === "error" || entry.level === "warn";
  const fileMatch = entry.message.match(/(?:at\s+\S+\s+\()?([\w/.-]+\.(ts|tsx|js|jsx))(?::(\d+))?/);
  const fileRef = fileMatch ? fileMatch[1] + (fileMatch[3] ? `:${fileMatch[3]}` : "") : null;

  const api = parseApiEntry(entry.message);

  return [
    "## Rad Dash — Server Log Issue",
    "",
    `**Project:** Rad Dash (Next.js App Router, TypeScript, Prisma/PostgreSQL)`,
    `**Timestamp:** ${new Date(entry.timestamp).toLocaleString()}`,
    `**Level:** ${entry.level.toUpperCase()}`,
    ...(api ? [`**API:** ${api.method} ${api.path} → ${api.status}`, `**Result:** ${api.detail}`, ...(api.durationMs != null ? [`**Duration:** ${api.durationMs}ms`] : [])] : []),
    ...(fileRef ? [`**File:** \`${fileRef}\``] : []),
    "",
    `### ${isError ? "Error" : "Log Entry"}`,
    "```",
    entry.message,
    "```",
    "",
    ...(before.length > 0 ? ["### Log Context (entries before this one)", "```", ...before.map(fmt), "```", ""] : []),
    ...(after.length  > 0 ? ["### Log Context (entries after this one)",  "```", ...after.map(fmt),  "```", ""] : []),
    "### Task",
    isError
      ? "Please identify the root cause of this error and provide the exact code change needed to fix it. Reference the specific file path and line number. If the error is a credentials/config issue rather than a code bug, explain what environment variable or configuration is missing."
      : "Please explain what this log entry indicates and whether any action is needed. If it points to a potential issue, describe the fix.",
  ].join("\n");
}

// ─── CopyPromptButton ─────────────────────────────────────────────────────────

function CopyPromptButton({ entry, allEntries }: { entry: LogEntry; allEntries: LogEntry[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(buildAIPrompt(entry, allEntries));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      title="Copy AI prompt"
      style={{
        display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
        padding: "2px 7px", borderRadius: 4, border: "1px solid",
        borderColor: copied ? "#4ade80" : "#334155",
        backgroundColor: copied ? "#052e16" : "#1e293b",
        color: copied ? "#4ade80" : "#94a3b8",
        fontSize: 10, fontWeight: 500, cursor: "pointer",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        lineHeight: "16px", transition: "all 0.15s", whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => { if (!copied) { e.currentTarget.style.borderColor = "#7c3aed"; e.currentTarget.style.color = "#a78bfa"; } }}
      onMouseLeave={(e) => { if (!copied) { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#94a3b8"; } }}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? "Copied!" : "Copy AI Prompt"}
    </button>
  );
}

// ─── ApiLogRow ────────────────────────────────────────────────────────────────

const RESPONSE_PREVIEW_LEN = 100;
const RESPONSE_EXPANDED_MAX_HEIGHT = 280;

function truncateResponse(body: string, maxLen: number): { text: string; truncated: boolean } {
  const trimmed = body.trim();
  if (trimmed.length <= maxLen) return { text: trimmed, truncated: false };
  return { text: trimmed.slice(0, maxLen) + "…", truncated: true };
}

function ApiLogRow({ entry, allEntries, api, time }: {
  entry: LogEntry;
  allEntries: LogEntry[];
  api: ParsedApiEntry;
  time: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [showResponse, setShowResponse] = useState(false); // default collapsed
  const mc = METHOD_COLORS[api.method] ?? METHOD_COLORS.GET;
  const sc = statusColors(api.status);
  const hasResponse = !!api.responseBody;
  const preview = hasResponse ? truncateResponse(api.responseBody!, RESPONSE_PREVIEW_LEN) : null;

  return (
    <div
      style={{
        borderLeft: `3px solid ${api.success ? "#22c55e" : "#ef4444"}`,
        marginBottom: 1,
      }}
    >
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 16px",
          backgroundColor: hovered ? "#1e293b" : api.success ? "transparent" : "#1a0a0a",
          transition: "background-color 0.1s",
        }}
      >
        {/* Timestamp */}
        <span style={{ color: "#475569", flexShrink: 0, fontSize: 11, fontFamily: "monospace", letterSpacing: "-0.01em" }}>
          {time}
        </span>

        {/* Method badge */}
        <span style={{ flexShrink: 0, padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", backgroundColor: mc.bg, color: mc.text, border: `1px solid ${mc.border}`, fontFamily: "monospace" }}>
          {api.method}
        </span>

        {/* Path */}
        <span style={{ color: "#94a3b8", fontSize: 12, fontFamily: "monospace", flexShrink: 0, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={api.path}>
          {api.path}
        </span>

        {/* Status badge */}
        <span style={{ flexShrink: 0, padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700, backgroundColor: sc.bg, color: sc.text, border: `1px solid ${sc.border}`, fontFamily: "monospace" }}>
          {api.status}
        </span>

        {/* Success/fail icon */}
        <span style={{ flexShrink: 0 }}>
          {api.success
            ? <CheckCircle2 size={13} style={{ color: "#22c55e" }} />
            : <XCircle size={13} style={{ color: "#ef4444" }} />}
        </span>

        {/* Detail */}
        <span style={{ color: api.success ? "#e2e8f0" : "#fca5a5", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "ui-sans-serif, system-ui, sans-serif" }} title={api.detail}>
          {api.detail}
        </span>

        {/* Duration */}
        {api.durationMs != null && (
          <span style={{ flexShrink: 0, fontSize: 11, color: api.durationMs > 500 ? "#fb923c" : "#475569", fontFamily: "monospace" }}>
            {api.durationMs}ms
          </span>
        )}

        {/* Toggle response body — always visible when there's a response */}
        {hasResponse && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowResponse((s) => !s); }}
            style={{
              flexShrink: 0, padding: "2px 6px", fontSize: 10, fontWeight: 600,
              border: "1px solid #334155", borderRadius: 3,
              backgroundColor: showResponse ? "#334155" : "transparent",
              color: "#94a3b8", cursor: "pointer",
            }}
          >
            {showResponse ? "Hide" : "Response"}
          </button>
        )}

        {/* Copy AI prompt — hover only */}
        <div style={{ flexShrink: 0, opacity: hovered ? 1 : 0, transition: "opacity 0.15s", pointerEvents: hovered ? "auto" : "none" }}>
          <CopyPromptButton entry={entry} allEntries={allEntries} />
        </div>
      </div>

      {/* Collapsed: truncated preview */}
      {hasResponse && !showResponse && preview && (
        <div
          onClick={() => setShowResponse(true)}
          style={{
            padding: "4px 16px 6px 44px",
            fontSize: 10, fontFamily: "ui-monospace, Menlo, monospace",
            color: "#64748b", backgroundColor: "#0a1220",
            borderTop: "1px solid #1e293b",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            cursor: "pointer",
          }}
          title="Click to expand"
        >
          {preview.text}
          {preview.truncated && (
            <span style={{ color: "#475569", marginLeft: 4 }}>— click to expand</span>
          )}
        </div>
      )}

      {/* Expanded: sticky collapse bar + scrollable body */}
      {hasResponse && showResponse && (
        <div style={{ borderTop: "1px solid #1e293b", backgroundColor: "#0a1220" }}>
          {/* Sticky collapse bar — always visible when expanded, even after scrolling */}
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "4px 16px 4px 44px",
              backgroundColor: "#1e293b",
              borderBottom: "1px solid #334155",
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8" }}>Response</span>
            <button
              onClick={(e) => { e.stopPropagation(); setShowResponse(false); }}
              style={{
                padding: "2px 8px", fontSize: 10, fontWeight: 600,
                border: "1px solid #334155", borderRadius: 3,
                backgroundColor: "#334155", color: "#94a3b8", cursor: "pointer",
              }}
            >
              Collapse
            </button>
          </div>
          <pre
            style={{
              margin: 0, padding: "8px 16px 12px 44px",
              fontSize: 11, fontFamily: "ui-monospace, Menlo, monospace",
              color: "#94a3b8",
              whiteSpace: "pre-wrap", wordBreak: "break-all",
              lineHeight: "16px", maxHeight: RESPONSE_EXPANDED_MAX_HEIGHT, overflowY: "auto",
            }}
          >
            {api.responseBody}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── LogRow (plain log entries) ───────────────────────────────────────────────

function LogRow({ entry, allEntries, colors, time }: {
  entry: LogEntry;
  allEntries: LogEntry[];
  colors: { bg: string; text: string; border: string };
  time: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "flex-start", gap: 8,
        padding: "4px 16px",
        borderLeft: `3px solid ${colors.border}`,
        marginBottom: 1,
        backgroundColor: hovered ? "#1e293b" : "transparent",
        transition: "background-color 0.1s",
      }}
    >
      <span style={{ color: "#475569", flexShrink: 0, fontSize: 11, paddingTop: 2, letterSpacing: "-0.01em", fontFamily: "monospace" }}>
        {time}
      </span>

      <span style={{ flexShrink: 0, padding: "1px 5px", borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", backgroundColor: colors.bg, color: colors.text, border: `1px solid ${colors.border}`, lineHeight: "16px", marginTop: 2 }}>
        {entry.level}
      </span>

      <span style={{ color: "#e2e8f0", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: "18px", flex: 1, paddingTop: 1, fontFamily: "ui-monospace, 'Cascadia Code', Menlo, monospace", fontSize: 12 }}>
        {entry.message}
      </span>

      <div style={{ flexShrink: 0, paddingTop: 1, opacity: hovered ? 1 : 0, transition: "opacity 0.15s", pointerEvents: hovered ? "auto" : "none" }}>
        <CopyPromptButton entry={entry} allEntries={allEntries} />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ServerLogs() {
  const ctx = useDevToolsContext();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");
  const [search, setSearch] = useState("");
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(autoScroll);
  const [authError, setAuthError] = useState<string | null>(null);
  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  // ── SSE connection ──────────────────────────────────────────────────────────
  useEffect(() => {
    let es: EventSource;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let active = true;

    async function connect() {
      if (!active) return;

      // Pre-check: probe a dedicated auth-check endpoint to detect auth errors
      // before opening EventSource. EventSource's error event can't expose HTTP
      // status codes, so without this check a 401/403 creates an infinite
      // reconnect loop showing "Reconnecting…" forever.
      try {
        const probe = await fetch("/api/devtools/diagnostics", {
          credentials: "include",
        });
        if (probe.status === 401) {
          setAuthError("Not signed in. Sign in to view server logs.");
          return;
        }
        if (probe.status === 403) {
          setAuthError("Admin role required to view server logs.");
          return;
        }
      } catch {
        // Network error — fall through and let EventSource handle it.
      }

      if (!active) return;
      es = new EventSource("/api/devtools/logs");
      es.onopen = () => { setAuthError(null); setConnected(true); };
      es.onmessage = (event) => {
        try {
          const entry = JSON.parse(event.data as string) as LogEntry;
          setEntries((prev) => {
            const next = [...prev, entry];
            return next.length > 500 ? next.slice(next.length - 500) : next;
          });
          if (entry.level === "error" || entry.level === "warn") {
            const msg = entry.message.split("\n")[0]?.slice(0, 120) ?? "Server log";
            window.dispatchEvent(new CustomEvent("devtools:new-error", { detail: { count: 1, message: msg, tab: "server-logs" } }));
          }
        } catch { /* ignore malformed events */ }
      };
      es.onerror = () => {
        setConnected(false);
        es.close();
        if (active) reconnectTimer = setTimeout(connect, 3000);
      };
    }

    void connect();
    return () => {
      active = false;
      es?.close();
      clearTimeout(reconnectTimer);
      setConnected(false);
    };
  }, []);

  // Sync entries to Error Wrap-Up context
  // Note: ctx excluded from deps to avoid loop (setServerLogEntries updates context → ctx changes → effect re-runs)
  useEffect(() => {
    if (ctx) ctx.setServerLogEntries(entries);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx intentionally excluded
  }, [entries]);

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }, []);

  // ── Filtering ────────────────────────────────────────────────────────────────
  const filtered = entries.filter((e) => {
    if (levelFilter !== "all" && e.level !== levelFilter) return false;
    if (search) return e.message.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  const counts: Record<string, number> = { all: entries.length };
  for (const e of entries) { counts[e.level] = (counts[e.level] ?? 0) + 1; }

  // ── Counts for mini summary ──────────────────────────────────────────────────
  const apiEntries = entries.filter((e) => parseApiEntry(e.message));
  const apiSuccess = apiEntries.filter((e) => { const a = parseApiEntry(e.message); return a && a.success; }).length;
  const apiFail    = apiEntries.filter((e) => { const a = parseApiEntry(e.message); return a && !a.success; }).length;

  return (
    <div className="flex flex-col" style={{ flex: 1, overflow: "hidden", backgroundColor: "#0f172a" }}>

      {/* ── Toolbar ── */}
      <div className="flex-shrink-0 flex flex-wrap items-center gap-2" style={{ padding: "10px 16px", borderBottom: "1px solid #1e293b", backgroundColor: "#0f172a" }}>

        {/* Connection status */}
        <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: connected ? "#4ade80" : authError ? "#fb923c" : "#f87171", flexShrink: 0 }}>
          {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
          {connected ? "Live" : authError ? authError : "Reconnecting…"}
        </div>

        <div style={{ width: 1, height: 16, backgroundColor: "#334155", flexShrink: 0 }} />

        {/* Level filter pills */}
        <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
          {LEVELS.map(({ id, label }) => {
            const isActive = levelFilter === id;
            const count = counts[id] ?? 0;
            return (
              <button key={id} onClick={() => setLevelFilter(id)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500, border: "1px solid", borderColor: isActive ? "#7c3aed" : "#334155", backgroundColor: isActive ? "#7c3aed" : "transparent", color: isActive ? "#fff" : "#94a3b8", cursor: "pointer", fontFamily: "monospace" }}>
                {id !== "all" && <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: levelDot(id as LogLevel), flexShrink: 0 }} />}
                {label}
                {count > 0 && <span style={{ opacity: 0.75 }}>{count}</span>}
              </button>
            );
          })}
        </div>

        <div style={{ width: 1, height: 16, backgroundColor: "#334155", flexShrink: 0 }} />

        {/* Search */}
        <div className="relative flex items-center" style={{ flex: 1, minWidth: 120 }}>
          <Search size={12} style={{ position: "absolute", left: 8, color: "#64748b", pointerEvents: "none" }} />
          <input
            type="text"
            placeholder="Filter logs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", height: 26, paddingLeft: 26, paddingRight: 8, backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0", fontSize: 11, fontFamily: "monospace", outline: "none" }}
          />
        </div>

        {/* Auto-scroll */}
        <button onClick={() => setAutoScroll((s) => !s)} title={autoScroll ? "Pause auto-scroll" : "Resume"} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 4, border: "1px solid #334155", backgroundColor: autoScroll ? "#7c3aed22" : "transparent", color: autoScroll ? "#a78bfa" : "#64748b", cursor: "pointer", flexShrink: 0 }}>
          {autoScroll ? <Pause size={12} /> : <Play size={12} />}
        </button>

        {/* Clear */}
        <button onClick={() => setEntries([])} title="Clear log" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 4, border: "1px solid #334155", backgroundColor: "transparent", color: "#64748b", cursor: "pointer", flexShrink: 0 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#f87171")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#64748b")}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* ── API activity summary bar ── */}
      {apiEntries.length > 0 && (
        <div className="flex items-center gap-3" style={{ padding: "5px 16px", borderBottom: "1px solid #1e293b", backgroundColor: "#0a1220", fontSize: 11 }}>
          <span style={{ color: "#475569" }}>API activity:</span>
          {apiSuccess > 0 && (
            <span className="flex items-center gap-1" style={{ color: "#22c55e" }}>
              <CheckCircle2 size={11} /> {apiSuccess} successful
            </span>
          )}
          {apiFail > 0 && (
            <span className="flex items-center gap-1" style={{ color: "#ef4444" }}>
              <XCircle size={11} /> {apiFail} failed
            </span>
          )}
        </div>
      )}

      {/* ── Log list ── */}
      <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center" style={{ padding: "48px 24px", color: "#475569", gap: 12 }}>
            <Terminal size={28} style={{ opacity: 0.4 }} />
            <p style={{ margin: 0, fontSize: 13 }}>
              {entries.length === 0
                ? authError
                  ? authError
                  : connected
                    ? "Waiting for server logs… Interact with the app to see activity here."
                    : "Connecting to log stream…"
                : "No logs match your filters."}
            </p>
          </div>
        ) : (
          filtered.map((entry) => {
            const api = parseApiEntry(entry.message);
            const time = (() => {
              const d = new Date(entry.timestamp);
              const t = d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
              const ms = d.getMilliseconds().toString().padStart(3, "0");
              return `${t}.${ms}`;
            })();

            if (api) {
              return <ApiLogRow key={entry.id} entry={entry} allEntries={entries} api={api} time={time} />;
            }

            return (
              <LogRow
                key={entry.id}
                entry={entry}
                allEntries={entries}
                colors={LEVEL_COLORS[entry.level]}
                time={time}
              />
            );
          })
        )}
      </div>

      {/* ── Footer ── */}
      <div className="flex-shrink-0 flex items-center justify-between" style={{ padding: "6px 16px", borderTop: "1px solid #1e293b", color: "#475569", fontSize: 11 }}>
        <span>
          {filtered.length} of {entries.length} entries
          {entries.length >= 500 && " (buffer full — oldest dropped)"}
        </span>
        {!autoScroll && (
          <button onClick={() => { setAutoScroll(true); if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }} style={{ fontSize: 11, color: "#a78bfa", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            ↓ Jump to bottom
          </button>
        )}
      </div>
    </div>
  );
}
