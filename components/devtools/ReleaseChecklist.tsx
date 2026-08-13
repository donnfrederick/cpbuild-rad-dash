"use client";

/**
 * ReleaseChecklist — DevTools tab
 *
 * Surfaces everything deployed to the current environment since the admin's
 * last visit. Each release shows its change bullets with:
 *   - "Go Verify" button  → navigates to the relevant route
 *   - Checkbox            → marks the release verified (persisted to DB)
 *
 * Sandbox Mode toggle intercepts all API calls with MSW so the admin can
 * interact with the real UI without saving anything to the database.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CheckSquare,
  Square,
  ExternalLink,
  RefreshCw,
  Download,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Clock,
  Tag,
  GitBranch,
  Sparkles,
  X,
  Link2,
  RotateCcw,
  ClipboardCheck,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface ReleaseChange {
  id: string;
  description: string;
  route: string;
  category: string;
}

/** A Gemini-generated QA step for admin verification before ship. */
interface VerificationStep {
  id: string;
  changeId: string;
  title: string;
  instructions: string;
  route: string;
  category: string;
}

interface ReleaseEntry {
  id: string;
  title: string;
  prNumber: number | null;
  branch: string | null;
  environment: string;
  mergedAt: string;
  changes: ReleaseChange[];
  /** Gemini-generated QA checklist — populated by POST /api/automation/release-verification */
  verificationSteps: VerificationStep[];
  verified: boolean;
  verifiedAt: string | null;
  isNew: boolean;
}

interface ReleasesResponse {
  releases: ReleaseEntry[];
  lastVisitedAt: string | null;
}

