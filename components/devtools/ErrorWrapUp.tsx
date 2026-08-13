"use client";

/**
 * Error Wrap-Up — aggregates errors, warnings, and suggestions from all DevTools
 * into a single prompt for pasting to an AI agent.
 *
 * Local dev: standard context
 * Deployed dev: adds environment context (Railway, NEXTAUTH_URL, etc.)
 */

import { useState, useCallback, useEffect } from "react";
import { RefreshCw, Copy, Check, FileText } from "lucide-react";
import { useDevToolsContext } from "./DevToolsContext";

function getIsDeployedDev(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1"
  );
}

interface DiagResult {
  name: string;
  pass: boolean;
  warning?: boolean;
  detail: string;
}

function buildPrompt(data: {
  debuggerIssues: Array<{ severity: string; message: string; url?: string; status?: number }>;
  debuggerDiagFailures: Array<{ group: string; name: string; detail: string; status: string }>;
  serverLogErrorsWarnings: Array<{ timestamp: string; level: string; message: string }>;
  testPlanGaps: Array<{ sourceFile: string; status: string; linesPct: number; suggestedTestPath: string }>;
  testRunFailure: { suite: string; failed: number; passed: number; output: string[] } | null;
  fetchedDiagnostics?: { db?: DiagResult[]; env?: DiagResult[] };
  fetchedLogs?: Array<{ level: string; message: string }>;
  fetchedTestPlan?: { entries?: Array<{ status: string; sourceFile: string; linesPct: number }> };
}): string {
  const sections: string[] = [];

  const isDeployedDev = getIsDeployedDev();
  if (isDeployedDev) {
    sections.push(
      "## Environment",
      "",
      "**This is the DEPLOYED DEV environment** (Railway or similar).",
      `**URL:** ${typeof window !== "undefined" ? window.location.origin : "unknown"}`,
      "**Relevant for debugging:** Check Railway Variables (DATABASE_URL, AUTH_SECRET, NEXTAUTH_URL, RESEND_API_KEY, UNIFIER_*).",
      ""
    );
  }

  sections.push(
    "## Rad Dash — DevTools Error Wrap-Up",
    "",
    `**Timestamp:** ${new Date().toLocaleString()}`,
    `**Environment:** ${getIsDeployedDev() ? "Deployed dev" : "Local development"}`,
    ""
  );

  const diagFailuresFromFetch = [
    ...(data.fetchedDiagnostics?.db ?? []).filter((r) => !r.pass || r.warning),
    ...(data.fetchedDiagnostics?.env ?? []).filter((r) => !r.pass || r.warning),
  ];
  const hasAnyIssue =
    data.debuggerIssues.length > 0 ||
    data.debuggerDiagFailures.length > 0 ||
    data.serverLogErrorsWarnings.length > 0 ||
    data.testPlanGaps.length > 0 ||
    !!data.testRunFailure ||
    diagFailuresFromFetch.length > 0;
  const fetchedErrors =
    data.fetchedLogs?.filter((e) => e.level === "error" || e.level === "warn") ?? [];
  const fetchedGaps = data.fetchedTestPlan?.entries?.filter((e) => e.status !== "complete") ?? [];
  if (
    !hasAnyIssue &&
    fetchedErrors.length === 0 &&
    fetchedGaps.length === 0
  ) {
    sections.push("No errors, warnings, or coverage gaps detected. All systems nominal.");
    return sections.join("\n");
  }

  if (data.debuggerIssues.length > 0) {
    sections.push("### Frontend / Debugger Issues", "");
    for (const i of data.debuggerIssues) {
      sections.push(`- [${i.severity.toUpperCase()}] ${i.message}${i.url ? ` (${i.url})` : ""}${i.status != null ? ` — HTTP ${i.status}` : ""}`);
    }
    sections.push("");
  }

  if (data.debuggerDiagFailures.length > 0) {
    sections.push("### Diagnostic Failures (from Debugger)", "");
    for (const f of data.debuggerDiagFailures) {
      sections.push(`- **${f.group} / ${f.name}** [${f.status}]: ${f.detail}`);
    }
    sections.push("");
  }

  if (diagFailuresFromFetch.length > 0) {
    sections.push("### Server Diagnostics (DB & Env)", "");
    for (const r of diagFailuresFromFetch) {
      const tag = r.pass && r.warning ? "WARNING" : "FAIL";
      sections.push(`- **${r.name}** [${tag}]: ${r.detail}`);
    }
    sections.push("");
  }

  if (data.serverLogErrorsWarnings.length > 0) {
    sections.push("### Server Log (Errors & Warnings)", "");
    for (const e of data.serverLogErrorsWarnings.slice(-50)) {
      const t = new Date(e.timestamp).toLocaleTimeString();
      sections.push(`- [${t}] [${e.level.toUpperCase()}] ${e.message.split("\n")[0]?.slice(0, 200) ?? ""}`);
    }
    sections.push("");
  }

  if (data.fetchedLogs && data.serverLogErrorsWarnings.length === 0) {
    const errs = data.fetchedLogs.filter((e) => e.level === "error" || e.level === "warn");
    if (errs.length > 0) {
      sections.push("### Server Log (from snapshot)", "");
      for (const e of errs.slice(-30)) {
        sections.push(`- [${e.level.toUpperCase()}] ${(e.message as string).split("\n")[0]?.slice(0, 200) ?? ""}`);
      }
      sections.push("");
    }
  }

  if (data.testPlanGaps.length > 0 || (data.fetchedTestPlan?.entries && data.fetchedTestPlan.entries.filter((e) => e.status !== "complete").length > 0)) {
    sections.push("### Test Plan — Coverage Gaps (not 100%)", "");
    const gaps = data.testPlanGaps.length > 0 ? data.testPlanGaps : (data.fetchedTestPlan?.entries ?? []).filter((e) => e.status !== "complete").map((e) => ({ sourceFile: e.sourceFile, status: e.status, linesPct: e.linesPct, suggestedTestPath: "" }));
    for (const g of gaps) {
      sections.push(`- **${g.sourceFile}** — ${g.status} (${g.linesPct.toFixed(0)}% lines)${g.suggestedTestPath ? ` → ${g.suggestedTestPath}` : ""}`);
    }
    sections.push("");
  }

  if (data.testRunFailure && data.testRunFailure.failed > 0) {
    sections.push("### Test Runner — Failed Tests", "");
    sections.push(`- **${data.testRunFailure.suite}**: ${data.testRunFailure.failed} failed, ${data.testRunFailure.passed} passed`);
    const failLines = data.testRunFailure.output.filter((l) => l.includes("FAIL") || l.includes("✗") || l.includes("Error"));
    for (const line of failLines.slice(-20)) {
      sections.push(`  ${line.slice(0, 120)}`);
    }
    sections.push("");
  }

  sections.push(
    "### Task",
    "",
    "Please analyze the errors, warnings, and coverage gaps above. For each:",
    "1. Identify the root cause.",
    "2. Provide the exact code change or configuration fix needed.",
    "3. Reference specific file paths and line numbers where applicable.",
    "4. For env/config issues, specify which variables need to be set and where.",
    ""
  );

  return sections.join("\n");
}

