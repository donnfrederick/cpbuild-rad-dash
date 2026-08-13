"use client";

import type { MouseEvent as ReactMouseEvent, ReactElement } from "react";
import { useTranslations } from "next-intl";
import {
  Bug,
  Lightbulb,
  Link2,
  MessageSquare,
  RotateCcw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { TicketPriorityBadge, TicketStatusBadge } from "@/components/tickets/TicketDetailView";
import { StoryPointsInlineEdit } from "@/components/tickets/StoryPointsInlineEdit";
import type { TicketReport, TicketRow } from "@/components/tickets/ticket-types";
import { cn } from "@/lib/utils";
import { TicketInboxPlanningShell } from "@/components/tickets/TicketInboxPlanningShell";
import type { PlanningSprintPick } from "@/lib/project-planning-sprint";

export type TicketInboxRowZone = "single" | "sprint" | "backlog";

export interface TicketInboxTicketRowProps {
  report: TicketRow;
  zone: TicketInboxRowZone;
  planningSprint: PlanningSprintPick | null | undefined;
  planningSplitEnabled: boolean;
  sprintContextId?: string;
  scopedProjectId?: string;
  canTriage: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  /** Right-click anywhere on the row (checkbox + body). */
  onRowContextMenu?: (e: ReactMouseEvent) => void;
  /** Tighter rows + flush list (Jira-style planning). */
  compactPlanningRow?: boolean;
  teamId?: string;
  onStoryPointsPatched?: (report: TicketReport) => void;
}

/** Shared inbox row body — used for flat list and sprint planning zones. */
export function TicketInboxTicketRow({
  report,
  zone,
  planningSprint,
  planningSplitEnabled,
  sprintContextId,
  scopedProjectId,
  canTriage,
  selected,
  onToggleSelect,
  onOpen,
  onRowContextMenu,
  compactPlanningRow = false,
  teamId,
  onStoryPointsPatched,
}: TicketInboxTicketRowProps): ReactElement {
  const t = useTranslations("tickets");

  const inner = (
    <>
      <div
        className={cn(
          "flex shrink-0 items-start",
          compactPlanningRow ? "pt-2.5 pl-2" : "pt-4 pl-3"
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 rounded border-border"
          aria-label={t("bulkSelectRowAria", { ref: report.ref })}
        />
      </div>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex-1 text-left",
          compactPlanningRow ? "min-h-[44px] py-2.5 px-3" : "min-h-[56px] p-4"
        )}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">
            {report.type === "BUG" ? (
              <Bug size={16} className="text-error-600" />
            ) : report.type === "FEATURE_REQUEST" ? (
              <Lightbulb size={16} className="text-primary" />
            ) : report.type === "FEEDBACK" ? (
              <MessageSquare size={16} className="text-teal-600" />
            ) : report.type === "MINOR_ENHANCEMENT" ? (
              <Zap size={16} className="text-amber-600" />
            ) : report.type === "REGRESSION" ? (
              <RotateCcw size={16} className="text-orange-600" />
            ) : (
              <ShieldCheck size={16} className="text-violet-600" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex min-w-0 items-start gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="shrink-0 font-mono text-xs font-medium text-muted-foreground">
                  {report.ref}
                </span>
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{report.title}</h3>
              </div>
              <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5">
                {!scopedProjectId && report.project ? (
                  <span className="rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[11px] text-foreground">
                    {report.project.name}
                  </span>
                ) : null}
                        {report.sprints?.map((sprint) => {
                          if (sprintContextId && sprint.id === sprintContextId) return null;
                          if (planningSprint && zone === "sprint" && sprint.id === planningSprint.id) return null;
                          return (
                            <span
                              key={sprint.id}
                              className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary"
                              title={t("sprintBadgeTitle")}
                            >
                              <Zap size={9} aria-hidden />
                              {sprint.name}
                            </span>
                          );
                        })}
                <TicketStatusBadge status={report.status} />
                {report.priority ? <TicketPriorityBadge priority={report.priority} /> : null}
                {typeof report.duplicatesCount === "number" && report.duplicatesCount > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300 px-1.5 py-0.5 text-xs text-amber-800">
                    <Link2 size={10} aria-hidden />
                    {t("duplicatesCountBadge", { count: report.duplicatesCount })}
                  </span>
                )}
                {report.parent && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                    {t("parentBadge", { ref: report.parent.ref })}
                  </span>
                )}
                {report.viewerContext === "mentioned" && (
                  <span className="shrink-0 rounded-full border border-primary px-2 py-0.5 text-xs text-primary">
                    {t("mentionedBadge")}
                  </span>
                )}
                {report.assignee && (
                  <span className="shrink-0 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs text-foreground">
                    {t("assigneeCardTag", { name: report.assignee.name ?? report.assignee.email })}
                  </span>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("submittedBy")} {report.user.name ?? report.user.email} ·{" "}
              {new Date(report.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <StoryPointsInlineEdit
                ticketId={report.id}
                storyPoints={report.storyPoints}
                canEdit={canTriage}
                size="list"
                teamId={teamId}
                onPatched={onStoryPointsPatched}
              />
              {report.tags?.map((tag) => (
                <span key={tag.id} className="rounded-full border border-border px-1.5 py-0.5">
                  {tag.name}
                </span>
              ))}
            </div>
            {report.commentsCount > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("commentsCountLabel", { count: report.commentsCount })}
              </p>
            )}
          </div>
        </div>
      </button>
    </>
  );

  if (zone === "single") {
    return (
      <div
        className="flex w-full gap-1 rounded-md border border-border bg-card shadow-(--shadow-1) transition-colors hover:bg-muted"
        onContextMenu={onRowContextMenu}
      >
        {inner}
      </div>
    );
  }

  return (
    <TicketInboxPlanningShell
      ticketId={report.id}
      zone={zone === "sprint" ? "sprint" : "backlog"}
      canDrag={canTriage && planningSplitEnabled}
      stacked={compactPlanningRow}
      onRowContextMenu={onRowContextMenu}
    >
      {inner}
    </TicketInboxPlanningShell>
  );
}
