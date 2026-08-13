"use client";

import { use, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { SprintApiPayload } from "@/lib/sprint-map";
import { isSprintDraft, isSprintOverdue, isSprintRunning } from "@/lib/sprint-active";
import { SprintActiveTag } from "@/components/sprints/SprintActiveTag";
import { SprintCompletedTag } from "@/components/sprints/SprintCompletedTag";
import { SprintOverdueTag } from "@/components/sprints/SprintOverdueTag";
import { SprintDraftTag } from "@/components/sprints/SprintDraftTag";
import { TicketsWorkspace } from "@/components/tickets/TicketsWorkspace";
import { Link } from "@/i18n/navigation";
import { useAppUser } from "@/contexts/AppUserContext";
import { hasTicketTriageAccess } from "@/lib/ticket-triage";

export default function SprintBoardPage({ params }: { params: Promise<{ sprintId: string }> }) {
  const { sprintId } = use(params);
  const t = useTranslations("sprints");
  const user = useAppUser();
  const canTriage = hasTicketTriageAccess(user.role, user.specialPermissions);
  const [sprint, setSprint] = useState<SprintApiPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/sprints/${encodeURIComponent(sprintId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as SprintApiPayload;
        if (!cancelled) {
          setSprint(data);
        }
      } catch {
        /* silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sprintId]);

  const displayName = sprint?.name?.trim() || "…";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className="shrink-0 border-b border-border bg-muted/30 py-3"
        style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">{displayName}</h1>
            {sprint?.completedAt ? <SprintCompletedTag className="translate-y-px" /> : null}
            {!sprint?.completedAt && sprint && isSprintRunning(sprint) ? (
              <SprintActiveTag className="translate-y-px" />
            ) : null}
            {!sprint?.completedAt && sprint && isSprintOverdue(sprint) ? (
              <SprintOverdueTag className="translate-y-px" />
            ) : null}
            {!sprint?.completedAt && sprint && isSprintDraft(sprint) ? (
              <SprintDraftTag className="translate-y-px" />
            ) : null}
          </div>
          {sprint && canTriage && !sprint.completedAt ? (
            <Link
              href={`/sprints/${sprintId}/complete`}
              className="shrink-0 rounded-sm border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              {t("completeSprintOpen")}
            </Link>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t("boardSubtitle")}</p>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TicketsWorkspace
          sprintId={sprintId}
          defaultView="board"
          hideTagFilter
          hideListView
        />
      </div>
    </div>
  );
}
