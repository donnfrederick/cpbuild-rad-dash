"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Copy, Link2, Link2Off, Loader2, MinusCircle } from "lucide-react";
import { toast } from "sonner";
import { useAppUser } from "@/contexts/AppUserContext";
import { hasTicketTriageAccess } from "@/lib/ticket-triage";
import { TicketDetailView, TicketStatusBadge, TicketPriorityBadge } from "@/components/tickets/TicketDetailView";
import type { TicketStatus } from "@/components/tickets/ticket-types";

interface TicketSummary {
  id: string;
  ref: string;
  shortId: number;
  title: string;
  status: TicketStatus;
  priority: "LOW" | "MEDIUM" | "HIGH" | null;
}

interface ClusterSuggestion {
  ticket: TicketSummary;
  similarity: number;
}

interface Cluster {
  canonical: TicketSummary;
  suggestions: ClusterSuggestion[];
}

interface LinkedPair {
  id: string;
  canonical: TicketSummary;
  duplicate: TicketSummary;
  similarity: number | null;
  linkedAt: string;
}

interface ProjectDuplicatesResponse {
  projectId: string;
  totals: {
    clusters: number;
    linkedPairs: number;
    pendingPairs: number;
  };
  clusters: Cluster[];
  linked: LinkedPair[];
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={`relative flex flex-col gap-3 rounded-xl border p-5 shadow-sm ${
        accent
          ? "border-violet-500/30 bg-violet-50/50 dark:bg-violet-950/20"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
            accent
              ? "bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {icon}
        </span>
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function SimilarityBar({ similarity }: { similarity: number | null }) {
  if (similarity == null) {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }
  const percent = Math.round(similarity * 100);
  return (
    <div className="flex items-center gap-2" aria-label={`${percent}% similar`}>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-violet-400"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
        {percent}%
      </span>
    </div>
  );
}

function TicketChip({
  ticket,
  onClick,
}: {
  ticket: TicketSummary;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-left text-xs text-foreground hover:bg-muted/50"
      aria-label={`${ticket.ref} — ${ticket.title}`}
    >
      <span className="shrink-0 font-mono text-muted-foreground">{ticket.ref}</span>
      <span className="min-w-0 flex-1 truncate">{ticket.title}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        <TicketStatusBadge status={ticket.status} />
        {ticket.priority ? <TicketPriorityBadge priority={ticket.priority} /> : null}
      </div>
    </button>
  );
}

export default function DuplicatesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const locale = useLocale();
  const t = useTranslations("duplicates");
  const user = useAppUser();
  const canTriage = hasTicketTriageAccess(user.role, user.specialPermissions);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ProjectDuplicatesResponse | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [linkingKey, setLinkingKey] = useState<string | null>(null);
  const [dismissingKey, setDismissingKey] = useState<string | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  /** Per canonical cluster: expanded unless explicitly false. Default is expanded. */
  const [suggestedExpanded, setSuggestedExpanded] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/duplicates`);
      if (!res.ok) throw new Error("load");
      const json = (await res.json()) as ProjectDuplicatesResponse;
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  async function linkPair(canonicalId: string, duplicateId: string, similarity: number) {
    const key = `${canonicalId}:${duplicateId}`;
    setLinkingKey(key);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(duplicateId)}/link-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonicalId, similarity }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(err?.error ?? t("actionFailed"));
        return;
      }
      toast.success(t("linkedToast"));
      await fetchData();
    } catch {
      toast.error(t("actionFailed"));
    } finally {
      setLinkingKey(null);
    }
  }

  async function dismissPair(canonicalId: string, duplicateId: string) {
    const key = `${canonicalId}:${duplicateId}`;
    setDismissingKey(key);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/duplicates/dismiss`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketAId: canonicalId, ticketBId: duplicateId }),
        }
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(err?.error ?? t("actionFailed"));
        return;
      }
      toast.success(t("dismissedToast"));
      await fetchData();
    } catch {
      toast.error(t("actionFailed"));
    } finally {
      setDismissingKey(null);
    }
  }

  async function unlink(duplicateId: string, linkId: string) {
    setUnlinkingId(linkId);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(duplicateId)}/link-duplicate`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(err?.error ?? t("actionFailed"));
        return;
      }
      toast.success(t("unlinkedToast"));
      await fetchData();
    } catch {
      toast.error(t("actionFailed"));
    } finally {
      setUnlinkingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div
        className="py-(--page-padding-y)"
        style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
      >
        <p className="text-sm text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  const hasAny = data.clusters.length > 0 || data.linked.length > 0;

  return (
    <div
      className="py-(--page-padding-y)"
      style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
    >
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">{t("pageTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("pageSubtitle")}</p>
      </div>

      {/* Stat Cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard
          icon={<Copy className="h-4 w-4" />}
          label={t("statClusters")}
          value={data.totals.clusters}
          accent={data.totals.pendingPairs > 0}
        />
        <StatCard
          icon={<Link2 className="h-4 w-4" />}
          label={t("statLinked")}
          value={data.totals.linkedPairs}
        />
        <StatCard
          icon={<MinusCircle className="h-4 w-4" />}
          label={t("statPending")}
          value={data.totals.pendingPairs}
        />
      </div>

      {!hasAny ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 py-12 text-center">
          <Copy className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {/* Pending suggestions */}
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">{t("sectionPending")}</h2>
              <span className="text-xs text-muted-foreground">
                {t("countPairs", { count: data.totals.pendingPairs })}
              </span>
            </div>
            {data.clusters.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("emptyPending")}</p>
            ) : (
              <ul className="space-y-5">
                {data.clusters.map((cluster) => (
                  <li key={cluster.canonical.id} className="space-y-2">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {t("canonicalLabel")}
                      </span>
                      <TicketChip
                        ticket={cluster.canonical}
                        onClick={() => setSelectedTicketId(cluster.canonical.id)}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5 pl-4">
                      {(() => {
                        const cId = cluster.canonical.id;
                        const isSuggestedOpen = suggestedExpanded[cId] !== false;
                        return (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setSuggestedExpanded((prev) => {
                                  const open = prev[cId] !== false;
                                  return { ...prev, [cId]: !open };
                                })
                              }
                              className="group flex w-full max-w-full items-center gap-1.5 text-left -ml-0.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              aria-expanded={isSuggestedOpen}
                              aria-controls={`suggested-dupes-${cId}`}
                              id={`suggested-dupes-trigger-${cId}`}
                            >
                              <span
                                className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground group-hover:text-foreground"
                                aria-hidden
                              >
                                {isSuggestedOpen ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                              </span>
                              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground group-hover:text-foreground">
                                {t("suggestedLabel")}
                              </span>
                              <span className="ml-auto min-w-0 pl-2 text-[11px] font-normal normal-case tabular-nums text-muted-foreground/80">
                                {t("suggestedCount", { count: cluster.suggestions.length })}
                              </span>
                            </button>
                            {isSuggestedOpen ? (
                              <ul
                                className="space-y-2"
                                id={`suggested-dupes-${cId}`}
                                role="list"
                                aria-labelledby={`suggested-dupes-trigger-${cId}`}
                              >
                                {cluster.suggestions.map((s) => {
                          const key = `${cluster.canonical.id}:${s.ticket.id}`;
                          const isLinking = linkingKey === key;
                          const isDismissing = dismissingKey === key;
                          return (
                            <li key={s.ticket.id} className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <TicketChip
                                  ticket={s.ticket}
                                  onClick={() => setSelectedTicketId(s.ticket.id)}
                                />
                                <div className="shrink-0">
                                  <SimilarityBar similarity={s.similarity} />
                                </div>
                              </div>
                              {canTriage ? (
                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void linkPair(cluster.canonical.id, s.ticket.id, s.similarity)
                                    }
                                    disabled={isLinking || isDismissing}
                                    className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                                  >
                                    {isLinking ? (
                                      <Loader2 size={10} className="animate-spin" aria-hidden />
                                    ) : (
                                      <Link2 size={10} aria-hidden />
                                    )}
                                    {t("actionLink")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void dismissPair(cluster.canonical.id, s.ticket.id)}
                                    disabled={isLinking || isDismissing}
                                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                                  >
                                    {isDismissing ? (
                                      <Loader2 size={10} className="animate-spin" aria-hidden />
                                    ) : null}
                                    {t("actionKeepSeparate")}
                                  </button>
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                              </ul>
                            ) : null}
                          </>
                        );
                      })()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Linked duplicates */}
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">{t("sectionLinked")}</h2>
              <span className="text-xs text-muted-foreground">
                {t("countPairs", { count: data.linked.length })}
              </span>
            </div>
            {data.linked.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("emptyLinked")}</p>
            ) : (
              <ul className="space-y-3">
                {data.linked.map((pair) => {
                  const isUnlinking = unlinkingId === pair.id;
                  return (
                    <li
                      key={pair.id}
                      className="rounded-lg border border-border bg-card p-3 shadow-xs"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                          <TicketChip
                            ticket={pair.canonical}
                            onClick={() => setSelectedTicketId(pair.canonical.id)}
                          />
                          <div className="pl-4">
                            <TicketChip
                              ticket={pair.duplicate}
                              onClick={() => setSelectedTicketId(pair.duplicate.id)}
                            />
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <SimilarityBar similarity={pair.similarity} />
                          {canTriage ? (
                            <button
                              type="button"
                              onClick={() => void unlink(pair.duplicate.id, pair.id)}
                              disabled={isUnlinking}
                              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                            >
                              {isUnlinking ? (
                                <Loader2 size={10} className="animate-spin" aria-hidden />
                              ) : (
                                <Link2Off size={10} aria-hidden />
                              )}
                              {t("actionUnlink")}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      {selectedTicketId && (
        <TicketDetailView
          variant="modal"
          ticketId={selectedTicketId}
          locale={locale}
          canTriage={canTriage}
          isAdmin={user.role === "ADMIN"}
          currentUserId={user.id}
          onUpdate={fetchData}
          onRequestClose={() => setSelectedTicketId(null)}
          routeProjectId={projectId}
        />
      )}
    </div>
  );
}
