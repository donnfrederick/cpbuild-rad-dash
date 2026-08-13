"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, CheckCircle2, AlertCircle, XCircle, Filter, Sparkles } from "lucide-react";
import { useDevToolsContext } from "./DevToolsContext";

const STORAGE_KEY = "devtools-test-runner-last-seen-commit";

interface TestPlanEntry {
  sourceFile: string;
  linesPct: number;
  statementsPct: number;
  functionsPct: number;
  branchesPct: number;
  status: "complete" | "partial" | "missing";
  hasTest: boolean;
  testFile: string | null;
  suggestedTestPath: string;
  category: "api" | "lib" | "components" | "hooks";
}

interface TestPlanResponse {
  total: { lines: number; statements: number; functions: number; branches: number } | null;
  entries: TestPlanEntry[];
  generatedAt: string;
  hint: string;
}

type StatusFilter = "all" | "complete" | "partial" | "missing";

const STATUS_CONFIG = {
  complete: { label: "Complete", icon: CheckCircle2, color: "var(--success-600)", bg: "var(--success-50)" },
  partial: { label: "Partial", icon: AlertCircle, color: "var(--warning-600)", bg: "var(--warning-50)" },
  missing: { label: "Missing", icon: XCircle, color: "var(--error-600)", bg: "var(--error-50)" },
} as const;

const CATEGORY_LABELS: Record<string, string> = {
  api: "API",
  lib: "Lib",
  components: "Components",
  hooks: "Hooks",
};

type PlanMode = "unit" | "e2e";

interface E2eSpecEntry {
  file: string;
  blocks: { describe: string; tests: string[] }[];
  totalTests: number;
}

interface E2eFlow {
  id: string;
  label: string;
  covered: boolean;
}

interface E2ePlanResponse {
  entries: E2eSpecEntry[];
  flows: E2eFlow[];
  totalTests: number;
  generatedAt: string;
  hint: string;
}

