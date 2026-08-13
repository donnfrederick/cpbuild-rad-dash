"use client";

/**
 * DevToolsPanel
 *
 * Right-anchored panel opened via the AppSidebar dropdown "Dev Tools" item.
 * Contains multiple tabs for design tokens, data browsing, server logs,
 * debugger, test runner/plan, release checklist, and error wrap-up.
 *
 * Development tool only — not part of the application UI.
 */

import { useState, useEffect, useCallback, useRef, Component, type ErrorInfo, type ReactNode } from "react";
import { SlidersHorizontal, Palette, X, Table2, Terminal, Bug, ClipboardList, RefreshCw, Sparkles, CheckSquare, FlaskConical, AlertTriangle } from "lucide-react";
import { DesignSystemEditor } from "./DesignSystemEditor";
import { DataVisualizer } from "./DataVisualizer";
import { TestPlanVisualizer } from "./TestPlanVisualizer";
import { ServerLogs } from "./ServerLogs";
import { FrontendDebugger } from "./FrontendDebugger";
import { TestRunner } from "./TestRunner";
import { ErrorWrapUp } from "./ErrorWrapUp";
import { ReleaseChecklist } from "./ReleaseChecklist";
import { DevToolsProvider } from "./DevToolsContext";

// ── Persisted crash storage ───────────────────────────────────────────────────
const CRASH_KEY = "devtools-last-crash";
interface PersistedCrash { message: string; stack: string; tab: string; ts: number }

function saveTabCrash(tabId: string, error: Error) {
  try {
    const entry: PersistedCrash = {
      message: error.message,
      stack: error.stack ?? "",
      tab: tabId,
      ts: Date.now(),
    };
    localStorage.setItem(CRASH_KEY, JSON.stringify(entry));
  } catch { /* localStorage unavailable */ }
}

function loadTabCrash(): PersistedCrash | null {
  try {
    const raw = localStorage.getItem(CRASH_KEY);
    return raw ? (JSON.parse(raw) as PersistedCrash) : null;
  } catch { return null; }
}

function clearTabCrash() {
  try { localStorage.removeItem(CRASH_KEY); } catch { /* ignore */ }
}

// ── Error boundary for individual tab content ─────────────────────────────────
interface TabErrorState { error: Error | null }
class TabErrorBoundary extends Component<{ children: ReactNode; activeTab: string; onReset: () => void; onCrash: (c: PersistedCrash) => void }, TabErrorState> {
  state: TabErrorState = { error: null };
  static getDerivedStateFromError(error: Error): TabErrorState { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    saveTabCrash(this.props.activeTab, error);
    const crash = loadTabCrash();
    if (crash) this.props.onCrash(crash);
    console.error("[DevTools tab crash]", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#dc2626" }}>
            <AlertTriangle size={16} />
            <strong style={{ fontSize: 13 }}>Tab crashed — error saved, reopen DevTools to review</strong>
          </div>
          <pre style={{ margin: 0, padding: "12px 14px", borderRadius: 6, backgroundColor: "#fef2f2", border: "1px solid #fecaca", fontSize: 11, color: "#7f1d1d", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 300, overflowY: "auto", width: "100%", boxSizing: "border-box" }}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => { clearTabCrash(); this.setState({ error: null }); this.props.onReset(); }}
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #dc2626", backgroundColor: "#fff", color: "#dc2626", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            Dismiss &amp; reset tab
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

type Tab = "design-system" | "data" | "test-plan" | "test-runner" | "server-logs" | "debugger" | "error-wrap-up" | "release-checklist";

const ALL_TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "design-system",     label: "Design System",    icon: <Palette size={14} /> },
  { id: "data",              label: "Data",             icon: <Table2 size={14} /> },
  { id: "test-plan",         label: "Test Plan",        icon: <ClipboardList size={14} /> },
  { id: "test-runner",       label: "Test Runner",      icon: <RefreshCw size={14} /> },
  { id: "server-logs",       label: "Server Logs",      icon: <Terminal size={14} /> },
  { id: "debugger",          label: "Debugger",         icon: <Bug size={14} /> },
  { id: "error-wrap-up",     label: "Error Wrap-Up",    icon: <Sparkles size={14} /> },
  { id: "release-checklist", label: "Release Checklist",icon: <CheckSquare size={14} /> },
];

