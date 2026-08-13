"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, BarChart3, FolderKanban, CheckCircle2, ArrowRight, FileDown } from "lucide-react";
import { downloadSprintCompletionReportPdf } from "@/lib/sprint-completion-report-pdf";
import { Link } from "@/i18n/navigation";
import type { SprintApiPayload } from "@/lib/sprint-map";
import { ticketTypeKindLabelKey } from "@/components/tickets/ticket-types";
import type {
  SprintCompletionReport,
  SprintCompletionReportAssigneeRow,
  SprintCompletionReportDimensionRow,
  SprintCompletionReportProjectRow,
} from "@/lib/sprint-completion-report-types";
import { SprintCompletedTag } from "@/components/sprints/SprintCompletedTag";
import { TicketStatusBadge } from "@/components/tickets/TicketDetailView";

interface ReportApiResponse {
  sprint: SprintApiPayload;
  completedAt: string;
  report: SprintCompletionReport;
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <div>
        <p className="text-2xl font-bold tracking-tight tabular-nums text-foreground">{value}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{label}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

function SummaryTable({
  title,
  headers,
  rows,
  emptyLabel,
}: {
  title: string;
  headers: [string, string, string, string, string];
  rows: Array<{ key: string; cells: [string, string, string, string, string] }>;
  emptyLabel: string;
}): React.ReactElement {
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                {headers.map((h) => (
                  <th key={h} className="px-4 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-border/60 last:border-0">
                  {row.cells.map((cell, i) => (
                    <td
                      key={i}
                      className={`px-4 py-2.5 ${i > 0 ? "tabular-nums" : "font-medium text-foreground"}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function projectRows(
  projects: SprintCompletionReportProjectRow[],
  unassignedLabel: string
): Array<{ key: string; cells: [string, string, string, string, string] }> {
  return projects.map((p) => ({
    key: p.projectId ?? "unassigned",
    cells: [
      p.projectId ? p.projectName : unassignedLabel,
      String(p.ticketCount),
      String(p.doneCount),
      String(p.velocityPoints),
      String(p.carryoverPoints),
    ],
  }));
}

function assigneeRows(
  rows: SprintCompletionReportAssigneeRow[],
  unassignedLabel: string
): Array<{ key: string; cells: [string, string, string, string, string] }> {
  return rows.map((a) => ({
    key: a.userId ?? "unassigned",
    cells: [
      a.userId ? a.assigneeLabel : unassignedLabel,
      String(a.ticketCount),
      String(a.doneCount),
      String(a.velocityPoints),
      String(a.carryoverPoints),
    ],
  }));
}

function dimensionRows(
  rows: SprintCompletionReportDimensionRow[],
  labelForKey: (key: string) => string
): Array<{ key: string; cells: [string, string, string, string, string] }> {
  return rows.map((r) => ({
    key: r.key,
    cells: [
      labelForKey(r.key),
      String(r.ticketCount),
      String(r.doneCount),
      String(r.velocityPoints),
      String(r.carryoverPoints),
    ],
  }));
}

export default function SprintCompletionReportPage({
  params,
}: {
  params: Promise<{ sprintId: string }>;
}): React.ReactElement {
  const { sprintId } = use(params);
  const t = useTranslations("sprints");
  const tTickets = useTranslations("tickets");

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReportApiResponse | null>(null);
  const [notCompleted, setNotCompleted] = useState(false);

  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch(`/api/sprints/${encodeURIComponent(sprintId)}/completion-report`);
      if (res.status === 400) {
        setNotCompleted(true);
        setData(null);
        return;
      }
      if (!res.ok) throw new Error("load");
      const json = (await res.json()) as ReportApiResponse;
      setData(json);
      setNotCompleted(false);
    } catch {
      setData(null);
      setNotCompleted(false);
    } finally {
      setLoading(false);
    }
  }, [sprintId]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notCompleted) {
    return (
      <div
        className="py-(--page-padding-y)"
        style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
      >
        <p className="text-sm text-muted-foreground">{t("reportNotCompleted")}</p>
        <Link
          href={`/sprints/${sprintId}/overview`}
          className="mt-3 inline-flex text-sm font-medium text-primary hover:underline"
        >
          {t("navOverview")}
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div
        className="py-(--page-padding-y)"
        style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
      >
        <p className="text-sm text-muted-foreground">{t("reportLoadFailed")}</p>
      </div>
    );
  }

  const { sprint, completedAt, report } = data;
  const completedLabel = new Date(completedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const unassignedProject = t("reportUnassignedProject");
  const unassignedAssignee = t("reportUnassignedAssignee");

  const labelForType = (typeKey: string): string => {
    const i18nKey = ticketTypeKindLabelKey(typeKey);
    return i18nKey ? tTickets(i18nKey) : typeKey;
  };

  const labelForPriority = (priorityKey: string): string => {
    if (priorityKey === "HIGH") return tTickets("priorityHigh");
    if (priorityKey === "MEDIUM") return tTickets("priorityMedium");
    if (priorityKey === "LOW") return tTickets("priorityLow");
    if (priorityKey === "NONE") return tTickets("priorityNone");
    return priorityKey;
  };

  const handleExportPdf = (): void => {
    downloadSprintCompletionReportPdf({
      sprintName: sprint.name,
      goals: sprint.goals,
      report,
      labels: {
        statusCompleted: t("completedTag"),
        completedOn: completedLabel,
        goals: t("reportGoals"),
        velocity: t("reportVelocity"),
        plannedVsCompleted: t("reportPlannedVsCompleted"),
        carryover: t("reportCarryover"),
        projectsWorked: t("reportProjectsWorked"),
        byProject: t("reportByProject"),
        byAssignee: t("reportByAssignee"),
        byType: t("reportByType"),
        byPriority: t("reportByPriority"),
        colProject: t("reportColProject"),
        colAssignee: t("reportColAssignee"),
        colType: t("reportColType"),
        colPriority: t("reportColPriority"),
        colTickets: t("reportColTickets"),
        colDone: t("reportColDone"),
        colCompletedPts: t("reportColCompletedPts"),
        colCarryoverPts: t("reportColCarryoverPts"),
        colRef: t("completeTableRef"),
        colTitle: t("completeTableTitle"),
        colStoryPoints: t("completeTablePoints"),
        doneTickets: t("reportDoneTickets"),
        carryoverTicketsHeading: t("reportCarryoverTicketsHeading"),
        unassignedProject: unassignedProject,
        unassignedAssignee: unassignedAssignee,
        pointsAbbr: t("overviewPointsAbbr"),
        carryoverTicketsCount: t("reportCarryoverTickets", {
          count: report.summary.carryoverTicketCount,
        }),
      },
      labelForType,
      labelForPriority,
    });
  };

  return (
    <div
      className="py-(--page-padding-y)"
      style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
    >
      <div className="mb-6 rounded-xl border border-border bg-card/80 p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{sprint.name}</h1>
            <SprintCompletedTag className="translate-y-px" />
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportPdf}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden />
              {t("reportExportPdf")}
            </button>
            <Link
              href={`/sprints/${sprintId}/overview`}
              className="text-sm font-medium text-primary hover:underline"
            >
              {t("navOverview")}
            </Link>
          </div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("reportCompletedOn", { date: completedLabel })}
        </p>
        {sprint.goals?.trim() ? (
          <p className="mt-3 text-sm text-foreground">
            <span className="font-medium text-muted-foreground">{t("reportGoals")}: </span>
            {sprint.goals.trim()}
          </p>
        ) : null}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label={t("reportVelocity")}
          value={
            <>
              {report.summary.velocityPoints}{" "}
              <span className="text-sm font-normal text-muted-foreground">{t("overviewPointsAbbr")}</span>
            </>
          }
          hint={t("overviewSprintVelocityHint")}
        />
        <StatCard
          icon={<BarChart3 className="h-4 w-4" />}
          label={t("reportPlannedVsCompleted")}
          value={
            report.summary.pointsPlanned != null
              ? `${report.summary.velocityPoints} / ${report.summary.pointsPlanned}`
              : report.summary.velocityPoints
          }
          hint={
            report.summary.pointsPlanned != null
              ? t("reportPlannedVsCompletedHint")
              : undefined
          }
        />
        <StatCard
          icon={<ArrowRight className="h-4 w-4" />}
          label={t("reportCarryover")}
          value={
            <>
              {report.summary.carryoverPoints}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                {t("reportCarryoverTickets", { count: report.summary.carryoverTicketCount })}
              </span>
            </>
          }
        />
        <StatCard
          icon={<FolderKanban className="h-4 w-4" />}
          label={t("reportProjectsWorked")}
          value={report.projects.length}
          hint={t("reportProjectsWorkedHint")}
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <SummaryTable
          title={t("reportByProject")}
          headers={[
            t("reportColProject"),
            t("reportColTickets"),
            t("reportColDone"),
            t("reportColCompletedPts"),
            t("reportColCarryoverPts"),
          ]}
          rows={projectRows(report.projects, unassignedProject)}
          emptyLabel={t("reportEmptyProjects")}
        />
        <SummaryTable
          title={t("reportByAssignee")}
          headers={[
            t("reportColAssignee"),
            t("reportColTickets"),
            t("reportColDone"),
            t("reportColCompletedPts"),
            t("reportColCarryoverPts"),
          ]}
          rows={assigneeRows(report.byAssignee, unassignedAssignee)}
          emptyLabel={t("reportEmptyAssignees")}
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <SummaryTable
          title={t("reportByType")}
          headers={[
            t("reportColType"),
            t("reportColTickets"),
            t("reportColDone"),
            t("reportColCompletedPts"),
            t("reportColCarryoverPts"),
          ]}
          rows={dimensionRows(report.byType, labelForType)}
          emptyLabel={t("reportEmptyTypes")}
        />
        <SummaryTable
          title={t("reportByPriority")}
          headers={[
            t("reportColPriority"),
            t("reportColTickets"),
            t("reportColDone"),
            t("reportColCompletedPts"),
            t("reportColCarryoverPts"),
          ]}
          rows={dimensionRows(report.byPriority, labelForPriority)}
          emptyLabel={t("reportEmptyPriorities")}
        />
      </div>

      <section className="mb-6 rounded-xl border border-border bg-card shadow-sm">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
          {t("reportDoneTickets")}
        </h2>
        {report.doneTickets.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">{t("reportEmptyDone")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {report.doneTickets.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{row.ref}</span>
                <span className="min-w-0 flex-1 font-medium text-foreground">{row.title}</span>
                <span className="text-xs text-muted-foreground">
                  {row.projectId ? row.projectName : unassignedProject}
                </span>
                <span className="text-xs text-muted-foreground">
                  {row.assigneeId ? row.assigneeLabel : unassignedAssignee}
                </span>
                <span className="tabular-nums text-xs text-muted-foreground">
                  {row.storyPoints != null
                    ? tTickets("storyPointsShort", { n: row.storyPoints })
                    : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {report.carryoverTickets.length > 0 ? (
        <section className="rounded-xl border border-border bg-card shadow-sm">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
            {t("reportCarryoverTicketsHeading")}
          </h2>
          <ul className="divide-y divide-border">
            {report.carryoverTickets.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{row.ref}</span>
                <span className="min-w-0 flex-1 font-medium text-foreground">{row.title}</span>
                <TicketStatusBadge status={row.status} />
                <span className="text-xs text-muted-foreground">
                  {row.projectId ? row.projectName : unassignedProject}
                </span>
                <span className="text-xs text-muted-foreground">
                  {row.assigneeId ? row.assigneeLabel : unassignedAssignee}
                </span>
                <span className="tabular-nums text-xs text-muted-foreground">
                  {row.storyPoints != null
                    ? tTickets("storyPointsShort", { n: row.storyPoints })
                    : "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
