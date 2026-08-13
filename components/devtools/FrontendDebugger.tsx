"use client";

/**
 * FrontendDebugger
 *
 * Two sections:
 *
 * ISSUES — real-time capture of:
 *   - Browser console errors/warnings
 *   - JS runtime exceptions (window.onerror)
 *   - Unhandled promise rejections
 *   - Network errors via patched window.fetch
 *
 * DIAGNOSTICS — comprehensive test suite across 5 categories:
 *   1. Server & Environment  (DB ping, env var presence via /api/devtools/diagnostics)
 *   2. API Routes            (HTTP status checks for every route in the app)
 *   3. Browser Capabilities  (localStorage, IndexedDB, SW API, Notifications, etc.)
 *   4. PWA                   (manifest, service worker registration)
 *   5. Performance           (Navigation Timing API — TTFB, DCL, load)
 *
 * All tests show pass/warn/fail with timing. A summary bar shows totals.
 * "Copy AI Prompt" appears on every failed/warned test and on every issue.
 */

import { useEffect, useState, useCallback } from "react";
import {
  Bug, RefreshCw, Trash2, Copy, Check,
  CheckCircle2, XCircle, AlertTriangle,
  ChevronDown, ChevronUp, Server, Globe,
  Monitor, Smartphone, Zap, Mail,
} from "lucide-react";
import { useDevToolsContext } from "./DevToolsContext";

// ─── Shared types ─────────────────────────────────────────────────────────────

export type IssueSeverity = "error" | "warning" | "info";
export type IssueCategory = "console" | "network" | "runtime" | "health-check";

export interface FrontendIssue {
  id: number;
  timestamp: string;
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
  detail?: string;
  url?: string;
  status?: number;
}

type DiagStatus = "pass" | "fail" | "warn" | "pending" | "running";

interface DiagTest {
  name: string;
  detail: string;
  status: DiagStatus;
  durationMs?: number;
}

interface DiagGroup {
  id: string;
  label: string;
  icon: React.ReactNode;
  tests: DiagTest[];
}

// ─── Severity / level config ──────────────────────────────────────────────────

const SEVERITY_CFG: Record<IssueSeverity, { label: string; color: string; bg: string; border: string }> = {
  error:   { label: "Error",   color: "#b91c1c", bg: "#fef2f2", border: "#fecaca" },
  warning: { label: "Warning", color: "#a16207", bg: "#fefce8", border: "#fde68a" },
  info:    { label: "Info",    color: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" },
};

const CAT_LABELS: Record<IssueCategory, string> = {
  console: "Console", network: "Network", runtime: "Runtime", "health-check": "Health",
};

let _issueCounter = 0;
function nextId() { return ++_issueCounter; }

// ─── AI Prompt ────────────────────────────────────────────────────────────────

function buildIssuePrompt(issue: FrontendIssue, all: FrontendIssue[]): string {
  const ctx = all.filter((i) => i.id !== issue.id).slice(-5)
    .map((i) => `[${new Date(i.timestamp).toLocaleTimeString()}] [${i.severity.toUpperCase()}] ${i.message}`)
    .join("\n");
  return [
    "## Rad Dash — Frontend Issue",
    "",
    "**Project:** Rad Dash (Next.js App Router, React, TypeScript, Prisma/PostgreSQL)",
    `**Timestamp:** ${new Date(issue.timestamp).toLocaleString()}`,
    `**Severity:** ${issue.severity.toUpperCase()}`,
    `**Category:** ${CAT_LABELS[issue.category]}`,
    ...(issue.url ? [`**URL:** \`${issue.url}\``] : []),
    ...(issue.status != null ? [`**HTTP Status:** ${issue.status}`] : []),
    "",
    "### Error",
    "```",
    issue.message,
    "```",
    "",
    ...(issue.detail ? ["### Stack Trace", "```", issue.detail, "```", ""] : []),
    ...(ctx ? ["### Recent Issue Context", "```", ctx, "```", ""] : []),
    "### Task",
    "Please identify the root cause of this frontend error and provide the exact code change needed to fix it. " +
    "Reference the specific file path and line number from the stack trace. " +
    "If this is a configuration or environment variable issue, explain what needs to be set.",
  ].join("\n");
}

function buildDiagPrompt(test: DiagTest, group: DiagGroup): string {
  return [
    "## Rad Dash — Diagnostic Failure",
    "",
    "**Project:** Rad Dash (Next.js App Router, React, TypeScript, Prisma/PostgreSQL)",
    `**Category:** ${group.label}`,
    `**Test:** ${test.name}`,
    `**Status:** ${test.status.toUpperCase()}`,
    ...(test.durationMs != null ? [`**Duration:** ${test.durationMs}ms`] : []),
    "",
    "### Failure Detail",
    "```",
    test.detail,
    "```",
    "",
    "### Task",
    "Please identify the root cause of this diagnostic failure and provide the exact fix. " +
    "If this is a missing environment variable or configuration issue, explain what needs to be set and where. " +
    "If it is a code bug, reference the specific file and line number.",
  ].join("\n");
}

// ─── CopyBtn ──────────────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      title="Copy AI prompt"
      style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "2px 8px", borderRadius: 4, border: "1px solid",
        borderColor: copied ? "#4ade80" : "#d1d5db",
        backgroundColor: copied ? "#f0fdf4" : "#f9fafb",
        color: copied ? "#15803d" : "#374151",
        fontSize: 11, fontWeight: 600, cursor: "pointer",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        whiteSpace: "nowrap", transition: "all 0.15s", flexShrink: 0,
      }}
      onMouseEnter={(e) => { if (!copied) { e.currentTarget.style.borderColor = "#7c3aed"; e.currentTarget.style.color = "#7c3aed"; } }}
      onMouseLeave={(e) => { if (!copied) { e.currentTarget.style.borderColor = "#d1d5db"; e.currentTarget.style.color = "#374151"; } }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Copied!" : "Copy AI Prompt"}
    </button>
  );
}

