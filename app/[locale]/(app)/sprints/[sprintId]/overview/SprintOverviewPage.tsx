"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Loader2,
  Ticket,
  Eye,
  User,
  LayoutList,
  ArrowRight,
  Calendar,
  Bug,
  Lightbulb,
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
import type { SprintApiPayload } from "@/lib/sprint-map";
import { isSprintDraft, isSprintOverdue, isSprintRunning } from "@/lib/sprint-active";
import { formatSprintPlanningMetaLine } from "@/lib/sprint-planning-meta";
import { SprintActiveTag } from "@/components/sprints/SprintActiveTag";
import { SprintCompletedTag } from "@/components/sprints/SprintCompletedTag";
import { SprintOverdueTag } from "@/components/sprints/SprintOverdueTag";
import { SprintDraftTag } from "@/components/sprints/SprintDraftTag";

interface StatusBreakdownItem {
  status: TicketStatus;
  count: number;
}

interface StatusPointsItem {
  status: TicketStatus;
  points: number;
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

interface SprintOverviewData {
  sprint: SprintApiPayload;
  teamVelocityRollingAvg8: number | null;
  totalTickets: number;
  forReviewCount: number;
  assignedToMeCount: number;
  statusBreakdown: StatusBreakdownItem[];
  statusPointsBreakdown: StatusPointsItem[];
  totalStoryPoints: number;
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
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  accent?: boolean;
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

export default function SprintOverviewPage({
  params,
}: {
  params: Promise<{ sprintId: string }>;
}) {
  const { sprintId } = use(params);
  const locale = useLocale();
  const t = useTranslations("sprints");
  const tTickets = useTranslations("tickets");
  const user = useAppUser();
  const canTriage = hasTicketTriageAccess(user.role, user.specialPermissions);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SprintOverviewData | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const ticketsHref = `/sprints/${sprintId}/tickets`;

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch(`/api/sprints/${encodeURIComponent(sprintId)}/overview`);
      if (!res.ok) throw new Error("load");
      const json = (await res.json()) as SprintOverviewData;
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [sprintId]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

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
        <p className="text-sm text-muted-foreground">{t("overviewLoadFailed")}</p>
      </div>
    );
  }

  const sprint = data.sprint;
  const planningLine = formatSprintPlanningMetaLine(sprint, t);
  const goalsText = sprint.goals?.trim();
  const sprintIsRunning = isSprintRunning(sprint);
  const sprintIsOverdue = isSprintOverdue(sprint);

  const pieData = data.statusBreakdown
    .filter((s) => s.count > 0)
    .map((s) => ({
      name: STATUS_LABELS[s.status],
      value: s.count,
      color: STATUS_COLORS[s.status],
    }));

  const hasTickets = data.totalTickets > 0;
  const pointsByStatus = new Map(
    data.statusPointsBreakdown.map((r) => [r.status, r.points] as const)
  );

