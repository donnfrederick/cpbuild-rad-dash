"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Loader2,
  Ticket,
  Eye,
  User,
  Clock,
  ArrowRight,
  Calendar,
  Bug,
  Lightbulb,
  Copy,
  MessageSquare,
  Zap,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { useAppUser } from "@/contexts/AppUserContext";
import { hasTicketTriageAccess } from "@/lib/ticket-triage";
import { TicketDetailView, TicketStatusBadge, TicketPriorityBadge } from "@/components/tickets/TicketDetailView";
import type { TicketStatus } from "@/components/tickets/ticket-types";
import { Link } from "@/i18n/navigation";

interface StatusBreakdownItem {
  status: TicketStatus;
  count: number;
}

interface MostRecentTicket {
  id: string;
  ref: string;
  shortId: number;
  title: string;
  status: TicketStatus;
  priority: "LOW" | "MEDIUM" | "HIGH" | null;
  storyPoints: number | null;
  createdAt: string;
  user: { id: string; name: string | null; email: string };
  assignee: { id: string; name: string | null; email: string } | null;
}

interface OverviewData {
  projectName: string;
  projectDescription: string | null;
  totalTickets: number;
  forReviewCount: number;
  assignedToMeCount: number;
  statusBreakdown: StatusBreakdownItem[];
  typeBreakdown: {
    BUG: number;
    FEATURE_REQUEST: number;
    FEEDBACK: number;
    MINOR_ENHANCEMENT: number;
    REGRESSION: number;
    SECURITY_IMPROVEMENT: number;
  };
  priorityBreakdown: { HIGH: number; MEDIUM: number; LOW: number; NONE: number };
  mostRecentTicket: MostRecentTicket | null;
}

interface DuplicatesSummaryTicket {
  id: string;
  ref: string;
  shortId: number;
  title: string;
}

interface DuplicatesSummary {
  totals: { clusters: number; linkedPairs: number; pendingPairs: number };
  clusters: Array<{
    canonical: DuplicatesSummaryTicket;
    suggestions: Array<{ ticket: DuplicatesSummaryTicket; similarity: number }>;
  }>;
}

const STATUS_COLORS: Record<TicketStatus, string> = {
  BACKLOG: "#94a3b8",
  READY: "#60a5fa",
  IN_PROGRESS: "#fbbf24",
  FOR_REVIEW: "#a78bfa",
  RESOLVED: "#34d399",
  TO_BE_DEPLOYED: "#fb923c",
  DONE: "#10b981",
  ARCHIVED: "#6b7280",
};

const STATUS_LABELS: Record<TicketStatus, string> = {
  BACKLOG: "Planning",
  READY: "Ready",
  IN_PROGRESS: "In Progress",
  FOR_REVIEW: "For Review",
  RESOLVED: "Resolved",
  TO_BE_DEPLOYED: "To Be Deployed",
  DONE: "Done",
  ARCHIVED: "Archived",
};