// ─── DiagStatusIcon ───────────────────────────────────────────────────────────

function DiagIcon({ status }: { status: DiagStatus }) {
  if (status === "pass")    return <CheckCircle2 size={14} style={{ color: "#15803d", flexShrink: 0 }} />;
  if (status === "fail")    return <XCircle size={14} style={{ color: "#b91c1c", flexShrink: 0 }} />;
  if (status === "warn")    return <AlertTriangle size={14} style={{ color: "#a16207", flexShrink: 0 }} />;
  if (status === "running") return <RefreshCw size={14} style={{ color: "#7c3aed", flexShrink: 0, animation: "spin 1s linear infinite" }} />;
  return <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid #d1d5db", flexShrink: 0 }} />;
}

// ─── DiagGroupSection ─────────────────────────────────────────────────────────

function DiagGroupSection({ group, running }: { group: DiagGroup; running: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const fails = group.tests.filter((t) => t.status === "fail").length;
  const warns = group.tests.filter((t) => t.status === "warn").length;
  const passes = group.tests.filter((t) => t.status === "pass").length;
  const pending = group.tests.filter((t) => t.status === "pending" || t.status === "running").length;

  return (
    <div style={{ borderBottom: "1px solid #f3f4f6" }}>
      {/* Group header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-3 w-full"
        style={{
          padding: "10px 16px",
          backgroundColor: "#f9fafb",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ color: "#7c3aed", flexShrink: 0 }}>{group.icon}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#111827", flex: 1 }}>{group.label}</span>

        {/* Mini summary */}
        <div className="flex items-center gap-1.5" style={{ flexShrink: 0 }}>
          {running && pending > 0 && (
            <span style={{ fontSize: 11, color: "#7c3aed", fontWeight: 500 }}>running…</span>
          )}
          {passes > 0 && <Pill n={passes} color="#15803d" bg="#f0fdf4" border="#bbf7d0" label="pass" />}
          {warns > 0  && <Pill n={warns}  color="#a16207" bg="#fefce8" border="#fde68a" label="warn" />}
          {fails > 0  && <Pill n={fails}  color="#b91c1c" bg="#fef2f2" border="#fecaca" label="fail" />}
        </div>

        {collapsed ? <ChevronDown size={14} style={{ color: "#9ca3af", flexShrink: 0 }} /> : <ChevronUp size={14} style={{ color: "#9ca3af", flexShrink: 0 }} />}
      </button>

      {/* Tests */}
      {!collapsed && (
        <div>
          {group.tests.map((test) => (
            <div
              key={test.name}
              className="flex items-start gap-3"
              style={{
                padding: "8px 16px 8px 32px",
                borderLeft: `3px solid ${
                  test.status === "pass" ? "#bbf7d0" :
                  test.status === "warn" ? "#fde68a" :
                  test.status === "fail" ? "#fecaca" : "#e5e7eb"
                }`,
                borderBottom: "1px solid #f9fafb",
              }}
            >
              <div style={{ paddingTop: 1 }}>
                <DiagIcon status={test.status} />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>{test.name}</span>
                  {test.durationMs != null && (
                    <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>
                      {test.durationMs}ms
                    </span>
                  )}
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: test.status === "fail" ? "#b91c1c" : test.status === "warn" ? "#a16207" : "#6b7280", fontFamily: "monospace", wordBreak: "break-word" }}>
                  {test.detail || "—"}
                </p>
              </div>

              {(test.status === "fail" || test.status === "warn") && (
                <CopyBtn text={buildDiagPrompt(test, group)} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Pill({ n, color, bg, border, label }: { n: number; color: string; bg: string; border: string; label: string }) {
  return (
    <span style={{ padding: "1px 6px", borderRadius: 10, fontSize: 10, fontWeight: 700, color, backgroundColor: bg, border: `1px solid ${border}` }}>
      {n} {label}
    </span>
  );
}

// ─── Diagnostic runner ────────────────────────────────────────────────────────

async function runApiChecks(): Promise<DiagTest[]> {
  const routes: Array<{ name: string; url: string; expected: number; note?: string }> = [
    { name: "GET /api/projects",             url: "/api/projects",             expected: 200 },
    { name: "GET /api/auth/session",         url: "/api/auth/session",         expected: 200 },
    { name: "GET /api/devtools/diagnostics", url: "/api/devtools/diagnostics", expected: 200 },
    { name: "GET /manifest.json",            url: "/manifest.json",            expected: 200 },
  ];

  const results: DiagTest[] = [];
  for (const r of routes) {
    const t0 = Date.now();
    try {
      const res = await fetch(r.url, { method: "GET" });
      const durationMs = Date.now() - t0;
      const ok = res.status === r.expected;
      // /api/unifier/projects failing with 502 is a warning (credentials), not hard fail
      const isCredentialIssue = r.url.includes("unifier") && res.status === 502;
      results.push({
        name: r.name,
        detail: ok
          ? `${res.status} ${res.statusText} (${durationMs}ms)`
          : isCredentialIssue
          ? `${res.status} — Set UNIFIER_PASSWORD or UNIFIER_MOCK=true`
          : `Expected ${r.expected}, got ${res.status} ${res.statusText}${r.note ? ` — ${r.note}` : ""}`,
        status: ok ? "pass" : isCredentialIssue ? "warn" : "fail",
        durationMs,
      });
    } catch (err) {
      results.push({
        name: r.name,
        detail: err instanceof Error ? err.message : String(err),
        status: "fail",
        durationMs: Date.now() - t0,
      });
    }
  }
  return results;
}

async function runEmailChecks(): Promise<DiagTest[]> {
  try {
    const res = await fetch("/api/devtools/test-email");
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return [
        { name: "Email Config API", detail: err.error ?? `${res.status} ${res.statusText}`, status: "fail" },
      ];
    }
    const data = await res.json() as { data: { transport: string; resendKeySet: boolean; resendKeyValid: boolean; emailFromSet: boolean; smtpHostSet: boolean }; hint?: string };
    const c = data.data;
    const tests: DiagTest[] = [];

    tests.push({
      name: "Transport",
      detail: c.transport === "resend"
        ? "Resend (real delivery)"
        : "SMTP/Mailpit (local only — set RESEND_API_KEY + EMAIL_FROM for dev)",
      status: c.transport === "resend" ? "pass" : "warn",
    });
    tests.push({
      name: "RESEND_API_KEY",
      detail: c.resendKeyValid ? "Set and valid" : c.resendKeySet ? "Placeholder (re_YOUR...)" : "Not set",
      status: c.resendKeyValid ? "pass" : "warn",
    });
    tests.push({
      name: "EMAIL_FROM",
      detail: c.emailFromSet ? "Set" : "Not set — use a Resend-verified domain address (e.g. noreply@cp-command-center.com)",
      status: c.emailFromSet ? "pass" : "warn",
    });
    if (data.hint) {
      tests.push({ name: "Hint", detail: data.hint, status: "warn" });
    }
    return tests;
  } catch (err) {
    return [{ name: "Email Config", detail: err instanceof Error ? err.message : String(err), status: "fail" }];
  }
}

async function runServerChecks(): Promise<DiagTest[]> {
  const t0 = Date.now();
  try {
    const res = await fetch("/api/devtools/diagnostics");
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json() as {
      db: Array<{ name: string; pass: boolean; warning?: boolean; detail: string; durationMs?: number }>;
      env: Array<{ name: string; pass: boolean; warning?: boolean; detail: string }>;
    };

    const tests: DiagTest[] = [];
    for (const d of data.db) {
      tests.push({ name: d.name, detail: d.detail, status: d.pass ? "pass" : "fail", durationMs: d.durationMs });
    }
    for (const e of data.env) {
      tests.push({ name: e.name, detail: e.detail, status: e.pass ? (e.warning ? "warn" : "pass") : "fail" });
    }
    return tests;
  } catch (err) {
    return [{ name: "Diagnostics API", detail: err instanceof Error ? err.message : String(err), status: "fail", durationMs: Date.now() - t0 }];
  }
}

function runBrowserChecks(): DiagTest[] {
  const results: DiagTest[] = [];

  // localStorage
  try {
    localStorage.setItem("__devtest", "1");
    localStorage.removeItem("__devtest");
    results.push({ name: "localStorage", detail: "Read/write available", status: "pass" });
  } catch {
    results.push({ name: "localStorage", detail: "Not available or blocked", status: "fail" });
  }

  // sessionStorage
  try {
    sessionStorage.setItem("__devtest", "1");
    sessionStorage.removeItem("__devtest");
    results.push({ name: "sessionStorage", detail: "Read/write available", status: "pass" });
  } catch {
    results.push({ name: "sessionStorage", detail: "Not available or blocked", status: "fail" });
  }

  // IndexedDB
  results.push({
    name: "IndexedDB",
    detail: "indexedDB" in window ? "API available" : "Not supported in this browser",
    status: "indexedDB" in window ? "pass" : "warn",
  });

  // Service Worker API
  results.push({
    name: "Service Worker API",
    detail: "serviceWorker" in navigator ? "Supported" : "Not supported",
    status: "serviceWorker" in navigator ? "pass" : "warn",
  });

  // Fetch API
  results.push({
    name: "Fetch API",
    detail: "fetch" in window ? "Available" : "Not available",
    status: "fetch" in window ? "pass" : "fail",
  });

  // Web Notifications
  results.push({
    name: "Notifications API",
    detail: "Notification" in window
      ? `Supported — permission: ${Notification.permission}`
      : "Not supported",
    status: "Notification" in window ? "pass" : "warn",
  });

  // Online status
  results.push({
    name: "Network Status",
    detail: navigator.onLine ? "Online" : "Offline — app is running in offline mode",
    status: navigator.onLine ? "pass" : "warn",
  });

  // Clipboard API
  results.push({
    name: "Clipboard API",
    detail: navigator.clipboard ? "Available (needed for Copy AI Prompt)" : "Not available",
    status: navigator.clipboard ? "pass" : "warn",
  });

  // WebSocket
  results.push({
    name: "WebSocket",
    detail: "WebSocket" in window ? "Supported" : "Not supported",
    status: "WebSocket" in window ? "pass" : "warn",
  });

  return results;
}

async function runPWAChecks(): Promise<DiagTest[]> {
  const results: DiagTest[] = [];

  // Manifest
  const t0 = Date.now();
  try {
    const res = await fetch("/manifest.json");
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const manifest = await res.json() as Record<string, unknown>;
    const hasRequired = manifest.name && manifest.icons && manifest.start_url;
    results.push({
      name: "Web App Manifest",
      detail: hasRequired
        ? `Valid — name: "${manifest.name}", ${Array.isArray(manifest.icons) ? manifest.icons.length : 0} icon(s)`
        : `Manifest missing required fields (name, icons, start_url)`,
      status: hasRequired ? "pass" : "warn",
      durationMs: Date.now() - t0,
    });
  } catch (err) {
    results.push({ name: "Web App Manifest", detail: err instanceof Error ? err.message : String(err), status: "fail", durationMs: Date.now() - t0 });
  }

  // Service Worker registration
  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      if (reg) {
        const state = reg.active?.state ?? reg.installing?.state ?? reg.waiting?.state ?? "unknown";
        results.push({
          name: "Service Worker Registered",
          detail: `Registered — scope: ${reg.scope} — state: ${state}`,
          status: "pass",
        });

        // Waiting for update
        if (reg.waiting) {
          results.push({ name: "SW Update Pending", detail: "A new service worker is waiting to activate", status: "warn" });
        }
      } else {
        results.push({ name: "Service Worker Registered", detail: "No service worker registered for this scope", status: "warn" });
      }
    } catch (err) {
      results.push({ name: "Service Worker Registered", detail: err instanceof Error ? err.message : String(err), status: "fail" });
    }
  } else {
    results.push({ name: "Service Worker Registered", detail: "Service Worker API not supported", status: "warn" });
  }

  // Install prompt (beforeinstallprompt fires if installable and not already installed)
  results.push({
    name: "PWA Install Criteria",
    detail: window.matchMedia("(display-mode: standalone)").matches
      ? "Running as installed PWA (standalone mode)"
      : "Running in browser — app meets or does not meet install criteria",
    status: "pass",
  });

  return results;
}

function runPerformanceChecks(): DiagTest[] {
  const results: DiagTest[] = [];

  if (!("performance" in window) || !performance.getEntriesByType) {
    return [{ name: "Navigation Timing", detail: "Performance API not available", status: "warn" }];
  }

  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (!nav) {
    return [{ name: "Navigation Timing", detail: "No navigation entry yet — reload the page", status: "warn" }];
  }

  const ttfb = Math.round(nav.responseStart - nav.requestStart);
  const dcl  = Math.round(nav.domContentLoadedEventEnd - nav.startTime);
  const load = Math.round(nav.loadEventEnd - nav.startTime);
  const dns  = Math.round(nav.domainLookupEnd - nav.domainLookupStart);
  const conn = Math.round(nav.connectEnd - nav.connectStart);
  const transfer = Math.round(nav.responseEnd - nav.responseStart);

  results.push({
    name: "Time to First Byte (TTFB)",
    detail: `${ttfb}ms — ${ttfb < 200 ? "excellent" : ttfb < 500 ? "acceptable" : "slow — investigate server response time"}`,
    status: ttfb < 500 ? "pass" : "warn",
    durationMs: ttfb,
  });
  results.push({
    name: "DOM Content Loaded",
    detail: `${dcl}ms — ${dcl < 1000 ? "good" : dcl < 3000 ? "acceptable" : "slow"}`,
    status: dcl < 3000 ? "pass" : "warn",
    durationMs: dcl,
  });
  results.push({
    name: "Page Load Complete",
    detail: `${load}ms — ${load < 2000 ? "good" : load < 5000 ? "acceptable" : "slow"}`,
    status: load < 5000 ? "pass" : "warn",
    durationMs: load,
  });
  results.push({ name: "DNS Lookup", detail: `${dns}ms`, status: "pass", durationMs: dns });
  results.push({ name: "TCP Connection", detail: `${conn}ms`, status: "pass", durationMs: conn });
  results.push({ name: "Response Transfer", detail: `${transfer}ms`, status: "pass", durationMs: transfer });

  // Memory (Chrome only)
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } };
  if (perf.memory) {
    const used = Math.round(perf.memory.usedJSHeapSize / 1024 / 1024);
    const limit = Math.round(perf.memory.jsHeapSizeLimit / 1024 / 1024);
    const pct = Math.round((used / limit) * 100);
    results.push({
      name: "JS Heap Memory",
      detail: `${used} MB used of ${limit} MB limit (${pct}%)`,
      status: pct < 80 ? "pass" : "warn",
    });
  }

  return results;
}

// ─── Test Email Section ────────────────────────────────────────────────────────

function TestEmailSection() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/devtools/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: email.trim() }),
      });
      const json = await res.json();
      if (res.ok) {
        setResult({
          ok: true,
          message: json.data?.message ?? `Sent via ${json.data?.transport ?? "?"}. Check inbox.`,
        });
      } else {
        setResult({ ok: false, message: json.detail ?? json.error ?? json.message ?? "Failed" });
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ borderBottom: "1px solid #f3f4f6", padding: "16px 24px", backgroundColor: "#faf5ff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Mail size={16} style={{ color: "#7c3aed" }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Send Test Email</span>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "#6b7280" }}>
        Send a test email to verify Resend/SMTP config. Use your email to confirm delivery.
      </p>
      <form onSubmit={handleSend} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          disabled={sending}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
            fontSize: 13,
            minWidth: 200,
          }}
        />
        <button
          type="submit"
          disabled={sending || !email.trim()}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "none",
            backgroundColor: "#7c3aed",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            cursor: sending ? "not-allowed" : "pointer",
          }}
        >
          {sending ? "Sending…" : "Send Test"}
        </button>
      </form>
      {result && (
        <p
          style={{
            margin: "12px 0 0",
            fontSize: 12,
            color: result.ok ? "#15803d" : "#b91c1c",
            fontFamily: "monospace",
          }}
        >
          {result.ok ? "✓ " : "✗ "}
          {result.message}
        </p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FrontendDebugger() {
  const ctx = useDevToolsContext();
  const [issues, setIssues] = useState<FrontendIssue[]>([]);
  const [diagGroups, setDiagGroups] = useState<DiagGroup[]>([]);
  const [running, setRunning] = useState(false);
  const [lastRanAt, setLastRanAt] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"issues" | "diagnostics">("diagnostics");
  const [severityFilter, setSeverityFilter] = useState<IssueSeverity | "all">("all");

  const emitError = useCallback((count = 1, message?: string) => {
    window.dispatchEvent(new CustomEvent("devtools:new-error", { detail: { count, message: message?.slice(0, 120), tab: "debugger" } }));
  }, []);

  const addIssue = useCallback((issue: Omit<FrontendIssue, "id" | "timestamp">) => {
    const entry: FrontendIssue = { ...issue, id: nextId(), timestamp: new Date().toISOString() };
    setIssues((prev) => {
      const next = [entry, ...prev];
      return next.length > 200 ? next.slice(0, 200) : next;
    });
    if (issue.severity === "error" || issue.severity === "warning") emitError(1, issue.message);
  }, [emitError]);

  // ── Console intercept ───────────────────────────────────────────────────────
  useEffect(() => {
    const origError = console.error.bind(console);
    const origWarn  = console.warn.bind(console);
    console.error = (...args) => {
      origError(...args);
      const msg = args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
      if (!msg.includes("Warning: ReactDOM") && !msg.includes("act(")) {
        addIssue({ severity: "error", category: "console", message: msg });
      }
    };
    console.warn = (...args) => {
      origWarn(...args);
      addIssue({ severity: "warning", category: "console", message: args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ") });
    };
    return () => { console.error = origError; console.warn = origWarn; };
  }, [addIssue]);

  // ── Runtime errors ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      addIssue({ severity: "error", category: "runtime", message: e.message, detail: e.error?.stack, url: e.filename });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      addIssue({
        severity: "error", category: "runtime",
        message: `Unhandled Promise Rejection: ${r instanceof Error ? r.message : String(r)}`,
        detail: r instanceof Error ? r.stack : undefined,
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, [addIssue]);

  // ── Fetch intercept ─────────────────────────────────────────────────────────
  useEffect(() => {
    const orig = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const url =
        typeof args[0] === "string"
          ? args[0]
          : args[0] instanceof URL
          ? args[0].href
          : (args[0] as Request).url ?? "";
      if (url.includes("/api/devtools/logs") || url.includes("/api/devtools/diagnostics")) return orig(...args);
      try {
        const res = await orig(...args);
        if (!res.ok) {
          addIssue({ severity: res.status >= 500 ? "error" : "warning", category: "network", message: `${res.status} ${res.statusText} — ${url}`, url, status: res.status });
        }
        return res;
      } catch (err) {
        addIssue({ severity: "error", category: "network", message: `Network failed — ${url}\n${err instanceof Error ? err.message : String(err)}`, url });
        throw err;
      }
    };
    return () => { window.fetch = orig; };
  }, [addIssue]);

  // ── Run diagnostics ─────────────────────────────────────────────────────────
  const runDiagnostics = useCallback(async () => {
    setRunning(true);
    setActiveSection("diagnostics");

    // Build skeleton with "pending" state so all tests are visible immediately
    const skeleton: DiagGroup[] = [
      { id: "server",  label: "Server & Environment", icon: <Server size={15} />,    tests: [] },
      { id: "email",   label: "Email (Invites)",       icon: <Mail size={15} />,      tests: [] },
      { id: "api",     label: "API Routes",            icon: <Globe size={15} />,     tests: [] },
      { id: "browser", label: "Browser Capabilities",  icon: <Monitor size={15} />,  tests: [] },
      { id: "pwa",     label: "PWA",                   icon: <Smartphone size={15} />, tests: [] },
      { id: "perf",    label: "Performance",            icon: <Zap size={15} />,      tests: [] },
    ];
    setDiagGroups(skeleton);

    // Run all groups, updating each as it completes
    const [serverTests, emailTests, apiTests, browserTests, pwaTests, perfTests] = await Promise.all([
      runServerChecks().then((tests) => {
        setDiagGroups((prev) => prev.map((g) => g.id === "server" ? { ...g, tests } : g));
        return tests;
      }),
      runEmailChecks().then((tests) => {
        setDiagGroups((prev) => prev.map((g) => g.id === "email" ? { ...g, tests } : g));
        return tests;
      }),
      runApiChecks().then((tests) => {
        setDiagGroups((prev) => prev.map((g) => g.id === "api" ? { ...g, tests } : g));
        return tests;
      }),
      Promise.resolve(runBrowserChecks()).then((tests) => {
        setDiagGroups((prev) => prev.map((g) => g.id === "browser" ? { ...g, tests } : g));
        return tests;
      }),
      runPWAChecks().then((tests) => {
        setDiagGroups((prev) => prev.map((g) => g.id === "pwa" ? { ...g, tests } : g));
        return tests;
      }),
      Promise.resolve(runPerformanceChecks()).then((tests) => {
        setDiagGroups((prev) => prev.map((g) => g.id === "perf" ? { ...g, tests } : g));
        return tests;
      }),
    ]);

    void [serverTests, emailTests, apiTests, browserTests, pwaTests, perfTests]; // consumed via setDiagGroups above
    setLastRanAt(new Date().toLocaleTimeString());
    setRunning(false);
  }, []);

  // Run on mount (defer to avoid setState-in-effect lint)
  useEffect(() => {
    queueMicrotask(() => void runDiagnostics());
  }, [runDiagnostics]);

  // ── Counts ──────────────────────────────────────────────────────────────────
  const allTests  = diagGroups.flatMap((g) => g.tests);
  const totalPass = allTests.filter((t) => t.status === "pass").length;
  const totalWarn = allTests.filter((t) => t.status === "warn").length;
  const totalFail = allTests.filter((t) => t.status === "fail").length;
  const totalPending = allTests.filter((t) => t.status === "pending" || t.status === "running").length;

  const errCount  = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warning").length;
  const filteredIssues = issues.filter((i) => severityFilter === "all" || i.severity === severityFilter);

  // Sync issues and diagnostic failures to Error Wrap-Up context
  // Note: ctx excluded from deps to avoid loop (setDebuggerData updates context → ctx changes → effect re-runs)
  useEffect(() => {
    if (!ctx) return;
    const diagFailures = diagGroups.flatMap((g) =>
      g.tests
        .filter((t) => t.status === "fail" || t.status === "warn")
        .map((t) => ({ group: g.label, name: t.name, detail: t.detail, status: t.status } as const))
    );
    ctx.setDebuggerData(issues, diagFailures);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx intentionally excluded
  }, [issues, diagGroups]);

  return (
    <div className="flex flex-col" style={{ flex: 1, overflow: "hidden", backgroundColor: "#fff" }}>

      {/* ── Section tabs ── */}
      <div className="flex-shrink-0 flex items-center" style={{ borderBottom: "2px solid #f3f4f6", backgroundColor: "#f9fafb" }}>
        {[
          { id: "diagnostics" as const, label: "Diagnostics", alert: totalFail > 0 || totalWarn > 0, count: allTests.length },
          { id: "issues"      as const, label: "Issues",       alert: errCount > 0,                    count: issues.length },
        ].map(({ id, label, alert, count }) => {
          const isActive = activeSection === id;
          return (
            <button key={id} onClick={() => setActiveSection(id)} style={{
              padding: "10px 20px", fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "#7c3aed" : "#6b7280",
              backgroundColor: isActive ? "#fff" : "transparent",
              border: "none", borderBottom: isActive ? "2px solid #7c3aed" : "2px solid transparent",
              marginBottom: -2, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s",
            }}>
              {label}
              {count > 0 && (
                <span style={{ padding: "1px 6px", borderRadius: 10, fontSize: 11, fontWeight: 700, backgroundColor: alert ? "#fef2f2" : "#f3f4f6", color: alert ? "#b91c1c" : "#6b7280", border: `1px solid ${alert ? "#fecaca" : "#e5e7eb"}` }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}

        <div style={{ flex: 1 }} />

        <button
          onClick={runDiagnostics}
          disabled={running}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            margin: "6px 16px", padding: "4px 12px",
            borderRadius: 5, fontSize: 12, fontWeight: 500,
            border: "1px solid #d1d5db", backgroundColor: "#fff",
            color: running ? "#9ca3af" : "#374151",
            cursor: running ? "not-allowed" : "pointer",
          }}
        >
          <RefreshCw size={12} style={{ animation: running ? "spin 1s linear infinite" : "none" }} />
          {running ? "Running…" : "Run All Checks"}
        </button>
      </div>

      {/* ── Diagnostics section ── */}
      {activeSection === "diagnostics" && (
        <>
          {/* Summary bar */}
          {allTests.length > 0 && (
            <div className="flex-shrink-0 flex items-center gap-3 flex-wrap" style={{ padding: "8px 16px", backgroundColor: "#f9fafb", borderBottom: "1px solid #f3f4f6" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
                {running ? `Running… (${totalPending} remaining)` : `Last run: ${lastRanAt ?? "—"}`}
              </span>
              <div className="flex items-center gap-2" style={{ marginLeft: "auto" }}>
                {totalPass > 0  && <Pill n={totalPass}  color="#15803d" bg="#f0fdf4" border="#bbf7d0" label="passed" />}
                {totalWarn > 0  && <Pill n={totalWarn}  color="#a16207" bg="#fefce8" border="#fde68a" label="warned" />}
                {totalFail > 0  && <Pill n={totalFail}  color="#b91c1c" bg="#fef2f2" border="#fecaca" label="failed" />}
                {totalPending > 0 && <Pill n={totalPending} color="#7c3aed" bg="#faf5ff" border="#e9d5ff" label="pending" />}
              </div>
            </div>
          )}

          {/* Groups */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {diagGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center" style={{ padding: "48px 24px", color: "#9ca3af", gap: 10 }}>
                <Bug size={28} style={{ opacity: 0.3 }} />
                <p style={{ margin: 0, fontSize: 13 }}>Click &quot;Run All Checks&quot; to run diagnostics.</p>
              </div>
            ) : (
              <>
                {diagGroups.map((group) => (
                  <DiagGroupSection key={group.id} group={group} running={running} />
                ))}
              </>
            )}
            <TestEmailSection />
          </div>
        </>
      )}

      {/* ── Issues section ── */}
      {activeSection === "issues" && (
        <>
          <div className="flex-shrink-0 flex items-center gap-2" style={{ padding: "8px 16px", borderBottom: "1px solid #f3f4f6", backgroundColor: "#fafafa" }}>
            {(["all", "error", "warning", "info"] as const).map((s) => {
              const cnt = s === "all" ? issues.length : issues.filter((i) => i.severity === s).length;
              return (
                <button key={s} onClick={() => setSeverityFilter(s)} style={{
                  padding: "2px 10px", borderRadius: 4, fontSize: 11, fontWeight: 500,
                  border: "1px solid", borderColor: severityFilter === s ? "#7c3aed" : "#e5e7eb",
                  backgroundColor: severityFilter === s ? "#7c3aed" : "transparent",
                  color: severityFilter === s ? "#fff" : "#6b7280", cursor: "pointer",
                }}>
                  {s === "all" ? `All (${cnt})` : `${s.charAt(0).toUpperCase() + s.slice(1)} (${cnt})`}
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            <button onClick={() => setIssues([])} style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4, fontSize: 11, border: "1px solid #e5e7eb", backgroundColor: "transparent", color: "#9ca3af", cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#b91c1c")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#9ca3af")}
            >
              <Trash2 size={11} /> Clear
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {filteredIssues.length === 0 ? (
              <div className="flex flex-col items-center justify-center" style={{ padding: "48px 24px", color: "#9ca3af", gap: 10 }}>
                <Bug size={28} style={{ opacity: 0.3 }} />
                <p style={{ margin: 0, fontSize: 13, textAlign: "center" }}>
                  {issues.length === 0 ? "No issues captured. Interact with the app to detect console, runtime, and network errors." : "No issues match this filter."}
                </p>
              </div>
            ) : (
              filteredIssues.map((issue) => <IssueRow key={issue.id} issue={issue} allIssues={issues} />)
            )}
          </div>
        </>
      )}

      {/* ── Footer ── */}
      <div className="flex-shrink-0 flex items-center justify-between" style={{ padding: "6px 16px", borderTop: "1px solid #f3f4f6", fontSize: 11, color: "#9ca3af", backgroundColor: "#fafafa" }}>
        <span>
          {errCount > 0 && <span style={{ color: "#b91c1c", fontWeight: 600, marginRight: 8 }}>{errCount} error{errCount !== 1 ? "s" : ""}</span>}
          {warnCount > 0 && <span style={{ color: "#a16207", fontWeight: 600, marginRight: 8 }}>{warnCount} warning{warnCount !== 1 ? "s" : ""}</span>}
          {errCount === 0 && warnCount === 0 && "No runtime issues"}
        </span>
        <span>{allTests.length} diagnostic checks</span>
      </div>
    </div>
  );
}

// ─── IssueRow ─────────────────────────────────────────────────────────────────

function IssueRow({ issue, allIssues }: { issue: FrontendIssue; allIssues: FrontendIssue[] }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = SEVERITY_CFG[issue.severity];
  const time = new Date(issue.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div style={{ borderBottom: "1px solid #f3f4f6", borderLeft: `3px solid ${cfg.border}` }}>
      <div className="flex items-start gap-3" style={{ padding: "10px 16px", cursor: issue.detail ? "pointer" : "default" }} onClick={() => issue.detail && setExpanded((e) => !e)}>
        <div style={{ paddingTop: 1 }}>
          {issue.severity === "error" ? <XCircle size={15} style={{ color: cfg.color }} /> : issue.severity === "warning" ? <AlertTriangle size={15} style={{ color: cfg.color }} /> : <CheckCircle2 size={15} style={{ color: cfg.color }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 3 }}>
            <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", backgroundColor: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>{cfg.label}</span>
            <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600, backgroundColor: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb" }}>{CAT_LABELS[issue.category]}</span>
            {issue.status != null && <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600, fontFamily: "monospace", backgroundColor: issue.status >= 400 ? "#fef2f2" : "#f0fdf4", color: issue.status >= 400 ? "#b91c1c" : "#15803d", border: `1px solid ${issue.status >= 400 ? "#fecaca" : "#bbf7d0"}` }}>{issue.status}</span>}
            <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>{time}</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "#111827", lineHeight: "18px", fontFamily: "ui-monospace, Menlo, monospace", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: expanded ? undefined : 2, WebkitBoxOrient: "vertical", whiteSpace: expanded ? "pre-wrap" : undefined, wordBreak: "break-all" }}>
            {issue.message}
          </p>
          {issue.url && <p style={{ margin: "3px 0 0", fontSize: 11, color: "#6b7280", fontFamily: "monospace" }}>{issue.url}</p>}
        </div>
        <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
          <CopyBtn text={buildIssuePrompt(issue, allIssues)} />
          {issue.detail && (
            <button onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x); }} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 4, border: "1px solid #e5e7eb", backgroundColor: "transparent", color: "#6b7280", cursor: "pointer" }}>
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          )}
        </div>
      </div>
      {expanded && issue.detail && (
        <pre style={{ margin: 0, padding: "8px 16px 12px 44px", fontSize: 11, fontFamily: "ui-monospace, Menlo, monospace", color: "#374151", backgroundColor: "#f9fafb", borderTop: "1px solid #f3f4f6", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: "17px" }}>
          {issue.detail}
        </pre>
      )}
    </div>
  );
}