// Tabs that contribute to the error badge
const ERROR_TABS: Tab[] = ["server-logs", "debugger", "test-runner"];

/**
 * Tabs hidden on hosted builds unless DEVTOOLS_ENABLED or NEXT_PUBLIC_APP_ENV is unset.
 * design-system — aesthetic token editor, no persistent effect on deployed builds
 * test-runner   — spawns child_process; blocked in hosted environments
 * test-plan     — reads coverage/ filesystem artifacts that don't exist on hosted builds
 */
const DEPLOYED_HIDDEN_TABS = new Set<Tab>(["design-system", "test-runner", "test-plan"]);

interface DevToolsPanelProps {
  appEnv?: string;
  showLocalDevToolsTabs?: boolean;
}

export function DevToolsPanel({ appEnv, showLocalDevToolsTabs = false }: DevToolsPanelProps) {
  const TABS = showLocalDevToolsTabs
    ? ALL_TABS
    : ALL_TABS.filter((t) => !DEPLOYED_HIDDEN_TABS.has(t.id));
  const defaultTab: Tab = showLocalDevToolsTabs ? "design-system" : "debugger";
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);
  const [savedCrash, setSavedCrash] = useState<PersistedCrash | null>(null);
  useEffect(() => {
    const crash = loadTabCrash();
    if (crash) setSavedCrash(crash);
  }, []);
  const effectiveTab: Tab = TABS.some((t) => t.id === activeTab) ? activeTab : "debugger";

  const [unseenCounts, setUnseenCounts] = useState<Record<Tab, number>>({
    "design-system": 0,
    "data": 0,
    "test-plan": 0,
    "test-runner": 0,
    "server-logs": 0,
    "debugger": 0,
    "error-wrap-up": 0,
    "release-checklist": 0,
  });

  const [sandboxMode, setSandboxMode] = useState(false);

  const handleOpenPanel = useCallback(() => {
    setIsOpen(true);
    setUnseenCounts((prev) => ({ ...prev, [effectiveTab]: 0 }));
  }, [effectiveTab]);

  const handleNewError = useCallback(
    (event: Event) => {
      const { count = 1 } = (event as CustomEvent<{ count: number }>).detail ?? {};
      const fromTab: Tab =
        (event as CustomEvent<{ tab?: Tab }>).detail?.tab ??
        (effectiveTab === "server-logs" ? "debugger" : effectiveTab === "debugger" ? "server-logs" : "debugger");

      const shouldCount = !isOpen || effectiveTab !== fromTab;
      if (shouldCount) {
        setUnseenCounts((prev) => ({
          ...prev,
          [fromTab]: (prev[fromTab] ?? 0) + count,
        }));
      }
    },
    [isOpen, effectiveTab]
  );

  useEffect(() => {
    window.addEventListener("devtools:new-error", handleNewError);
    return () => window.removeEventListener("devtools:new-error", handleNewError);
  }, [handleNewError]);

  useEffect(() => {
    function onOpen() { handleOpenPanel(); }
    window.addEventListener("devtools:open", onOpen);
    return () => window.removeEventListener("devtools:open", onOpen);
  }, [handleOpenPanel]);

  const handleTabSwitch = (tab: Tab) => {
    setActiveTab(tab);
    setUnseenCounts((prev) => ({ ...prev, [tab]: 0 }));
  };

  // ── Panel width — resizable, persisted ────────────────────────────────────
  const PANEL_WIDTH_KEY = "devtools:panel-width";
  const PANEL_MIN = 340;
  const PANEL_MAX = 1400;
  const PANEL_DEFAULT = PANEL_MAX;

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try { return parseInt(localStorage.getItem(PANEL_WIDTH_KEY) ?? String(PANEL_DEFAULT), 10) || PANEL_DEFAULT; }
    catch { return PANEL_DEFAULT; }
  });

  const resizeDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeDragRef.current = { startX: e.clientX, startWidth: panelWidth };

    function onMove(ev: MouseEvent) {
      if (!resizeDragRef.current) return;
      const delta = resizeDragRef.current.startX - ev.clientX;
      const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, resizeDragRef.current.startWidth + delta));
      setPanelWidth(next);
    }
    function onUp() {
      resizeDragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [panelWidth]);

  useEffect(() => {
    if (!resizeDragRef.current) {
      try { localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth)); }
      catch { /* ignore */ }
    }
  }, [panelWidth]);

  const currentTab = TABS.find((t) => t.id === effectiveTab)!;

  return (
    <>
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setIsOpen(false)}
            onWheel={(e) => {
              if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                e.preventDefault();
              }
            }}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              zIndex: 10000,
            }}
            aria-hidden="true"
          />

          {/* Panel */}
          <div
            className="flex flex-col"
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              width: `${panelWidth}px`,
              maxWidth: "100vw",
              height: "100vh",
              backgroundColor: "var(--background)",
              zIndex: 10001,
              boxShadow: "-4px 0 24px rgba(0, 0, 0, 0.18)",
            }}
            role="dialog"
            aria-label="Dev Tools Panel"
            onWheel={(e) => {
              if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                e.preventDefault();
              }
            }}
          >
            {/* ── Resize handle ── */}
            <div
              onMouseDown={onResizeStart}
              title="Drag to resize panel"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: 5,
                height: "100%",
                cursor: "col-resize",
                zIndex: 1,
                backgroundColor: "transparent",
                transition: "background-color 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(124,58,237,0.35)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            />

            {/* ── Panel header ── */}
            <header
              className="flex-shrink-0"
              style={{
                backgroundColor: "#7C3AED",
                color: "#FFFFFF",
                borderBottom: "1px solid rgba(255,255,255,0.15)",
              }}
            >
              {/* Title row */}
              <div
                className="flex items-center justify-between"
                style={{ padding: "0 var(--space-6)", height: "64px" }}
              >
                <div className="flex items-center gap-3">
                  <SlidersHorizontal size={22} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <h2 style={{ fontSize: "var(--text-subheading)", fontWeight: "var(--font-weight-semibold)", lineHeight: 1.2, margin: 0 }}>
                      Dev Tools
                    </h2>
                    <p style={{ fontSize: "var(--text-caption)", opacity: 0.85, lineHeight: 1.3, margin: 0 }}>
                      {currentTab?.label ?? ""} — Dev-only tool
                    </p>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="transition-colors duration-150"
                    style={{
                      width: "var(--button-height)",
                      height: "var(--button-height)",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "rgba(255,255,255,0.15)",
                      color: "#FFFFFF",
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.3)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.15)")}
                    aria-label="Close dev tools"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Tab bar */}
              <div
                role="tablist"
                aria-label="DevTools tabs"
                onWheel={(e) => { e.stopPropagation(); }}
                style={{
                  display: "flex",
                  paddingLeft: "var(--space-6)",
                  gap: "var(--space-2)",
                  overflowX: "auto",
                  scrollbarWidth: "none",
                  overscrollBehaviorX: "contain",
                }}
              >
                {TABS.map((tab) => {
                  const isActive = tab.id === effectiveTab;
                  const tabUnseen = unseenCounts[tab.id] ?? 0;

                  return (
                    <button
                      key={tab.id}
                      id={`devtools-tab-${tab.id}`}
                      onClick={() => handleTabSwitch(tab.id)}
                      className="flex items-center gap-2.5 transition-all duration-150"
                      style={{
                        padding: "var(--space-2) var(--space-6)",
                        borderRadius: "var(--radius-sm) var(--radius-sm) 0 0",
                        backgroundColor: isActive ? "var(--card)" : "rgba(255,255,255,0.1)",
                        color: isActive ? "#7C3AED" : "rgba(255,255,255,0.85)",
                        fontSize: "var(--text-body)",
                        fontWeight: isActive ? "var(--font-weight-semibold)" : "var(--font-weight-medium)",
                        border: "none",
                        cursor: "pointer",
                        borderBottom: isActive ? "2px solid var(--card)" : "2px solid transparent",
                        marginBottom: "-1px",
                        position: "relative",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.2)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)";
                      }}
                      aria-selected={isActive}
                      role="tab"
                    >
                      {tab.icon}
                      {tab.label}

                      {tabUnseen > 0 && (
                        <span
                          style={{
                            minWidth: 16,
                            height: 16,
                            borderRadius: 8,
                            backgroundColor: "#dc2626",
                            color: "#fff",
                            fontSize: 10,
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "0 4px",
                            lineHeight: 1,
                          }}
                        >
                          {tabUnseen > 99 ? "99+" : tabUnseen}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </header>

            {/* ── Sandbox mode banner ── */}
            {sandboxMode && (
              <div
                style={{
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--space-3)",
                  padding: "6px var(--space-6)",
                  backgroundColor: "#fef3c7",
                  borderBottom: "1px solid #fde68a",
                  color: "#92400e",
                  fontSize: "var(--text-caption)",
                  fontWeight: 600,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <FlaskConical size={13} />
                  Sandbox mode active — API calls are mocked. Nothing will be saved.
                </span>
                <button
                  onClick={() => setSandboxMode(false)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#92400e",
                    cursor: "pointer",
                    fontSize: "var(--text-caption)",
                    fontWeight: 600,
                    padding: 0,
                    textDecoration: "underline",
                  }}
                >
                  Disable
                </button>
              </div>
            )}

            {/* ── Crash banner ── */}
            {savedCrash && (
              <div
                style={{
                  flexShrink: 0,
                  padding: "10px 16px",
                  backgroundColor: "#fef2f2",
                  borderBottom: "1px solid #fecaca",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#dc2626" }}>
                    <AlertTriangle size={14} />
                    <strong style={{ fontSize: 12 }}>
                      Last crash ({savedCrash.tab} tab) — {new Date(savedCrash.ts).toLocaleTimeString()}
                    </strong>
                  </div>
                  <button
                    onClick={() => { clearTabCrash(); setSavedCrash(null); }}
                    style={{ fontSize: 11, color: "#dc2626", background: "none", cursor: "pointer", padding: "2px 6px", borderRadius: 4, border: "1px solid #fecaca" }}
                  >
                    Dismiss
                  </button>
                </div>
                <pre
                  style={{ margin: 0, fontSize: 10.5, color: "#7f1d1d", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 120, overflowY: "auto", userSelect: "text", cursor: "text" }}
                >
                  {savedCrash.message}
                  {savedCrash.stack ? `\n\n${savedCrash.stack}` : ""}
                </pre>
              </div>
            )}

            {/* ── Tab content ── */}
            <DevToolsProvider>
              <TabErrorBoundary activeTab={effectiveTab} onReset={() => handleTabSwitch(effectiveTab)} onCrash={setSavedCrash}>
                <div className="flex flex-1 overflow-hidden" role="tabpanel" aria-labelledby={`devtools-tab-${effectiveTab}`}>
                  {effectiveTab === "design-system"     && <DesignSystemEditor />}
                  {effectiveTab === "data"              && <DataVisualizer />}
                  {effectiveTab === "test-plan"         && <TestPlanVisualizer />}
                  {effectiveTab === "test-runner"       && <TestRunner />}
                  {effectiveTab === "server-logs"       && <ServerLogs />}
                  {effectiveTab === "debugger"          && <FrontendDebugger />}
                  {effectiveTab === "error-wrap-up"     && <ErrorWrapUp />}
                  {effectiveTab === "release-checklist" && (
                    <ReleaseChecklist
                      appEnv={appEnv}
                      onClose={() => setIsOpen(false)}
                      sandboxMode={sandboxMode}
                      onSandboxToggle={setSandboxMode}
                    />
                  )}
                </div>
              </TabErrorBoundary>
            </DevToolsProvider>
          </div>
        </>
      )}
    </>
  );
}

// Suppress unused-import lint for ERROR_TABS (used for badge total — keeping for future floating button)
void ERROR_TABS;