function StatCard({
  icon,
  label,
  value,
  accent,
  badge,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  accent?: boolean;
  badge?: React.ReactNode;
  href?: string;
}) {
  const inner = (
    <div
      className={`relative flex flex-col gap-3 rounded-xl border p-5 shadow-sm transition-colors ${
        accent
          ? "border-violet-500/30 bg-violet-50/50 dark:bg-violet-950/20"
          : "border-border bg-card"
      } ${href ? "cursor-pointer hover:bg-accent/50" : ""}`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
            accent ? "bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400" : "bg-muted text-muted-foreground"
          }`}
        >
          {icon}
        </span>
        {badge}
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {inner}
      </Link>
    );
  }
  return inner;
}

function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const locale = useLocale();
  const user = useAppUser();
  const canTriage = hasTicketTriageAccess(user.role, user.specialPermissions);
  const tDup = useTranslations("duplicates");
  const tTickets = useTranslations("tickets");

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OverviewData | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicatesSummary | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/overview`);
      if (!res.ok) throw new Error("load");
      const json = (await res.json()) as OverviewData;
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const fetchDuplicatesSummary = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/duplicates?summary=1`
      );
      if (!res.ok) throw new Error("load");
      const json = (await res.json()) as DuplicatesSummary;
      setDuplicates(json);
    } catch {
      setDuplicates(null);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchOverview();
    void fetchDuplicatesSummary();
  }, [fetchOverview, fetchDuplicatesSummary]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-(--page-padding-y)" style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}>
        <p className="text-sm text-muted-foreground">Failed to load project overview.</p>
      </div>
    );
  }

  const pieData = data.statusBreakdown
    .filter((s) => s.count > 0)
    .map((s) => ({
      name: STATUS_LABELS[s.status],
      value: s.count,
      color: STATUS_COLORS[s.status],
    }));

  const hasTickets = data.totalTickets > 0;

  return (
    <div
      className="py-(--page-padding-y)"
      style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
    >
      {/* Stat Cards */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<Ticket className="h-4 w-4" />}
          label="Total Tickets"
          value={data.totalTickets}
        />
        <StatCard
          icon={<Eye className="h-4 w-4" />}
          label="For Review"
          value={data.forReviewCount}
          accent={data.forReviewCount > 0}
        />
        <StatCard
          icon={<User className="h-4 w-4" />}
          label="Assigned to Me"
          value={data.assignedToMeCount}
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="Sprints"
          value="View"
          href="/sprints"
        />
      </div>

      {/* Type & Priority Cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Ticket Type */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="mb-4 text-sm font-semibold text-foreground">Ticket Type</p>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-red-50 text-red-500 dark:bg-red-950/40">
                  <Bug className="h-3.5 w-3.5" />
                </span>
                <span className="text-sm text-muted-foreground">{tTickets("typeBug")}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-red-400"
                    style={{
                      width: data.totalTickets > 0
                        ? `${Math.round((data.typeBreakdown.BUG / data.totalTickets) * 100)}%`
                        : "0%",
                    }}
                  />
                </div>
                <span className="w-6 text-right text-sm font-semibold tabular-nums text-foreground">
                  {data.typeBreakdown.BUG}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-50 text-blue-500 dark:bg-blue-950/40">
                  <Lightbulb className="h-3.5 w-3.5" />
                </span>
                <span className="text-sm text-muted-foreground">{tTickets("typeFeature")}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-blue-400"
                    style={{
                      width: data.totalTickets > 0
                        ? `${Math.round((data.typeBreakdown.FEATURE_REQUEST / data.totalTickets) * 100)}%`
                        : "0%",
                    }}
                  />
                </div>
                <span className="w-6 text-right text-sm font-semibold tabular-nums text-foreground">
                  {data.typeBreakdown.FEATURE_REQUEST}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-50 text-teal-600 dark:bg-teal-950/40">
                  <MessageSquare className="h-3.5 w-3.5" />
                </span>
                <span className="text-sm text-muted-foreground">{tTickets("typeFeedback")}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-teal-400"
                    style={{
                      width: data.totalTickets > 0
                        ? `${Math.round((data.typeBreakdown.FEEDBACK / data.totalTickets) * 100)}%`
                        : "0%",
                    }}
                  />
                </div>
                <span className="w-6 text-right text-sm font-semibold tabular-nums text-foreground">
                  {data.typeBreakdown.FEEDBACK}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-50 text-amber-600 dark:bg-amber-950/40">
                  <Zap className="h-3.5 w-3.5" />
                </span>
                <span className="text-sm text-muted-foreground">{tTickets("typeMinorEnhancement")}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-amber-400"
                    style={{
                      width:
                        data.totalTickets > 0
                          ? `${Math.round((data.typeBreakdown.MINOR_ENHANCEMENT / data.totalTickets) * 100)}%`
                          : "0%",
                    }}
                  />
                </div>
                <span className="w-6 text-right text-sm font-semibold tabular-nums text-foreground">
                  {data.typeBreakdown.MINOR_ENHANCEMENT}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-orange-50 text-orange-600 dark:bg-orange-950/40">
                  <RotateCcw className="h-3.5 w-3.5" />
                </span>
                <span className="text-sm text-muted-foreground">{tTickets("typeRegression")}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-orange-400"
                    style={{
                      width:
                        data.totalTickets > 0
                          ? `${Math.round((data.typeBreakdown.REGRESSION / data.totalTickets) * 100)}%`
                          : "0%",
                    }}
                  />
                </div>
                <span className="w-6 text-right text-sm font-semibold tabular-nums text-foreground">
                  {data.typeBreakdown.REGRESSION}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-50 text-violet-600 dark:bg-violet-950/40">
                  <ShieldCheck className="h-3.5 w-3.5" />
                </span>
                <span className="text-sm text-muted-foreground">{tTickets("typeSecurityImprovement")}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-violet-400"
                    style={{
                      width:
                        data.totalTickets > 0
                          ? `${Math.round((data.typeBreakdown.SECURITY_IMPROVEMENT / data.totalTickets) * 100)}%`
                          : "0%",
                    }}
                  />
                </div>
                <span className="w-6 text-right text-sm font-semibold tabular-nums text-foreground">
                  {data.typeBreakdown.SECURITY_IMPROVEMENT}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Priority */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="mb-4 text-sm font-semibold text-foreground">Priority</p>
          <div className="flex flex-col gap-3">
            {(
              [
                { key: "HIGH", label: "High", bar: "bg-red-400", dot: "bg-red-400" },
                { key: "MEDIUM", label: "Medium", bar: "bg-amber-400", dot: "bg-amber-400" },
                { key: "LOW", label: "Low", bar: "bg-green-400", dot: "bg-green-400" },
                { key: "NONE", label: "None", bar: "bg-slate-300", dot: "bg-slate-300" },
              ] as const
            ).map(({ key, label, bar, dot }) => (
              <div key={key} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${dot}`} />
                  <span className="text-sm text-muted-foreground">{label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${bar}`}
                      style={{
                        width: data.totalTickets > 0
                          ? `${Math.round((data.priorityBreakdown[key] / data.totalTickets) * 100)}%`
                          : "0%",
                      }}
                    />
                  </div>
                  <span className="w-6 text-right text-sm font-semibold tabular-nums text-foreground">
                    {data.priorityBreakdown[key]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Possible Duplicates Summary */}
      {duplicates && (duplicates.totals.pendingPairs > 0 || duplicates.totals.linkedPairs > 0) ? (
        <div className="mb-8">
          <Link
            href={`/projects/${projectId}/duplicates`}
            className="group flex flex-col gap-3 rounded-xl border border-violet-500/30 bg-violet-50/50 p-5 shadow-sm transition-colors hover:bg-violet-50 dark:bg-violet-950/20 dark:hover:bg-violet-950/30"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400">
                  <Copy className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {tDup("overviewCardTitle")}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {tDup("overviewCardSubtitle", {
                      clusters: duplicates.totals.clusters,
                      pending: duplicates.totals.pendingPairs,
                      linked: duplicates.totals.linkedPairs,
                    })}
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-violet-400">
                {tDup("overviewCardCta")}
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
            {duplicates.clusters.length > 0 ? (
              <ul className="space-y-2 border-t border-violet-500/20 pt-3">
                {duplicates.clusters.slice(0, 2).map((cluster) => {
                  const top = cluster.suggestions[0];
                  if (!top) return null;
                  const percent = Math.round(top.similarity * 100);
                  return (
                    <li key={cluster.canonical.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono text-foreground">
                        {cluster.canonical.ref}
                      </span>
                      <span className="text-muted-foreground/70">~</span>
                      <span className="font-mono text-foreground">
                        {top.ticket.ref}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{top.ticket.title}</span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-violet-400"
                            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                          />
                        </div>
                        <span className="w-9 shrink-0 text-right text-[11px] font-semibold tabular-nums text-foreground">
                          {percent}%
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </Link>
        </div>
      ) : null}

      {/* Bottom grid */}
      {hasTickets ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Most Recent Ticket */}
          {data.mostRecentTicket && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-foreground">Most Recent Ticket</h2>
              <button
                type="button"
                onClick={() => setSelectedTicketId(data.mostRecentTicket!.id)}
                className="group w-full rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-colors hover:bg-accent/50"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">
                      {data.mostRecentTicket.ref}
                    </p>
                    <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
                      {data.mostRecentTicket.title}
                    </p>
                  </div>
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <TicketStatusBadge status={data.mostRecentTicket.status} />
                  {data.mostRecentTicket.priority && (
                    <TicketPriorityBadge priority={data.mostRecentTicket.priority} />
                  )}
                  {data.mostRecentTicket.assignee && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <User className="h-3 w-3" />
                      {data.mostRecentTicket.assignee.name ?? data.mostRecentTicket.assignee.email}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {formatRelativeDate(data.mostRecentTicket.createdAt)}
                  </span>
                </div>
              </button>
            </div>
          )}

          {/* Status Breakdown Chart */}
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-foreground">Tickets by Status</h2>
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: unknown, name) => {
                        const n = typeof value === "number" ? value : Number(value ?? 0);
                        return [`${n} ticket${n !== 1 ? "s" : ""}`, String(name)];
                      }}
                      contentStyle={{
                        borderRadius: "8px",
                        border: "1px solid hsl(var(--border))",
                        background: "hsl(var(--card))",
                        color: "hsl(var(--foreground))",
                        fontSize: "12px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                  No ticket data yet
                </div>
              )}
              {/* Full status legend — all 8 statuses always visible */}
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-4">
                {data.statusBreakdown.map((s) => (
                  <div key={s.status} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[s.status] }}
                      />
                      <span className="truncate text-xs text-muted-foreground">
                        {STATUS_LABELS[s.status]}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
                      {s.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-card/50 py-12 text-center">
          <Ticket className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium text-muted-foreground">No tickets in this project yet</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Create a ticket to get started.</p>
        </div>
      )}

      {/* Ticket Detail Modal */}
      {selectedTicketId && (
        <TicketDetailView
          variant="modal"
          ticketId={selectedTicketId}
          locale={locale}
          canTriage={canTriage}
          isAdmin={user.role === "ADMIN"}
          currentUserId={user.id}
          onUpdate={fetchOverview}
          onRequestClose={() => setSelectedTicketId(null)}
        />
      )}
    </div>
  );
}