interface ImportResult {
  imported: number;
  skipped: number;
  total: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function categoryColor(category: string): string {
  switch (category) {
    case "bug-fix":   return "#dc2626";
    case "feature":   return "#7C3AED";
    case "database":  return "#0369a1";
    case "api":       return "#0891b2";
    case "testing":   return "#d97706";
    case "docs":      return "#6b7280";
    case "devtools":  return "#7C3AED";
    case "ui":        return "#16a34a";
    default:          return "#6b7280";
  }
}

// ── Sub-components ───────────────────────────────────────────────────────────

function CategoryPill({ category }: { category: string }) {
  const label = category.replace(/-/g, " ");
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "1px 6px",
        borderRadius: 999,
        backgroundColor: `${categoryColor(category)}18`,
        color: categoryColor(category),
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        border: `1px solid ${categoryColor(category)}40`,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

interface ChangeItemProps {
  change: ReleaseChange;
  onNavigate: (route: string) => void;
}

function ChangeItem({ change, onNavigate }: ChangeItemProps) {
  return (
    <li
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "4px 0",
      }}
    >
      <span style={{ color: "#7C3AED", marginTop: 2, flexShrink: 0 }}>•</span>
      <span
        style={{
          flex: 1,
          fontSize: "var(--text-body)",
          color: "var(--neutral-900)",
          lineHeight: 1.4,
        }}
      >
        {change.description}
      </span>
      <CategoryPill category={change.category} />
      {change.route && (
        <button
          onClick={() => onNavigate(change.route)}
          title={`Go to ${change.route}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            padding: "2px 6px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--neutral-300)",
            backgroundColor: "var(--neutral-0)",
            color: "var(--neutral-700)",
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "#7C3AED";
            e.currentTarget.style.color = "#fff";
            e.currentTarget.style.borderColor = "#7C3AED";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "var(--neutral-0)";
            e.currentTarget.style.color = "var(--neutral-700)";
            e.currentTarget.style.borderColor = "var(--neutral-300)";
          }}
        >
          <ExternalLink size={10} />
          Go verify
        </button>
      )}
    </li>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ReleaseChecklistProps {
  appEnv?: string;
  /** Called when the user clicks "Go Verify" to close the DevTools panel */
  onClose?: () => void;
  /** Whether sandbox mode is currently active */
  sandboxMode: boolean;
  /** Toggle sandbox mode on/off (parent manages state; this component starts/stops the MSW worker) */
  onSandboxToggle: (active: boolean) => void;
}

export function ReleaseChecklist({
  appEnv,
  onClose,
  sandboxMode,
  onSandboxToggle,
}: ReleaseChecklistProps) {
  const router = useRouter();

  // Derive environment key from appEnv prop (matches what DevToolsPanelWrapper passes)
  const environment = appEnv ?? "development";

  // ── Sandbox MSW worker lifecycle ────────────────────────────────────────
  const handleSandboxToggle = useCallback(
    async (active: boolean) => {
      try {
        if (active) {
          const { startSandbox } = await import("@/lib/msw/browser");
          await startSandbox();
        } else {
          const { stopSandbox } = await import("@/lib/msw/browser");
          await stopSandbox();
        }
        onSandboxToggle(active);
      } catch (e) {
        console.error("[ReleaseChecklist] sandbox toggle failed:", e);
        // Still update UI state so the banner reflects the attempt
        onSandboxToggle(active);
      }
    },
    [onSandboxToggle]
  );

  const [data, setData] = useState<ReleasesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<Set<string>>(new Set());
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // ── Fetch releases ──────────────────────────────────────────────────────

  const fetchReleases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/devtools/releases?environment=${encodeURIComponent(environment)}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const json: ReleasesResponse = await res.json();
      setData(json);

      // Auto-expand "new" releases on first load
      const newIds = new Set(json.releases.filter((r) => r.isNew && !r.verified).map((r) => r.id));
      setExpandedIds(newIds);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load releases");
    } finally {
      setLoading(false);
    }
  }, [environment]);

  useEffect(() => {
    fetchReleases();
  }, [fetchReleases]);

  // ── Verify / un-verify ─────────────────────────────────────────────────

  const toggleVerify = useCallback(
    async (release: ReleaseEntry) => {
      setVerifying((prev) => new Set(prev).add(release.id));
      try {
        if (release.verified) {
          await fetch(
            `/api/devtools/releases/${release.id}/verify?environment=${encodeURIComponent(environment)}`,
            { method: "DELETE" }
          );
        } else {
          await fetch(`/api/devtools/releases/${release.id}/verify`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ environment }),
          });
        }
        // Optimistic update
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            releases: prev.releases.map((r) =>
              r.id === release.id
                ? { ...r, verified: !r.verified, verifiedAt: r.verified ? null : new Date().toISOString() }
                : r
            ),
          };
        });
      } catch {
        // Silently revert on failure — user can retry
      } finally {
        setVerifying((prev) => {
          const next = new Set(prev);
          next.delete(release.id);
          return next;
        });
      }
    },
    [environment]
  );

  // ── Mark all verified ──────────────────────────────────────────────────

  const markAllVerified = useCallback(async () => {
    if (!data) return;
    const unverified = data.releases.filter((r) => !r.verified);
    await Promise.all(
      unverified.map((r) =>
        fetch(`/api/devtools/releases/${r.id}/verify`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ environment }),
        })
      )
    );
    // Update last visit timestamp
    await fetch("/api/devtools/environment-visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environment }),
    });
    await fetchReleases();
  }, [data, environment, fetchReleases]);

  // ── Sync from GitHub API ───────────────────────────────────────────────

  const syncChangelog = useCallback(async () => {
    setImportLoading(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/devtools/releases/sync-github", { method: "POST" });
      const json: ImportResult = await res.json();
      setImportResult(json);
      if (json.imported > 0) await fetchReleases();
    } catch {
      setImportResult({ imported: 0, skipped: 0, total: -1 });
    } finally {
      setImportLoading(false);
    }
  }, [fetchReleases]);

  // ── Navigate ───────────────────────────────────────────────────────────

  const handleNavigate = useCallback(
    (route: string) => {
      onClose?.();
      router.push(route);
    },
    [router, onClose]
  );

  // ── Toggle expand ──────────────────────────────────────────────────────

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Optimistic steps update ─────────────────────────────────────────────

  const handleStepsUpdated = useCallback((releaseId: string, steps: VerificationStep[]) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        releases: prev.releases.map((r) =>
          r.id === releaseId ? { ...r, verificationSteps: steps } : r
        ),
      };
    });
  }, []);

  // ── Derived state ──────────────────────────────────────────────────────

  const newReleases = data?.releases.filter((r) => r.isNew) ?? [];
  const historicalReleases = data?.releases.filter((r) => !r.isNew) ?? [];
  const unverifiedCount = newReleases.filter((r) => !r.verified).length;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        backgroundColor: "var(--neutral-0)",
      }}
    >
      {/* ── Toolbar ── */}
      <div
        style={{
          flexShrink: 0,
          padding: "var(--space-4) var(--space-6)",
          borderBottom: "1px solid var(--neutral-200)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        {/* Row 1: title + sandbox toggle */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h3
              style={{
                fontSize: "var(--text-subheading)",
                fontWeight: "var(--font-weight-semibold)",
                color: "var(--neutral-900)",
                margin: 0,
              }}
            >
              Release Checklist
            </h3>
            {data?.lastVisitedAt && (
              <p style={{ fontSize: "var(--text-caption)", color: "var(--neutral-500)", margin: "2px 0 0" }}>
                <Clock size={10} style={{ display: "inline", marginRight: 3, verticalAlign: "middle" }} />
                Last visit: {formatDate(data.lastVisitedAt)}
              </p>
            )}
            {!data?.lastVisitedAt && !loading && (
              <p style={{ fontSize: "var(--text-caption)", color: "var(--neutral-500)", margin: "2px 0 0" }}>
                First visit — showing all releases
              </p>
            )}
          </div>

          {/* Sandbox Mode toggle */}
          <button
            onClick={() => handleSandboxToggle(!sandboxMode)}
            title={sandboxMode ? "Disable sandbox mode" : "Enable sandbox mode — API calls will be mocked"}
            aria-pressed={sandboxMode}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 10px",
              borderRadius: "var(--radius-sm)",
              border: sandboxMode ? "1.5px solid #d97706" : "1px solid var(--neutral-300)",
              backgroundColor: sandboxMode ? "#fef3c7" : "var(--neutral-0)",
              color: sandboxMode ? "#92400e" : "var(--neutral-600)",
              fontSize: "var(--text-caption)",
              fontWeight: sandboxMode ? 600 : 400,
              cursor: "pointer",
            }}
          >
            <FlaskConical size={13} />
            {sandboxMode ? "Sandbox ON" : "Sandbox"}
          </button>
        </div>

        {/* Row 2: action buttons */}
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <button
            onClick={fetchReleases}
            disabled={loading}
            style={toolbarBtnStyle}
            title="Refresh release list"
          >
            <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : undefined }} />
            Refresh
          </button>

          <button
            onClick={syncChangelog}
            disabled={importLoading}
            style={toolbarBtnStyle}
            title="Fetch all merged PRs from GitHub and import as releases"
          >
            <Download size={12} />
            {importLoading ? "Syncing..." : "Sync from GitHub"}
          </button>

          {unverifiedCount > 0 && (
            <button
              onClick={markAllVerified}
              style={{ ...toolbarBtnStyle, backgroundColor: "#7C3AED", color: "#fff", border: "none" }}
              title="Mark all new releases as verified and update last-visit timestamp"
            >
              <CheckCheck size={12} />
              Mark all verified ({unverifiedCount})
            </button>
          )}
        </div>

        {/* Import result banner */}
        {importResult && importResult.total >= 0 && (
          <div
            style={{
              fontSize: "var(--text-caption)",
              padding: "4px 8px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: importResult.imported > 0 ? "#f0fdf4" : "#f9fafb",
              color: importResult.imported > 0 ? "#15803d" : "var(--neutral-600)",
              border: `1px solid ${importResult.imported > 0 ? "#bbf7d0" : "var(--neutral-200)"}`,
            }}
          >
            {importResult.imported > 0
              ? `Imported ${importResult.imported} release${importResult.imported === 1 ? "" : "s"} — ${importResult.skipped} already existed`
              : `No new releases — all ${importResult.skipped} already imported`}
          </div>
        )}
        {importResult && importResult.total === -1 && (
          <div
            style={{
              fontSize: "var(--text-caption)",
              padding: "4px 8px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "#fef2f2",
              color: "#dc2626",
              border: "1px solid #fecaca",
            }}
          >
            Sync failed — check that CHANGELOG.md exists at the repo root
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-4) var(--space-6)" }}>
        {loading && (
          <div style={{ padding: "var(--space-8)", textAlign: "center", color: "var(--neutral-400)" }}>
            Loading releases...
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "var(--space-4)",
              backgroundColor: "#fef2f2",
              borderRadius: "var(--radius-sm)",
              color: "#dc2626",
              fontSize: "var(--text-body)",
            }}
          >
            Error: {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            {/* New releases section */}
            {newReleases.length > 0 && (
              <section style={{ marginBottom: "var(--space-6)" }}>
                <h4
                  style={{
                    fontSize: "var(--text-caption)",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--neutral-500)",
                    margin: "0 0 var(--space-3)",
                  }}
                >
                  New since your last visit ({newReleases.length})
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  {newReleases.map((release) => (
                    <ReleaseCard
                      key={release.id}
                      release={release}
                      expanded={expandedIds.has(release.id)}
                      verifying={verifying.has(release.id)}
                      onToggleExpand={() => toggleExpand(release.id)}
                      onToggleVerify={() => toggleVerify(release)}
                      onNavigate={handleNavigate}
                      onStepsUpdated={(steps) => handleStepsUpdated(release.id, steps)}
                      isNew
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Historical releases section */}
            {historicalReleases.length > 0 && (
              <section>
                <h4
                  style={{
                    fontSize: "var(--text-caption)",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--neutral-400)",
                    margin: "0 0 var(--space-3)",
                  }}
                >
                  Previously seen ({historicalReleases.length})
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  {historicalReleases.map((release) => (
                    <ReleaseCard
                      key={release.id}
                      release={release}
                      expanded={expandedIds.has(release.id)}
                      verifying={verifying.has(release.id)}
                      onToggleExpand={() => toggleExpand(release.id)}
                      onToggleVerify={() => toggleVerify(release)}
                      onNavigate={handleNavigate}
                      onStepsUpdated={(steps) => handleStepsUpdated(release.id, steps)}
                      isNew={false}
                    />
                  ))}
                </div>
              </section>
            )}

            {data.releases.length === 0 && (
              <div
                style={{
                  padding: "var(--space-8)",
                  textAlign: "center",
                  color: "var(--neutral-400)",
                  fontSize: "var(--text-body)",
                }}
              >
                No releases yet. Click &ldquo;Sync from GitHub&rdquo; to import all merged PRs,
                or add releases manually via the API.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Verification localStorage helpers ─────────────────────────────────────────

function verifyKey(releaseId: string, stepId: string) {
  return `verification-${releaseId}-${stepId}`;
}
function dismissKey(releaseId: string, stepId: string) {
  return `verification-${releaseId}-${stepId}-dismissed`;
}

function getChecked(releaseId: string, stepId: string): boolean {
  try { return localStorage.getItem(verifyKey(releaseId, stepId)) === "1"; } catch { return false; }
}
function setChecked(releaseId: string, stepId: string, val: boolean) {
  try {
    if (val) localStorage.setItem(verifyKey(releaseId, stepId), "1");
    else localStorage.removeItem(verifyKey(releaseId, stepId));
  } catch { /* noop */ }
}
function getDismissed(releaseId: string, stepId: string): boolean {
  try { return localStorage.getItem(dismissKey(releaseId, stepId)) === "1"; } catch { return false; }
}
function setDismissed(releaseId: string, stepId: string, val: boolean) {
  try {
    if (val) localStorage.setItem(dismissKey(releaseId, stepId), "1");
    else localStorage.removeItem(dismissKey(releaseId, stepId));
  } catch { /* noop */ }
}

// ── VerificationPanel ──────────────────────────────────────────────────────────

interface VerificationPanelProps {
  release: ReleaseEntry;
  onNavigate: (route: string) => void;
  onStepsUpdated: (steps: VerificationStep[]) => void;
}

export function VerificationPanel({ release, onNavigate, onStepsUpdated }: VerificationPanelProps) {
  const [steps, setSteps] = useState<VerificationStep[]>(release.verificationSteps ?? []);

  // Sync steps when parent provides a fresh verificationSteps value (e.g. after refetch)
  useEffect(() => {
    setSteps(release.verificationSteps ?? []);
   
  }, [release.id, release.verificationSteps]);
  // checked/dismissed stored in localStorage; use state to force re-renders
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [dismissed, setDismissedState] = useState<Record<string, boolean>>({});
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [showDismissed, setShowDismissed] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Copy link");

  // Load checked/dismissed from localStorage whenever the step set changes (by IDs, not just length)
  const stepKey = steps.map((s) => s.id).join(",");
  useEffect(() => {
    const c: Record<string, boolean> = {};
    const d: Record<string, boolean> = {};
    steps.forEach((s) => {
      c[s.id] = getChecked(release.id, s.id);
      d[s.id] = getDismissed(release.id, s.id);
    });
    setChecks(c);
    setDismissedState(d);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, release.id]);

  const toggleCheck = (stepId: string) => {
    const next = !checks[stepId];
    setChecked(release.id, stepId, next);
    setChecks((prev) => ({ ...prev, [stepId]: next }));
  };

  const toggleDismiss = (stepId: string) => {
    const next = !dismissed[stepId];
    setDismissed(release.id, stepId, next);
    setDismissedState((prev) => ({ ...prev, [stepId]: next }));
  };

  const generate = async (withFeedback?: string) => {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/automation/release-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseId: release.id, ...(withFeedback ? { feedback: withFeedback } : {}) }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? `${res.status}`);
      }
      const json = await res.json() as { steps: VerificationStep[] };
      setSteps(json.steps);
      onStepsUpdated(json.steps);
      setFeedback("");
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const copyShareLink = async () => {
    try {
      const res = await fetch(`/api/releases/share-link?releaseId=${release.id}`);
      if (!res.ok) throw new Error("No tour exists for this release — generate one in the Tour Builder first");
      const { url } = await res.json() as { url: string };
      await navigator.clipboard.writeText(url);
      setCopyLabel("Copied!");
      setTimeout(() => setCopyLabel("Copy link"), 2000);
    } catch (e) {
      setCopyLabel(e instanceof Error ? e.message.slice(0, 30) : "Error");
      setTimeout(() => setCopyLabel("Copy link"), 3000);
    }
  };

  const visibleSteps = showDismissed ? steps : steps.filter((s) => !dismissed[s.id]);
  const checkedCount = steps.filter((s) => checks[s.id]).length;
  const totalNonDismissed = steps.filter((s) => !dismissed[s.id]).length;

  return (
    <div style={{ borderTop: "1px solid var(--neutral-100)", padding: "var(--space-3) var(--space-4)" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ClipboardCheck size={13} style={{ color: "#7C3AED" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Verification Guide
          </span>
          {steps.length > 0 && (
            <span style={{ fontSize: 11, color: checkedCount === totalNonDismissed && totalNonDismissed > 0 ? "#15803d" : "var(--neutral-500)" }}>
              {checkedCount}/{totalNonDismissed} done
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {/* Copy share link (tour must exist) */}
          <button
            onClick={copyShareLink}
            title="Copy shareable tour link for this release"
            style={{ ...microBtnStyle, gap: 3 }}
          >
            <Link2 size={10} />
            {copyLabel}
          </button>

          {/* Generate / Regenerate */}
          {steps.length === 0 ? (
            <button
              onClick={() => generate()}
              disabled={generating}
              title="Generate AI verification checklist for this release"
              style={{ ...microBtnStyle, backgroundColor: "#7C3AED", color: "#fff", border: "none" }}
            >
              <Sparkles size={10} />
              {generating ? "Generating…" : "Generate steps"}
            </button>
          ) : (
            <button
              onClick={() => generate()}
              disabled={generating}
              title="Regenerate verification steps"
              style={microBtnStyle}
            >
              <RotateCcw size={10} />
              {generating ? "…" : "Regen"}
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {genError && (
        <p style={{ fontSize: 11, color: "#dc2626", margin: "0 0 var(--space-2)" }}>{genError}</p>
      )}

      {/* No steps yet */}
      {steps.length === 0 && !generating && (
        <p style={{ fontSize: 12, color: "var(--neutral-400)", margin: "0 0 var(--space-2)" }}>
          Hit &ldquo;Generate steps&rdquo; and Gemini will create a tailored QA checklist from this release&rsquo;s changes.
        </p>
      )}

      {/* Step list */}
      {visibleSteps.length > 0 && (
        <ul style={{ margin: "0 0 var(--space-2)", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {visibleSteps.map((step) => {
            const isChecked = !!checks[step.id];
            const isDismissed = !!dismissed[step.id];
            return (
              <li
                key={step.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: isChecked ? "#f0fdf4" : isDismissed ? "var(--neutral-50)" : "var(--neutral-0)",
                  border: `1px solid ${isChecked ? "#bbf7d0" : isDismissed ? "var(--neutral-200)" : "var(--neutral-200)"}`,
                  opacity: isDismissed ? 0.5 : 1,
                }}
              >
                {/* Checkbox */}
                <button
                  onClick={() => toggleCheck(step.id)}
                  aria-label={isChecked ? "Mark as not done" : "Mark as done"}
                  title={isChecked ? "Mark as not done" : "Mark as done"}
                  style={{
                    background: "none", border: "none", padding: 0, cursor: "pointer",
                    color: isChecked ? "#16a34a" : "var(--neutral-400)", flexShrink: 0, marginTop: 1,
                  }}
                >
                  {isChecked ? <CheckSquare size={14} /> : <Square size={14} />}
                </button>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 12, fontWeight: 600,
                      color: isChecked ? "#15803d" : "var(--neutral-800)",
                      textDecoration: isChecked ? "line-through" : "none",
                    }}>
                      {step.title}
                    </span>
                    <CategoryPill category={step.category} />
                  </div>
                  <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--neutral-600)", lineHeight: 1.5 }}>
                    {step.instructions}
                  </p>
                </div>

                {/* Route link + dismiss */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                  {step.route && (
                    <button
                      onClick={() => onNavigate(step.route)}
                      title={`Go to ${step.route}`}
                      style={{ ...microBtnStyle, fontSize: 10 }}
                    >
                      <ExternalLink size={9} />
                      Go
                    </button>
                  )}
                  <button
                    onClick={() => toggleDismiss(step.id)}
                    aria-label={isDismissed ? "Restore step" : "Dismiss — not relevant"}
                    aria-pressed={isDismissed}
                    title={isDismissed ? "Restore step" : "Dismiss — not relevant"}
                    style={{ background: "none", border: "none", padding: 2, cursor: "pointer", color: "var(--neutral-300)" }}
                  >
                    <X size={10} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Show dismissed toggle */}
      {steps.some((s) => dismissed[s.id]) && (
        <button
          onClick={() => setShowDismissed((v) => !v)}
          style={{ fontSize: 11, color: "var(--neutral-400)", background: "none", border: "none", padding: 0, cursor: "pointer", marginBottom: "var(--space-2)" }}
        >
          {showDismissed ? "Hide dismissed" : `Show ${steps.filter((s) => dismissed[s.id]).length} dismissed`}
        </button>
      )}

      {/* Adjust with AI */}
      {steps.length > 0 && (
        <div style={{ display: "flex", gap: 4, marginTop: "var(--space-1)" }}>
          <input
            type="text"
            placeholder={'Adjust with AI\u2026 e.g. "focus on mobile"'}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && feedback.trim() && generate(feedback.trim())}
            style={{
              flex: 1, fontSize: 11, padding: "4px 8px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--neutral-300)",
              backgroundColor: "var(--neutral-0)",
              color: "var(--neutral-900)",
              outline: "none",
            }}
          />
          <button
            onClick={() => feedback.trim() && generate(feedback.trim())}
            disabled={generating || !feedback.trim()}
            title="Regenerate with this feedback"
            style={{
              ...microBtnStyle,
              backgroundColor: feedback.trim() ? "#7C3AED" : undefined,
              color: feedback.trim() ? "#fff" : undefined,
              border: feedback.trim() ? "none" : undefined,
            }}
          >
            <Sparkles size={10} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── ReleaseCard ───────────────────────────────────────────────────────────────

interface ReleaseCardProps {
  release: ReleaseEntry;
  expanded: boolean;
  verifying: boolean;
  isNew: boolean;
  onToggleExpand: () => void;
  onToggleVerify: () => void;
  onNavigate: (route: string) => void;
  onStepsUpdated: (steps: VerificationStep[]) => void;
}

function ReleaseCard({
  release,
  expanded,
  verifying,
  isNew,
  onToggleExpand,
  onToggleVerify,
  onNavigate,
  onStepsUpdated,
}: ReleaseCardProps) {
  return (
    <div
      style={{
        border: `1px solid ${isNew && !release.verified ? "#c4b5fd" : "var(--neutral-200)"}`,
        borderRadius: "var(--radius-sm)",
        backgroundColor: isNew && !release.verified ? "#faf5ff" : "var(--neutral-0)",
        overflow: "hidden",
      }}
    >
      {/* Card header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "10px var(--space-4)",
          cursor: "pointer",
        }}
        onClick={onToggleExpand}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onToggleExpand()}
        aria-expanded={expanded}
      >
        {/* Expand chevron */}
        <span style={{ color: "var(--neutral-400)", flexShrink: 0 }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>

        {/* Verify checkbox */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleVerify();
          }}
          disabled={verifying}
          title={release.verified ? "Mark as unverified" : "Mark as verified"}
          aria-label={release.verified ? "Unverify release" : "Verify release"}
          style={{
            flexShrink: 0,
            background: "none",
            border: "none",
            padding: 0,
            cursor: verifying ? "wait" : "pointer",
            color: release.verified ? "#16a34a" : "var(--neutral-400)",
            display: "flex",
            alignItems: "center",
          }}
        >
          {release.verified ? <CheckSquare size={16} /> : <Square size={16} />}
        </button>

        {/* Title + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: "var(--text-body)",
              fontWeight: "var(--font-weight-semibold)",
              color: release.verified ? "var(--neutral-500)" : "var(--neutral-900)",
              textDecoration: release.verified ? "line-through" : "none",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {release.title}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--neutral-400)", display: "flex", alignItems: "center", gap: 2 }}>
              <Clock size={10} />
              {formatDate(release.mergedAt)}
            </span>
            {release.branch && (
              <span style={{ fontSize: 11, color: "var(--neutral-400)", display: "flex", alignItems: "center", gap: 2 }}>
                <GitBranch size={10} />
                {release.branch}
              </span>
            )}
            {release.changes.length > 0 && (
              <span style={{ fontSize: 11, color: "var(--neutral-400)" }}>
                {release.changes.length} change{release.changes.length === 1 ? "" : "s"}
              </span>
            )}
            {release.environment !== "all" && (
              <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
                <Tag size={10} style={{ color: "var(--neutral-400)" }} />
                <CategoryPill category={release.environment} />
              </span>
            )}
          </div>
        </div>

        {/* Verified badge */}
        {release.verified && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 6px",
              borderRadius: 999,
              backgroundColor: "#f0fdf4",
              color: "#15803d",
              border: "1px solid #bbf7d0",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            Verified
          </span>
        )}
      </div>

      {/* Expanded change list */}
      {expanded && release.changes.length > 0 && (
        <div
          style={{
            padding: "0 var(--space-4) var(--space-3)",
            borderTop: "1px solid var(--neutral-100)",
          }}
        >
          <ul style={{ margin: "var(--space-2) 0 0", padding: 0, listStyle: "none" }}>
            {release.changes.map((change) => (
              <ChangeItem key={change.id} change={change} onNavigate={onNavigate} />
            ))}
          </ul>
        </div>
      )}

      {expanded && release.changes.length === 0 && (
        <div
          style={{
            padding: "var(--space-2) var(--space-4) var(--space-3)",
            borderTop: "1px solid var(--neutral-100)",
            fontSize: "var(--text-caption)",
            color: "var(--neutral-400)",
          }}
        >
          No individual changes listed for this release.
        </div>
      )}

      {/* Verification panel — always shown when expanded */}
      {expanded && (
        <VerificationPanel
          release={release}
          onNavigate={onNavigate}
          onStepsUpdated={onStepsUpdated}
        />
      )}
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const toolbarBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  fontSize: "var(--text-caption)",
  padding: "5px 10px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--neutral-300)",
  backgroundColor: "var(--neutral-0)",
  color: "var(--neutral-700)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const microBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 11,
  padding: "3px 7px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--neutral-300)",
  backgroundColor: "var(--neutral-0)",
  color: "var(--neutral-600)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