export function ErrorWrapUp() {
  const ctx = useDevToolsContext();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const gather = useCallback(async () => {
    setLoading(true);
    setPrompt("");
    try {
      const [diagRes, logsRes, planRes] = await Promise.all([
        fetch("/api/devtools/diagnostics", { credentials: "include" }),
        fetch("/api/devtools/logs-snapshot", { credentials: "include" }),
        fetch("/api/devtools/test-plan", { credentials: "include" }),
      ]);

      const diag = diagRes.ok ? await diagRes.json() : null;
      const logsData = logsRes.ok ? await logsRes.json() : null;
      const planData = planRes.ok ? await planRes.json() : null;

      const data = {
        debuggerIssues: ctx?.debuggerIssues ?? [],
        debuggerDiagFailures: ctx?.debuggerDiagFailures ?? [],
        serverLogErrorsWarnings: ctx?.serverLogErrorsWarnings ?? [],
        testPlanGaps: ctx?.testPlanGaps ?? [],
        testRunFailure: ctx?.testRunFailure ?? null,
        fetchedDiagnostics: diag ?? null,
        fetchedLogs: logsData?.entries ?? null,
        fetchedTestPlan: planData ?? null,
      };

      const generated = buildPrompt(data);
      setPrompt(generated);
    } catch (err) {
      setPrompt(`Error gathering data: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [ctx]);

  const copy = useCallback(async () => {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [prompt]);

  // Auto-run when tab is opened (runs once on mount)
  useEffect(() => {
    void gather();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: run once on mount

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-auto" style={{ padding: "var(--space-6)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", marginBottom: "var(--space-4)" }}>
        <FileText size={24} style={{ color: "var(--primary-600)" }} aria-hidden />
        <div>
          <h3 style={{ margin: 0, fontSize: "var(--text-subheading)", fontWeight: 600 }}>
            Error Wrap-Up
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: "var(--text-caption)", color: "var(--neutral-600)" }}>
            Aggregate all errors, warnings, and coverage gaps into one prompt for an AI agent
          </p>
        </div>
      </div>

      {!prompt && !loading && (
        <p style={{ margin: "0 0 var(--space-4)", color: "var(--neutral-600)", fontSize: "var(--text-body)" }}>
          Fetches diagnostics, server logs, and test plan, then combines with data from the Debugger, Server Logs, Test Runner, and Test Plan tabs into one prompt.
        </p>
      )}

      {/* Primary action — prominent, always visible */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap", marginBottom: "var(--space-6)" }}>
        <button
          type="button"
          onClick={gather}
          disabled={loading}
          aria-label="Gather diagnostics and generate prompt"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "calc(var(--space-2) + var(--space-1)) var(--space-6)",
            backgroundColor: "var(--primary)",
            color: "var(--primary-foreground)",
            border: "none",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--text-body)",
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
            boxShadow: "var(--shadow-1)",
          }}
        >
          <RefreshCw size={18} className={loading ? "animate-spin" : ""} aria-hidden />
          {loading ? "Gathering…" : "Gather & Generate"}
        </button>
          {prompt && (
            <button
              onClick={copy}
              aria-label="Copy prompt to clipboard"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 20px",
                backgroundColor: copied ? "var(--success-600)" : "var(--neutral-200)",
                color: copied ? "white" : "var(--neutral-800)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-body)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? "Copied!" : "Copy Prompt"}
            </button>
          )}
      </div>

      {prompt && (
        <pre
          style={{
            flex: 1,
            overflow: "auto",
            margin: 0,
            padding: "var(--space-4)",
            backgroundColor: "var(--neutral-100)",
            border: "1px solid var(--neutral-300)",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
            fontFamily: "ui-monospace, monospace",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {prompt}
        </pre>
      )}
    </div>
  );
}
