"use client";

/**
 * TestRunner
 *
 * Runs unit + integration tests via /api/devtools/run-tests.
 * - Manual run: click Run Unit or Run All
 * - Auto-run: when enabled, runs unit+integration every 90s in the background
 * - On failure: dispatches devtools:test-failed (toast) and devtools:new-error (badge)
 * - Recent tests: shows test files added/changed since last "Mark as seen"
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Play, RefreshCw, CheckCircle2, XCircle, ToggleLeft, ToggleRight, Sparkles, Check } from "lucide-react";
import { useDevToolsContext } from "./DevToolsContext";

const STORAGE_KEY = "devtools-test-runner-last-seen-commit";

type Suite = "unit" | "integration";
type RunStatus = "idle" | "running" | "pass" | "fail";

interface RunResult {
  suite: Suite;
  status: RunStatus;
  passed: number;
  failed: number;
  duration: number;
  output: string[];
}

const SUITES: { id: Suite; label: string }[] = [
  { id: "unit", label: "Unit" },
  { id: "integration", label: "Integration" },
];

interface RecentTestsResponse {
  files: string[];
  currentCommit: string;
  sinceCommit?: string;
  hint?: string;
}

export function TestRunner() {
  const ctx = useDevToolsContext();
  const [autoRun, setAutoRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [lastSeenCommit, setLastSeenCommit] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch recent tests (new since last "Mark as seen")
  const fetchRecentTests = useCallback(async () => {
    try {
      const since = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      const url = since
        ? `/api/devtools/recent-tests?since=${encodeURIComponent(since)}`
        : "/api/devtools/recent-tests?commits=10";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return;
      const data: RecentTestsResponse = await res.json();
      setRecentFiles(data.files ?? []);
      setLastSeenCommit(data.currentCommit);
    } catch {
      setRecentFiles([]);
    }
  }, []);

  useEffect(() => {
    fetchRecentTests();
  }, [fetchRecentTests]);

  const markAsSeen = useCallback(() => {
    if (lastSeenCommit && typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, lastSeenCommit);
      setRecentFiles([]);
    }
  }, [lastSeenCommit]);

  const runTests = useCallback((suite: Suite): Promise<void> => {
    return new Promise((resolve) => {
      setRunning(true);
      setOutput([]);
      setLastResult(null);

      const url = `/api/devtools/run-tests?suite=${suite}`;
      const es = new EventSource(url);

      let passed = 0;
      let failed = 0;
      const lines: string[] = [];

      es.addEventListener("line", (e: MessageEvent) => {
        try {
          const { text } = JSON.parse(e.data as string) as { text: string };
          lines.push(text);
          setOutput((prev) => [...prev.slice(-200), text]);
        } catch { /* ignore */ }
      });

      es.addEventListener("result", (e: MessageEvent) => {
        try {
          const { type } = JSON.parse(e.data as string) as { type: "pass" | "fail" };
          if (type === "pass") passed++;
          if (type === "fail") failed++;
        } catch { /* ignore */ }
      });

      es.addEventListener("done", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data as string) as { exitCode: number; passed: number; failed: number; duration: number };
          passed = data.passed;
          failed = data.failed;
          const status: RunStatus = data.exitCode === 0 ? "pass" : "fail";
          setLastResult({
            suite,
            status,
            passed,
            failed,
            duration: data.duration,
            output: lines,
          });
          setRunning(false);
          es.close();

          if (status === "fail") {
            window.dispatchEvent(
              new CustomEvent("devtools:test-failed", {
                detail: { failed, passed, suite },
              })
            );
            window.dispatchEvent(
              new CustomEvent("devtools:new-error", {
                detail: { count: 1, message: `Tests failed: ${failed} failed`, tab: "test-runner" },
              })
            );
          }
          resolve();
        } catch {
          setRunning(false);
          es.close();
          resolve();
        }
      });

      // Named "error" SSE event sent by the server when spawn fails.
      es.addEventListener("error", (e: Event) => {
        // If it carries SSE data (custom error event from server), show it.
        const msg = (e as MessageEvent).data;
        if (typeof msg === "string") {
          try {
            const { message } = JSON.parse(msg) as { message: string };
            lines.push(`❌ Error: ${message}`);
            setOutput((prev) => [...prev, `❌ Error: ${message}`]);
          } catch { /* raw error — ignore */ }
        }
        setRunning(false);
        es.close();
        resolve();
      });
    });
  }, []);

  // Sync test run failures to Error Wrap-Up context
  // Note: ctx excluded from deps to avoid loop (setTestRunFailure updates context → ctx changes → effect re-runs)
  useEffect(() => {
    if (!ctx) return;
    if (lastResult && lastResult.status === "fail" && lastResult.failed > 0) {
      ctx.setTestRunFailure({
        suite: lastResult.suite,
        failed: lastResult.failed,
        passed: lastResult.passed,
        output: lastResult.output,
      });
    } else {
      ctx.setTestRunFailure(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx intentionally excluded
  }, [lastResult]);

  // Auto-run: run unit+integration every 90s when enabled
  useEffect(() => {
    if (!autoRun) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const runBoth = () => {
      void runTests("unit").then(() => {
        if (intervalRef.current) void runTests("integration");
      });
    };

    runBoth();
    intervalRef.current = setInterval(runBoth, 90_000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRun, runTests]);

  return (
    <div className="flex flex-col" style={{ flex: 1, overflow: "hidden", backgroundColor: "#fff" }}>
      {/* Toolbar */}
      <div
        className="flex flex-wrap items-center gap-4"
        style={{
          padding: "var(--space-4) var(--space-6)",
          borderBottom: "1px solid var(--neutral-200)",
          backgroundColor: "var(--neutral-50)",
        }}
      >
        <h3 style={{ fontSize: "var(--text-subheading)", fontWeight: 600, color: "var(--neutral-800)", margin: 0 }}>
          Test Runner
        </h3>

        <button
          onClick={() => {
            void runTests("unit").then(() => runTests("integration"));
          }}
          disabled={running}
          className="flex items-center gap-2"
          style={{
            padding: "var(--space-2) var(--space-4)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--primary-500)",
            backgroundColor: "var(--primary-500)",
            color: "var(--neutral-0)",
            fontSize: "var(--text-caption)",
            fontWeight: 600,
            cursor: running ? "not-allowed" : "pointer",
            opacity: running ? 0.6 : 1,
          }}
        >
          <Play size={14} />
          Run All
        </button>
        {SUITES.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => runTests(id)}
            disabled={running}
            className="flex items-center gap-2"
            style={{
              padding: "var(--space-2) var(--space-4)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--neutral-300)",
              backgroundColor: "var(--neutral-0)",
              color: "var(--neutral-700)",
              fontSize: "var(--text-caption)",
              fontWeight: 500,
              cursor: running ? "not-allowed" : "pointer",
              opacity: running ? 0.6 : 1,
            }}
          >
            <Play size={14} />
            Run {label}
          </button>
        ))}

        <div className="flex items-center gap-2" style={{ marginLeft: "auto" }}>
          <span style={{ fontSize: "var(--text-caption)", color: "var(--neutral-600)" }}>Auto-run (90s)</span>
          <button
            onClick={() => setAutoRun((v) => !v)}
            style={{
              padding: 0,
              border: "none",
              background: "none",
              cursor: "pointer",
              color: autoRun ? "var(--primary-600)" : "var(--neutral-400)",
            }}
            title={autoRun ? "Disable auto-run" : "Enable auto-run"}
          >
            {autoRun ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
          </button>
        </div>
      </div>

      {/* Recent tests — new since last "Mark as seen" */}
      {recentFiles.length > 0 && (
        <div
          style={{
            padding: "var(--space-3) var(--space-6)",
            borderBottom: "1px solid var(--neutral-200)",
            backgroundColor: "var(--primary-50)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-4)",
            flexWrap: "wrap",
          }}
        >
          <div className="flex items-center gap-2">
            <Sparkles size={18} style={{ color: "var(--primary-600)", flexShrink: 0 }} />
            <span style={{ fontSize: "var(--text-body)", fontWeight: 500, color: "var(--primary-800)" }}>
              {recentFiles.length} new test file{recentFiles.length !== 1 ? "s" : ""} since last run
            </span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", maxWidth: 400 }}>
              {recentFiles.slice(0, 5).map((f) => (
                <code
                  key={f}
                  style={{
                    fontSize: 11,
                    padding: "2px 6px",
                    backgroundColor: "var(--primary-100)",
                    borderRadius: 4,
                    color: "var(--primary-800)",
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  {f}
                </code>
              ))}
              {recentFiles.length > 5 && (
                <span style={{ fontSize: "var(--text-caption)", color: "var(--primary-600)" }}>
                  +{recentFiles.length - 5} more
                </span>
              )}
            </div>
            <button
              onClick={markAsSeen}
              className="flex items-center gap-2"
              style={{
                padding: "var(--space-1) var(--space-3)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--primary-300)",
                backgroundColor: "var(--primary-100)",
                color: "var(--primary-700)",
                fontSize: "var(--text-caption)",
                fontWeight: 500,
                cursor: "pointer",
              }}
              title="Mark these as seen. Next time, only tests changed after this will show as new."
            >
              <Check size={14} />
              Mark as seen
            </button>
          </div>
        </div>
      )}

      {/* Last result summary */}
      {lastResult && (
        <div
          style={{
            padding: "var(--space-3) var(--space-6)",
            borderBottom: "1px solid var(--neutral-200)",
            backgroundColor: lastResult.status === "pass" ? "var(--success-50)" : "var(--error-50)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-4)",
          }}
        >
          {lastResult.status === "pass" ? (
            <CheckCircle2 size={20} style={{ color: "var(--success-600)" }} />
          ) : (
            <XCircle size={20} style={{ color: "var(--error-600)" }} />
          )}
          <span style={{ fontSize: "var(--text-body)", fontWeight: 500, color: lastResult.status === "pass" ? "var(--success-700)" : "var(--error-700)" }}>
            {lastResult.suite}: {lastResult.passed} passed, {lastResult.failed} failed ({lastResult.duration}ms)
          </span>
        </div>
      )}

      {/* Output */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "var(--space-4)",
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: 12,
          lineHeight: 1.5,
          backgroundColor: "#0f172a",
          color: "#94a3b8",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {output.length === 0 && !running && (
          <span style={{ color: "#64748b" }}>Click Run Unit or Run Integration to run tests. Enable Auto-run to run every 90s.</span>
        )}
        {output.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        {running && (
          <div className="flex items-center gap-2" style={{ marginTop: 8, color: "#7c3aed" }}>
            <RefreshCw size={14} className="animate-spin" />
            Running…
          </div>
        )}
      </div>
    </div>
  );
}