  return (
    <div
      className="py-(--page-padding-y)"
      style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
    >
      <div className="mb-6 rounded-xl border border-border bg-card/80 p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{sprint.name}</h1>
            {sprint.completedAt ? <SprintCompletedTag className="translate-y-px" /> : null}
            {!sprint.completedAt && sprintIsRunning ? <SprintActiveTag className="translate-y-px" /> : null}
            {!sprint.completedAt && sprintIsOverdue ? <SprintOverdueTag className="translate-y-px" /> : null}
            {!sprint.completedAt && isSprintDraft(sprint) ? <SprintDraftTag className="translate-y-px" /> : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {sprint.completedAt ? (
              <Link
                href={`/sprints/${sprintId}/report`}
                className="rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
              >
                {t("reportOpen")}
              </Link>
            ) : null}
            {canTriage && !sprint.completedAt ? (
              <Link
                href={`/sprints/${sprintId}/complete`}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                {t("completeSprintOpen")}
              </Link>
            ) : null}
          </div>
        </div>
        {planningLine ? (
          <p className="mt-2 text-sm text-muted-foreground tabular-nums">{planningLine}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-border pt-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{t("overviewPlannedPoints")}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
              {sprint.pointsPlanned != null ? sprint.pointsPlanned : "—"}{" "}
              {sprint.pointsPlanned != null ? (
                <span className="text-sm font-normal text-muted-foreground">{t("overviewPointsAbbr")}</span>
              ) : null}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">{t("overviewScopePoints")}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
              {data.totalStoryPoints}{" "}
              <span className="text-sm font-normal text-muted-foreground">{t("overviewPointsAbbr")}</span>
            </p>
            <p className="mt-0.5 max-w-md text-[11px] text-muted-foreground">{t("overviewScopePointsHint")}</p>
          </div>
          {sprint.completedAt && sprint.velocity != null ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">{t("overviewSprintVelocity")}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                {sprint.velocity}{" "}
                <span className="text-sm font-normal text-muted-foreground">{t("overviewPointsAbbr")}</span>
              </p>
              <p className="mt-0.5 max-w-md text-[11px] text-muted-foreground">{t("overviewSprintVelocityHint")}</p>
            </div>
          ) : null}
          {data.teamVelocityRollingAvg8 != null ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">{t("overviewTeamVelocityAvg8")}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                {data.teamVelocityRollingAvg8}{" "}
                <span className="text-sm font-normal text-muted-foreground">{t("overviewPointsAbbr")}</span>
              </p>
              <p className="mt-0.5 max-w-md text-[11px] text-muted-foreground">{t("overviewTeamVelocityAvg8Hint")}</p>
            </div>
          ) : null}
        </div>
        {sprint.projects.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs font-medium text-muted-foreground">{t("projectsInSprint")}</p>
            <ul className="mt-1.5 flex flex-wrap gap-2">
              {sprint.projects.map((p) => (
                <li
                  key={p.id}
                  className="rounded-md border border-border bg-muted/50 px-2.5 py-1 text-sm text-foreground"
                >
                  {p.name}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {goalsText && goalsText.length > 0 ? (
          <div className="mt-4 max-w-3xl border-t border-border pt-4">
            <p className="text-xs font-medium text-muted-foreground">{t("fieldSprintGoals")}</p>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{goalsText}</p>
          </div>
        ) : null}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<Ticket className="h-4 w-4" />} label={t("overviewTotalTickets")} value={data.totalTickets} href={ticketsHref} />
        <StatCard
          icon={<Eye className="h-4 w-4" />}
          label={t("overviewForReview")}
          value={data.forReviewCount}
          accent={data.forReviewCount > 0}
        />
        <StatCard
          icon={<User className="h-4 w-4" />}
          label={t("overviewAssignedToMe")}
          value={data.assignedToMeCount}
        />
        <StatCard
          icon={<LayoutList className="h-4 w-4" />}
          label={t("navTickets")}
          value={t("openBoard")}
          href={ticketsHref}
        />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                      width: data.totalTickets > 0 ? `${Math.round((data.typeBreakdown.BUG / data.totalTickets) * 100)}%` : "0%",
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
                      width:
                        data.totalTickets > 0
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
                      width:
                        data.totalTickets > 0
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
                        width:
                          data.totalTickets > 0
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

      <div
        className={`grid grid-cols-1 gap-6 ${hasTickets && data.mostRecentTicket ? "lg:grid-cols-2" : ""}`}
      >
        {hasTickets && data.mostRecentTicket ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-foreground">Most Recent Ticket</h2>
            <button
              type="button"
              onClick={() => setSelectedTicketId(data.mostRecentTicket!.id)}
              className="group w-full rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-colors hover:bg-accent/50"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{data.mostRecentTicket.ref}</p>
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
        ) : null}

        <div
          className={
            hasTickets && data.mostRecentTicket
              ? "flex flex-col gap-3"
              : "col-span-1 flex flex-col gap-3 lg:col-span-2"
          }
        >
          <h2 className="text-sm font-semibold text-foreground">{t("overviewTicketsByStatus")}</h2>
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            {hasTickets && pieData.length > 0 ? (
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
                {t("overviewNoStatusPie")}
              </div>
            )}
            <div className="mt-4 space-y-1 border-t border-border pt-4">
              <div className="mb-1.5 grid grid-cols-[1fr_auto_auto] gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <span className="min-w-0 pl-1">{t("overviewStatusCol")}</span>
                <span className="text-right tabular-nums">{t("overviewCountAbbr")}</span>
                <span className="w-12 text-right tabular-nums sm:w-14">{t("overviewPointsCol")}</span>
              </div>
              {data.statusBreakdown.map((s) => {
                const pts = pointsByStatus.get(s.status) ?? 0;
                return (
                  <div
                    key={s.status}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[s.status] }}
                      />
                      <span className="truncate text-muted-foreground">{STATUS_LABELS[s.status]}</span>
                    </div>
                    <span className="shrink-0 text-right font-semibold tabular-nums text-foreground">
                      {s.count}
                    </span>
                    <span className="w-12 shrink-0 text-right font-semibold tabular-nums text-foreground sm:w-14">
                      {pts}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {!hasTickets ? (
        <div className="mt-6 rounded-xl border border-dashed border-border bg-card/50 py-12 text-center">
          <Ticket className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium text-muted-foreground">{t("overviewEmptyTickets")}</p>
          <p className="mt-3 text-xs text-muted-foreground/80">
            <Link href={ticketsHref} className="font-medium text-foreground underline-offset-2 hover:underline">
              {t("openBoard")}
            </Link>
          </p>
        </div>
      ) : null}

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