export function TestPlanVisualizer() {
  const ctx = useDevToolsContext();
  const [mode, setMode] = useState<PlanMode>("unit");
  const [data, setData] = useState<TestPlanResponse | null>(null);
  const [e2eData, setE2eData] = useState<E2ePlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [recentTestFiles, setRecentTestFiles] = useState<Set<string>>(new Set());
  const [newFilter, setNewFilter] = useState(false);

  const fetchPlan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = mode === "unit" ? "/api/devtools/test-plan" : "/api/devtools/e2e-test-plan";
      const res = await fetch(url, { credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
      if (mode === "unit") setData(json);
      else setE2eData(json);

      // Fetch recent test files (shared with Test Runner)
      try {
        const since = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        const recentUrl = since
          ? `/api/devtools/recent-tests?since=${encodeURIComponent(since)}`
          : "/api/devtools/recent-tests?commits=10";
        const recentRes = await fetch(recentUrl, { credentials: "include" });
        if (recentRes.ok) {
          const recent = await recentRes.json();
          setRecentTestFiles(new Set(recent.files ?? []));
        }
      } catch {
        setRecentTestFiles(new Set());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  const filteredEntries =
    data?.entries.filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
      if (search.trim() && !e.sourceFile.toLowerCase().includes(search.toLowerCase())) return false;
      if (newFilter) {
        if (!e.testFile) return false;
        if (!recentTestFiles.has(e.testFile)) return false;
      }
      return true;
    }) ?? [];

  const newCount = data?.entries.filter((e) => e.testFile && recentTestFiles.has(e.testFile)).length ?? 0;

  const completeCount = data?.entries.filter((e) => e.status === "complete").length ?? 0;
  const partialCount = data?.entries.filter((e) => e.status === "partial").length ?? 0;
  const missingCount = data?.entries.filter((e) => e.status === "missing").length ?? 0;

  // Sync coverage gaps to Error Wrap-Up context (unit mode only)
  // Note: ctx excluded from deps to avoid loop (setTestPlanGaps updates context → ctx changes → effect re-runs)
  useEffect(() => {
    if (!ctx || mode !== "unit" || !data?.entries) return;
    const gaps = data.entries
      .filter((e) => e.status !== "complete")
      .map((e) => ({
        sourceFile: e.sourceFile,
        status: e.status,
        linesPct: e.linesPct,
        testFile: e.testFile,
        suggestedTestPath: e.suggestedTestPath,
      }));
    ctx.setTestPlanGaps(gaps);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx intentionally excluded
  }, [mode, data?.entries]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center justify-between gap-6"
        style={{
          padding: "var(--space-6)",
          borderBottom: "1px solid var(--neutral-200)",
          backgroundColor: "var(--neutral-0)",
        }}
      >
        <div className="flex items-center gap-6 flex-wrap">
          <h3 style={{ fontSize: "var(--text-subheading)", fontWeight: 600, color: "var(--neutral-800)", margin: 0 }}>
            Test Plan
          </h3>
          {/* Mode toggle */}
          <div className="flex gap-1" style={{ border: "1px solid var(--neutral-300)", borderRadius: "var(--radius-sm)", padding: 2 }}>
            <button
              onClick={() => setMode("unit")}
              style={{
                padding: "var(--space-1) var(--space-3)",
                borderRadius: 4,
                fontSize: "var(--text-caption)",
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
                backgroundColor: mode === "unit" ? "var(--primary-500)" : "transparent",
                color: mode === "unit" ? "var(--neutral-0)" : "var(--neutral-600)",
              }}
            >
              Unit / Integration
            </button>
            <button
              onClick={() => setMode("e2e")}
              style={{
                padding: "var(--space-1) var(--space-3)",
                borderRadius: 4,
                fontSize: "var(--text-caption)",
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
                backgroundColor: mode === "e2e" ? "var(--primary-500)" : "transparent",
                color: mode === "e2e" ? "var(--neutral-0)" : "var(--neutral-600)",
              }}
            >
              E2E
            </button>
          </div>
          {mode === "unit" && data?.total && (
            <div className="flex items-center gap-6" style={{ fontSize: "var(--text-caption)", color: "var(--neutral-600)" }}>
              <span>Lines: <strong>{data.total.lines.toFixed(1)}%</strong></span>
              <span>Functions: <strong>{data.total.functions.toFixed(1)}%</strong></span>
              <span>Branches: <strong>{data.total.branches.toFixed(1)}%</strong></span>
            </div>
          )}
          {mode === "e2e" && e2eData?.flows && (
            <div className="flex items-center gap-6" style={{ fontSize: "var(--text-caption)", color: "var(--neutral-600)" }}>
              <span>Total tests: <strong>{e2eData.totalTests}</strong></span>
              <span>Flows covered: <strong>{e2eData.flows.filter((f) => f.covered).length}/{e2eData.flows.length}</strong></span>
            </div>
          )}
          <button
            onClick={fetchPlan}
            disabled={loading}
            className="flex items-center gap-2"
            style={{
              padding: "0 var(--space-4)",
              height: 36,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--neutral-300)",
              backgroundColor: "var(--neutral-0)",
              color: "var(--neutral-700)",
              fontSize: "var(--text-caption)",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* Status badges — only for unit mode */}
        {mode === "unit" && (
        <div className="flex items-center gap-3 flex-wrap">
          {newCount > 0 && (
            <button
              onClick={() => setNewFilter((v) => !v)}
              className="flex items-center gap-2"
              style={{
                padding: "var(--space-2) var(--space-4)",
                borderRadius: "var(--radius-sm)",
                border: `1px solid ${newFilter ? "var(--primary-500)" : "var(--neutral-300)"}`,
                backgroundColor: newFilter ? "var(--primary-50)" : "transparent",
                color: newFilter ? "var(--primary-700)" : "var(--neutral-600)",
                fontSize: "var(--text-caption)",
                fontWeight: 500,
                cursor: "pointer",
              }}
              title="Tests added/changed since last Mark as seen (in Test Runner)"
            >
              <Sparkles size={16} />
              New ({newCount})
            </button>
          )}
          {(["complete", "partial", "missing"] as const).map((s) => {
            const cfg = STATUS_CONFIG[s];
            const count = s === "complete" ? completeCount : s === "partial" ? partialCount : missingCount;
            const isActive = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(isActive ? "all" : s)}
                className="flex items-center gap-2"
                style={{
                  padding: "var(--space-2) var(--space-4)",
                  borderRadius: "var(--radius-sm)",
                  border: `1px solid ${isActive ? cfg.color : "var(--neutral-300)"}`,
                  backgroundColor: isActive ? cfg.bg : "transparent",
                  color: isActive ? cfg.color : "var(--neutral-600)",
                  fontSize: "var(--text-caption)",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                <cfg.icon size={16} />
                {cfg.label} ({count})
              </button>
            );
          })}
        </div>
        )}
      </div>

      {/* ── Filters — only for unit mode ────────────────────────────────────── */}
      {mode === "unit" && (
      <div
        className="flex items-center gap-4 flex-wrap"
        style={{
          padding: "var(--space-4) var(--space-6)",
          borderBottom: "1px solid var(--neutral-100)",
          backgroundColor: "var(--neutral-50)",
        }}
      >
        <Filter size={16} style={{ color: "var(--neutral-500)", flexShrink: 0 }} />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{
            padding: "var(--space-2) var(--space-4)",
            border: "1px solid var(--neutral-300)",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--text-caption)",
            backgroundColor: "var(--neutral-0)",
            minWidth: 160,
          }}
        >
          <option value="all">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search files…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: 220,
            padding: "var(--space-2) var(--space-4)",
            border: "1px solid var(--neutral-300)",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--text-caption)",
            outline: "none",
          }}
        />
      </div>
      )}

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto" style={{ padding: "var(--space-6)" }}>
        {loading ? (
          <div style={{ padding: "var(--space-8)", color: "var(--neutral-500)", fontSize: "var(--text-body)", textAlign: "center" }}>
            Loading test plan…
          </div>
        ) : error ? (
          <div
            style={{
              padding: "var(--space-6)",
              backgroundColor: "var(--error-50)",
              border: "1px solid var(--error-200)",
              borderRadius: "var(--radius-sm)",
              color: "var(--error-700)",
              fontSize: "var(--text-body)",
            }}
          >
            <strong>Error loading test plan</strong>
            <p style={{ margin: "8px 0 0", fontSize: "var(--text-caption)" }}>{error}</p>
            <p style={{ margin: "8px 0 0", fontSize: "var(--text-caption)", opacity: 0.8 }}>
              {mode === "unit" ? (data?.hint ?? "Run: npm run test:coverage") : (e2eData?.hint ?? "Add e2e/*.spec.ts files")}
            </p>
          </div>
        ) : mode === "e2e" && e2eData?.flows ? (
          <E2ePlanView data={e2eData} recentTestFiles={recentTestFiles} />
        ) : mode === "e2e" ? (
          <div style={{ padding: "var(--space-8)", color: "var(--neutral-500)", fontSize: "var(--text-body)", textAlign: "center" }}>
            No E2E data available. Add e2e/*.spec.ts files and refresh.
          </div>
        ) : (
          <div style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-caption)" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--neutral-200)", textAlign: "left" }}>
                  <th style={{ padding: "var(--space-2) var(--space-4)", fontWeight: 600, color: "var(--neutral-700)" }}>Status</th>
                  <th style={{ padding: "var(--space-2) var(--space-4)", fontWeight: 600, color: "var(--neutral-700)" }}>Source File</th>
                  <th style={{ padding: "var(--space-2) var(--space-4)", fontWeight: 600, color: "var(--neutral-700)" }}>Category</th>
                  <th style={{ padding: "var(--space-2) var(--space-4)", fontWeight: 600, color: "var(--neutral-700)" }}>Lines</th>
                  <th style={{ padding: "var(--space-2) var(--space-4)", fontWeight: 600, color: "var(--neutral-700)" }}>Functions</th>
                  <th style={{ padding: "var(--space-2) var(--space-4)", fontWeight: 600, color: "var(--neutral-700)" }}>Branches</th>
                  <th style={{ padding: "var(--space-2) var(--space-4)", fontWeight: 600, color: "var(--neutral-700)" }}>Test File</th>
                  <th style={{ padding: "var(--space-2) var(--space-4)", fontWeight: 600, color: "var(--neutral-700)" }}>Suggested</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => {
                  const cfg = STATUS_CONFIG[entry.status];
                  return (
                    <tr
                      key={entry.sourceFile}
                      style={{
                        borderBottom: "1px solid var(--neutral-100)",
                        backgroundColor: entry.status === "missing" ? "var(--error-50)" : entry.status === "partial" ? "var(--warning-50)" : undefined,
                      }}
                    >
                      <td style={{ padding: "var(--space-2) var(--space-4)", verticalAlign: "middle" }}>
                        <span
                          className="flex items-center gap-2"
                          style={{
                            color: cfg.color,
                            fontWeight: 500,
                            fontSize: "var(--text-caption)",
                          }}
                        >
                          <cfg.icon size={16} />
                          {cfg.label}
                        </span>
                      </td>
                      <td style={{ padding: "var(--space-2) var(--space-4)", fontFamily: "ui-monospace, monospace", fontSize: "var(--text-caption)" }}>
                        <span className="flex items-center gap-2">
                          {entry.testFile && recentTestFiles.has(entry.testFile) && (
                            <span title="New since last run">
                              <Sparkles size={12} style={{ color: "var(--primary-500)", flexShrink: 0 }} />
                            </span>
                          )}
                          {entry.sourceFile}
                        </span>
                      </td>
                      <td style={{ padding: "var(--space-2) var(--space-4)", color: "var(--neutral-600)" }}>
                        {CATEGORY_LABELS[entry.category] ?? entry.category}
                      </td>
                      <td style={{ padding: "var(--space-2) var(--space-4)" }}>
                        <span style={{ color: entry.linesPct >= 100 ? "var(--success-600)" : entry.linesPct > 0 ? "var(--warning-600)" : "var(--error-600)", fontWeight: 600 }}>
                          {entry.linesPct.toFixed(0)}%
                        </span>
                      </td>
                      <td style={{ padding: "var(--space-2) var(--space-4)", color: "var(--neutral-600)" }}>
                        {entry.functionsPct.toFixed(0)}%
                      </td>
                      <td style={{ padding: "var(--space-2) var(--space-4)", color: "var(--neutral-600)" }}>
                        {entry.branchesPct.toFixed(0)}%
                      </td>
                      <td style={{ padding: "var(--space-2) var(--space-4)" }}>
                        {entry.hasTest ? (
                          <span style={{ color: "var(--success-600)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                            <CheckCircle2 size={16} />
                            {entry.testFile}
                          </span>
                        ) : (
                          <span style={{ color: "var(--neutral-400)" }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: "var(--space-2) var(--space-4)", fontFamily: "ui-monospace, monospace", fontSize: "var(--text-caption)", color: "var(--neutral-600)" }}>
                        {!entry.hasTest ? (
                          <span style={{ color: "var(--primary-600)" }}>{entry.suggestedTestPath}</span>
                        ) : (
                          <span style={{ color: "var(--neutral-400)" }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredEntries.length === 0 && (
              <div style={{ padding: "var(--space-8)", color: "var(--neutral-500)", textAlign: "center" }}>
                No entries match the current filters.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function E2ePlanView({ data, recentTestFiles }: { data: E2ePlanResponse; recentTestFiles: Set<string> }) {
  const flows = data?.flows ?? [];
  const coveredCount = flows.filter((f) => f.covered).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      {/* User flows audit */}
      <div>
        <h4 style={{ fontSize: "var(--text-body)", fontWeight: 600, color: "var(--neutral-800)", marginBottom: "var(--space-2)" }}>
          User Flow Coverage ({coveredCount}/{flows.length})
        </h4>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
          {flows.map((f) => (
            <span
              key={f.id}
              className="flex items-center gap-1"
              style={{
                padding: "var(--space-1) var(--space-3)",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-caption)",
                backgroundColor: f.covered ? "var(--success-50)" : "var(--neutral-100)",
                color: f.covered ? "var(--success-700)" : "var(--neutral-600)",
                border: `1px solid ${f.covered ? "var(--success-200)" : "var(--neutral-200)"}`,
              }}
            >
              {f.covered && <CheckCircle2 size={12} />}
              {f.label}
            </span>
          ))}
        </div>
      </div>

      {/* Spec files */}
      <div>
        <h4 style={{ fontSize: "var(--text-body)", fontWeight: 600, color: "var(--neutral-800)", marginBottom: "var(--space-2)" }}>
          E2E Spec Files ({data.entries.length})
        </h4>
        {data.entries.length === 0 ? (
          <p style={{ color: "var(--neutral-500)", fontSize: "var(--text-caption)" }}>
            No e2e/*.spec.ts files found. Add Playwright specs to e2e/.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {data.entries.map((entry) => (
              <div
                key={entry.file}
                style={{
                  padding: "var(--space-4)",
                  border: "1px solid var(--neutral-200)",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: recentTestFiles.has(entry.file) ? "var(--primary-50)" : "var(--neutral-0)",
                }}
              >
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "var(--text-caption)", fontWeight: 600, color: "var(--neutral-800)", marginBottom: "var(--space-2)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  {recentTestFiles.has(entry.file) && (
                    <span title="New since last run">
                      <Sparkles size={14} style={{ color: "var(--primary-500)", flexShrink: 0 }} />
                    </span>
                  )}
                  {entry.file} ({entry.totalTests} tests)
                </div>
                {entry.blocks.map((block, i) => (
                  <div key={i} style={{ marginTop: "var(--space-2)", paddingLeft: "var(--space-4)" }}>
                    <div style={{ fontSize: "var(--text-caption)", color: "var(--neutral-600)", marginBottom: 4 }}>{block.describe}</div>
                    <ul style={{ margin: 0, paddingLeft: "var(--space-4)", fontSize: "var(--text-caption)", color: "var(--neutral-700)" }}>
                      {block.tests.map((t, j) => (
                        <li key={j}>{t}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <p style={{ fontSize: "var(--text-caption)", color: "var(--neutral-500)" }}>
        Run: <code style={{ padding: "2px 6px", backgroundColor: "var(--neutral-100)", borderRadius: 4 }}>npm run test:e2e</code>
        {". "}Use <code style={{ padding: "2px 6px", backgroundColor: "var(--neutral-100)", borderRadius: 4 }}>BASE_URL</code> for deployed environments.
      </p>
    </div>
  );
}
