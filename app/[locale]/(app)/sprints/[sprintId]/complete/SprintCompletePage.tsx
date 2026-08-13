"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import type { SprintApiPayload } from "@/lib/sprint-map";
import type { SprintCompletionPreview } from "@/lib/sprint-completion-types";
import type { TicketRow } from "@/components/tickets/ticket-types";
import { TicketStatusBadge } from "@/components/tickets/TicketDetailView";
import { formatSprintPlanningMetaLine } from "@/lib/sprint-planning-meta";
import { useCurrentTeam } from "@/contexts/CurrentTeamContext";
import { useAppUser } from "@/contexts/AppUserContext";
import { hasTicketTriageAccess } from "@/lib/ticket-triage";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ProjectOption {
  id: string;
  name: string;
}

type CompleteFlowStep = "details" | "extraTickets" | "summary";

const STEP_FLOW: CompleteFlowStep[] = ["details", "extraTickets", "summary"];

const STEP_LABEL_KEYS: Record<CompleteFlowStep, string> = {
  details: "completeProgressStepDetails",
  extraTickets: "completeProgressStepTickets",
  summary: "completeProgressStepSummary",
};

function optionalIntFromInput(s: string): number | undefined {
  const trimmed = s.trim();
  if (trimmed === "") return undefined;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function sumCarryoverStoryPoints(preview: SprintCompletionPreview): number {
  return preview.carryover.reduce((acc, row) => acc + (row.storyPoints ?? 0), 0);
}

function stepIndex(step: CompleteFlowStep): number {
  return STEP_FLOW.indexOf(step);
}

function CompletionProgressBar({
  step,
  t,
}: {
  step: CompleteFlowStep;
  t: ReturnType<typeof useTranslations<"sprints">>;
}): React.ReactElement {
  const activeIdx = stepIndex(step);
  return (
    <nav className="mb-6" aria-label={t("completeProgressAria")}>
      <div className="flex gap-2">
        {STEP_FLOW.map((key, i) => (
          <div key={key} className="flex min-w-0 flex-1 flex-col gap-2">
            <div
              className={cn(
                "h-2 rounded-full transition-colors",
                i <= activeIdx ? "bg-primary" : "bg-muted"
              )}
              aria-hidden
            />
            <span
              className={cn(
                "text-center text-[10px] font-semibold uppercase leading-tight tracking-wide",
                i === activeIdx ? "text-primary" : "text-muted-foreground"
              )}
              aria-current={i === activeIdx ? "step" : undefined}
            >
              {t(STEP_LABEL_KEYS[key])}
            </span>
          </div>
        ))}
      </div>
    </nav>
  );
}

export default function SprintCompletePage({
  params,
}: {
  params: Promise<{ sprintId: string }>;
}): React.ReactElement {
  const { sprintId } = use(params);
  const t = useTranslations("sprints");
  const router = useRouter();
  const user = useAppUser();
  const { currentTeam } = useCurrentTeam();
  const canTriage = hasTicketTriageAccess(user.role, user.specialPermissions);

  const [bootLoading, setBootLoading] = useState(true);
  const [closingSprint, setClosingSprint] = useState<SprintApiPayload | null>(null);
  const [preview, setPreview] = useState<SprintCompletionPreview | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [bootError, setBootError] = useState<string | null>(null);

  const [step, setStep] = useState<CompleteFlowStep>("details");
  const [nextName, setNextName] = useState("");
  const [nextStartDate, setNextStartDate] = useState("");
  const [nextEndDate, setNextEndDate] = useState("");
  const [nextMaxManSprints, setNextMaxManSprints] = useState("");
  const [nextDaysOff, setNextDaysOff] = useState("");
  const [nextCarryOverPts, setNextCarryOverPts] = useState("");
  const [nextPointsPlanned, setNextPointsPlanned] = useState("");
  const [nextGoals, setNextGoals] = useState("");
  const [selectedProjectIds, setSelectedProjectIds] = useState<ReadonlySet<string>>(() => new Set());
  const carryPtsInitialized = useRef(false);

  const [createdSprint, setCreatedSprint] = useState<SprintApiPayload | null>(null);
  const [creating, setCreating] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [cancelNavigating, setCancelNavigating] = useState(false);

  const [ticketRows, setTicketRows] = useState<TicketRow[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [selectedExtraTicketIds, setSelectedExtraTicketIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  const teamParam = currentTeam ? `?team=${encodeURIComponent(currentTeam.teamSlug)}` : "";

  const carryoverIdSet = useMemo(
    () => new Set(preview?.carryover.map((c) => c.id) ?? []),
    [preview]
  );

  const ticketRowsSelectable = useMemo(
    () => ticketRows.filter((r) => !carryoverIdSet.has(r.id)),
    [ticketRows, carryoverIdSet]
  );

  const projectIdsKey = useMemo(() => [...selectedProjectIds].sort().join("\u001f"), [selectedProjectIds]);

  const pointsPlannedNum = useMemo(() => optionalIntFromInput(nextPointsPlanned), [nextPointsPlanned]);

  const selectedExtraPointsTotal = useMemo(() => {
    let n = 0;
    for (const row of ticketRowsSelectable) {
      if (!selectedExtraTicketIds.has(row.id)) continue;
      n += row.storyPoints ?? 0;
    }
    return n;
  }, [ticketRowsSelectable, selectedExtraTicketIds]);

  const selectedExtraRows = useMemo(
    () => ticketRowsSelectable.filter((r) => selectedExtraTicketIds.has(r.id)),
    [ticketRowsSelectable, selectedExtraTicketIds]
  );

  const summaryNextProjectNames = useMemo(
    () =>
      projects
        .filter((p) => selectedProjectIds.has(p.id))
        .map((p) => p.name)
        .join(", "),
    [projects, selectedProjectIds]
  );

  function displayOptionalInt(s: string): string {
    const n = optionalIntFromInput(s);
    return n !== undefined ? String(n) : "—";
  }

  const loadBootstrap = useCallback(async () => {
    setBootLoading(true);
    setBootError(null);
    try {
      const [sRes, pRes, projRes] = await Promise.all([
        fetch(`/api/sprints/${encodeURIComponent(sprintId)}`, { cache: "no-store" }),
        fetch(`/api/sprints/${encodeURIComponent(sprintId)}/complete-preview`, { cache: "no-store" }),
        fetch(`/api/projects${teamParam}`, { cache: "no-store" }),
      ]);

      if (projRes.ok) {
        try {
          const pData = (await projRes.json()) as { projects?: ProjectOption[] };
          setProjects(Array.isArray(pData.projects) ? pData.projects : []);
        } catch {
          setProjects([]);
        }
      } else {
        setProjects([]);
      }

      if (!sRes.ok) {
        if (sRes.status === 404) {
          setBootError("notFound");
        } else if (sRes.status === 401) {
          setBootError("unauthorized");
        } else {
          setBootError("loadFailed");
        }
        setClosingSprint(null);
        setPreview(null);
        return;
      }

      const sprintPayload = (await sRes.json()) as SprintApiPayload;
      setClosingSprint(sprintPayload);

      if (sprintPayload.completedAt) {
        setBootError("alreadyCompleted");
        setPreview(null);
        return;
      }

      if (!pRes.ok) {
        const err = (await pRes.json().catch(() => ({}))) as { error?: string };
        if (pRes.status === 400 && err.error?.includes("already completed")) {
          setBootError("alreadyCompleted");
        } else if (pRes.status === 403) {
          setBootError("forbidden");
        } else {
          setBootError("previewFailed");
          toast.error(err.error?.trim() || t("completePreviewFailed"));
        }
        setPreview(null);
        return;
      }

      const previewData = (await pRes.json()) as SprintCompletionPreview;
      setPreview(previewData);
      setSelectedProjectIds(new Set(sprintPayload.projects.map((p) => p.id)));

      if (!carryPtsInitialized.current) {
        const sum = sumCarryoverStoryPoints(previewData);
        setNextCarryOverPts(sum > 0 ? String(sum) : "");
        const suggested = previewData.velocity + sum;
        if (suggested > 0) setNextPointsPlanned(String(suggested));
        carryPtsInitialized.current = true;
      }
    } catch {
      setBootError("loadFailed");
      setClosingSprint(null);
      setPreview(null);
    } finally {
      setBootLoading(false);
    }
  }, [sprintId, teamParam, t]);

  useEffect(() => {
    if (!canTriage) {
      setBootLoading(false);
      return;
    }
    carryPtsInitialized.current = false;
    void loadBootstrap();
  }, [canTriage, loadBootstrap]);

  useEffect(() => {
    if (step !== "extraTickets") return;
    let cancelled = false;
    void (async () => {
      setTicketsLoading(true);
      try {
        const q = new URLSearchParams();
        if (selectedProjectIds.size > 0) {
          q.set("projectIds", [...selectedProjectIds].join(","));
        }
        const res = await fetch(`/api/tickets?${q.toString()}`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) {
            setTicketRows([]);
            toast.error(t("wizardTicketsLoadFailed"));
          }
          return;
        }
        const data = (await res.json()) as { tickets?: TicketRow[] };
        const list = Array.isArray(data.tickets) ? data.tickets : [];
        if (!cancelled) setTicketRows(list);
      } catch {
        if (!cancelled) {
          setTicketRows([]);
          toast.error(t("wizardTicketsLoadFailed"));
        }
      } finally {
        if (!cancelled) setTicketsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, projectIdsKey, selectedProjectIds, t]);

  useEffect(() => {
    const valid = new Set(ticketRowsSelectable.map((r) => r.id));
    setSelectedExtraTicketIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      if (!changed && next.size === prev.size) return prev;
      return next;
    });
  }, [ticketRowsSelectable]);

  useEffect(() => {
    if (step === "summary" && !createdSprint?.id) {
      setStep("details");
    }
  }, [step, createdSprint?.id]);

  function toggleProject(id: string): void {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllProjects(): void {
    setSelectedProjectIds(new Set(projects.map((p) => p.id)));
  }

  function clearProjectSelection(): void {
    setSelectedProjectIds(new Set());
  }

  function toggleExtraTicket(id: string): void {
    setSelectedExtraTicketIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllExtraTickets(): void {
    setSelectedExtraTicketIds(new Set(ticketRowsSelectable.map((r) => r.id)));
  }

  function deselectAllExtraTickets(): void {
    setSelectedExtraTicketIds(new Set());
  }

  function buildNextSprintBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      name: nextName.trim(),
      projectIds: [...selectedProjectIds],
    };
    body.startDate = nextStartDate.trim() ? nextStartDate.trim() : null;
    body.endDate = nextEndDate.trim() ? nextEndDate.trim() : null;
    const mm = optionalIntFromInput(nextMaxManSprints);
    body.maxManSprints = mm !== undefined ? mm : null;
    const doff = optionalIntFromInput(nextDaysOff);
    body.daysOff = doff !== undefined ? doff : 0;
    const co = optionalIntFromInput(nextCarryOverPts);
    body.carryOverPoints = co !== undefined ? co : null;
    const pp = optionalIntFromInput(nextPointsPlanned);
    body.pointsPlanned = pp !== undefined ? pp : null;
    body.goals = nextGoals.trim() ? nextGoals.trim() : null;
    return body;
  }

  async function submitDetailsContinue(): Promise<void> {
    if (!closingSprint || !preview) return;
    const trimmedName = nextName.trim();
    if (!trimmedName) {
      toast.error(t("hintDisabledNeedName"));
      return;
    }
    if (selectedProjectIds.size === 0) {
      toast.error(t("projectsRequired"));
      return;
    }
    if (nextStartDate.trim() && nextEndDate.trim() && nextEndDate.trim() < nextStartDate.trim()) {
      toast.error(t("invalidDateRange"));
      return;
    }

    setCreating(true);
    try {
      const body = buildNextSprintBody();

      if (!createdSprint?.id) {
        const res = await fetch(`/api/sprints${teamParam}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(errBody.error?.trim() || t("createFailed"));
          return;
        }
        const created = (await res.json()) as SprintApiPayload;
        setCreatedSprint(created);
        toast.success(t("createSuccess"));
      } else {
        const res = await fetch(`/api/sprints/${encodeURIComponent(createdSprint.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(errBody.error?.trim() || t("saveFailed"));
          return;
        }
        const updated = (await res.json()) as SprintApiPayload;
        setCreatedSprint(updated);
        toast.success(t("saveSuccess"));
      }

      setStep("extraTickets");
    } catch {
      toast.error(t("createFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function handleCancelLeave(): Promise<void> {
    setCancelNavigating(true);
    try {
      if (createdSprint?.id) {
        const res = await fetch(`/api/sprints/${encodeURIComponent(createdSprint.id)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          toast.error(t("completeDeleteDraftFailed"));
          return;
        }
      }
      router.push("/sprints");
    } catch {
      toast.error(t("completeDeleteDraftFailed"));
    } finally {
      setCancelNavigating(false);
    }
  }

  async function submitComplete(): Promise<void> {
    if (!createdSprint?.id) return;
    setCompleting(true);
    try {
      const extras = [...selectedExtraTicketIds];
      const res = await fetch(`/api/sprints/${encodeURIComponent(sprintId)}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nextSprintId: createdSprint.id,
          ...(extras.length > 0 ? { additionalNextSprintTicketIds: extras } : {}),
        }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(errBody.error?.trim() || t("completeFailed"));
        return;
      }
      toast.success(t("completeSuccess"));
      router.push("/sprints");
    } catch {
      toast.error(t("completeFailed"));
    } finally {
      setCompleting(false);
    }
  }

  function subtitleForStep(): string {
    switch (step) {
      case "details":
        return t("completePageStep1Title");
      case "extraTickets":
        return t("completePageStep2Title");
      default:
        return t("completePageStep3Title");
    }
  }

  const planningFieldsDetails = (
    <div className="border-t border-border pt-3">
      <p className="mb-3 text-xs font-medium text-muted-foreground">{t("planningSection")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("fieldStartDate")}</span>
          <input
            type="date"
            value={nextStartDate}
            onChange={(e) => setNextStartDate(e.target.value)}
            className="min-h-(--input-height) rounded-sm border border-border bg-background px-2 text-sm shadow-(--shadow-1)"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("fieldEndDate")}</span>
          <input
            type="date"
            value={nextEndDate}
            onChange={(e) => setNextEndDate(e.target.value)}
            className="min-h-(--input-height) rounded-sm border border-border bg-background px-2 text-sm shadow-(--shadow-1)"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("fieldMaxManSprints")}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={nextMaxManSprints}
            onChange={(e) => setNextMaxManSprints(e.target.value)}
            className="min-h-(--input-height) rounded-sm border border-border bg-background px-3 text-sm shadow-(--shadow-1)"
            placeholder="—"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("fieldDaysOff")}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={nextDaysOff}
            onChange={(e) => setNextDaysOff(e.target.value)}
            className="min-h-(--input-height) rounded-sm border border-border bg-background px-3 text-sm shadow-(--shadow-1)"
            placeholder="0"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("fieldCarryOver")}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={nextCarryOverPts}
            onChange={(e) => setNextCarryOverPts(e.target.value)}
            className="min-h-(--input-height) rounded-sm border border-border bg-background px-3 text-sm shadow-(--shadow-1)"
            placeholder="—"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("fieldPointsPlanned")}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={nextPointsPlanned}
            onChange={(e) => setNextPointsPlanned(e.target.value)}
            className="min-h-(--input-height) rounded-sm border border-border bg-background px-3 text-sm shadow-(--shadow-1)"
            placeholder="—"
          />
        </label>
      </div>
      <label className="mt-3 flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("fieldSprintGoals")}</span>
        <textarea
          value={nextGoals}
          onChange={(e) => setNextGoals(e.target.value)}
          rows={4}
          maxLength={8000}
          placeholder={t("goalsPlaceholder")}
          className="min-h-24 resize-y rounded-sm border border-border bg-background px-3 py-2 text-sm shadow-(--shadow-1)"
        />
      </label>
      <p className="mt-2 text-[11px] text-muted-foreground">{t("planningHint")}</p>
    </div>
  );

  if (!canTriage) {
    return (
      <div
        className="py-(--page-padding-y)"
        style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
      >
        <p className="text-sm text-muted-foreground">{t("completePageForbidden")}</p>
        <Link href="/sprints" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
          {t("backToSprintList")}
        </Link>
      </div>
    );
  }

  if (bootLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (bootError === "notFound") {
    return (
      <div
        className="py-(--page-padding-y)"
        style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
      >
        <p className="text-sm text-muted-foreground">{t("completePageNotFound")}</p>
        <Link href="/sprints" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
          {t("backToSprintList")}
        </Link>
      </div>
    );
  }

  if (bootError === "alreadyCompleted") {
    return (
      <div
        className="py-(--page-padding-y)"
        style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
      >
        <p className="text-sm text-muted-foreground">{t("completePageAlreadyCompleted")}</p>
        <Link href="/sprints" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
          {t("backToSprintList")}
        </Link>
      </div>
    );
  }

  if (bootError === "forbidden" || bootError === "unauthorized") {
    return (
      <div
        className="py-(--page-padding-y)"
        style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
      >
        <p className="text-sm text-muted-foreground">{t("completePageForbidden")}</p>
        <Link href="/sprints" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
          {t("backToSprintList")}
        </Link>
      </div>
    );
  }

  if (bootError || !closingSprint || !preview) {
    return (
      <div
        className="py-(--page-padding-y)"
        style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
      >
        <p className="text-sm text-muted-foreground">{t("completePageLoadFailed")}</p>
        <Link href="/sprints" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
          {t("backToSprintList")}
        </Link>
      </div>
    );
  }

  const planningMetaClosing = formatSprintPlanningMetaLine(closingSprint, t);
  const carryPtSum = sumCarryoverStoryPoints(preview);

  return (
    <div
      className="py-(--page-padding-y)"
      style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
    >
      <CompletionProgressBar step={step} t={t} />

      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">{t("completePageTitle", { name: closingSprint.name })}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitleForStep()}</p>
      </div>

      {step === "details" ? (
        <div className="w-full">
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 shadow-(--shadow-1)">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">{t("completeNewSprintName")}</span>
              <input
                value={nextName}
                onChange={(e) => setNextName(e.target.value)}
                className="min-h-(--input-height) rounded-sm border border-border bg-background px-3 text-sm shadow-(--shadow-1)"
                maxLength={120}
                placeholder={t("sprintNamePlaceholder")}
              />
            </label>

            {planningFieldsDetails}

            <fieldset className="min-w-0 border-t border-border pt-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <legend className="text-xs font-medium text-muted-foreground">{t("projectsInSprint")}</legend>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                    onClick={selectAllProjects}
                  >
                    {t("selectAllProjects")}
                  </button>
                  <button
                    type="button"
                    className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                    onClick={clearProjectSelection}
                  >
                    {t("clearProjectSelection")}
                  </button>
                </div>
              </div>
              <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto rounded-sm border border-border p-2">
                {projects.map((p) => (
                  <li key={p.id}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedProjectIds.has(p.id)}
                        onChange={() => toggleProject(p.id)}
                        className="rounded border-border"
                      />
                      <span>{p.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <button
                type="button"
                className="rounded-sm border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
                disabled={cancelNavigating || creating}
                onClick={() => void handleCancelLeave()}
              >
                {cancelNavigating ? t("completePageBacking") : t("completePageCancel")}
              </button>
              <button
                type="button"
                className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                disabled={creating || !nextName.trim() || selectedProjectIds.size === 0}
                onClick={() => void submitDetailsContinue()}
              >
                {creating ? t("creating") : t("completePageCreateContinue")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {step === "extraTickets" ? (
        <div className="flex flex-col gap-6">
          <p className="text-sm text-muted-foreground">{t("completeExtraTicketsHint")}</p>
          <div className="rounded-lg border border-border bg-card p-5 shadow-(--shadow-1)">
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <p className="font-medium text-foreground">{t("wizardSelectionSummary")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("wizardSelectedTicketsPoints", {
                  count: selectedExtraTicketIds.size,
                  points: selectedExtraPointsTotal,
                })}
              </p>
              {pointsPlannedNum !== undefined ? (
                <p className="mt-1 text-xs text-muted-foreground">{t("wizardPointsPlannedOnly", { planned: pointsPlannedNum })}</p>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-sm border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                onClick={selectAllExtraTickets}
                disabled={ticketsLoading || ticketRowsSelectable.length === 0}
              >
                {t("wizardSelectAllTickets")}
              </button>
              <button
                type="button"
                className="rounded-sm border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                onClick={deselectAllExtraTickets}
                disabled={ticketsLoading || ticketRowsSelectable.length === 0}
              >
                {t("wizardDeselectAllTickets")}
              </button>
            </div>
            {ticketsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : ticketRowsSelectable.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("wizardNoTickets")}</p>
            ) : (
              <ul className="mt-3 flex max-h-[min(52vh,420px)] flex-col gap-1 overflow-y-auto rounded-sm border border-border p-2">
                {ticketRowsSelectable.map((row) => (
                  <li key={row.id}>
                    <label className="flex cursor-pointer gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted/60">
                      <input
                        type="checkbox"
                        checked={selectedExtraTicketIds.has(row.id)}
                        onChange={() => toggleExtraTicket(row.id)}
                        className="mt-0.5 rounded border-border"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-mono text-xs text-muted-foreground">{row.ref}</span>{" "}
                        <span className="text-foreground">{row.title}</span>
                        {row.project ? (
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">{row.project.name}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {row.storyPoints != null ? `${row.storyPoints} pts` : "—"}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-sm border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              onClick={() => setStep("details")}
            >
              {t("completePageBack")}
            </button>
            <button
              type="button"
              className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              onClick={() => setStep("summary")}
            >
              {t("completePageNext")}
            </button>
          </div>
        </div>
      ) : null}

      {step === "summary" && createdSprint ? (
        <div className="flex flex-col gap-6">
          <p className="text-sm text-muted-foreground">{t("completeSummaryPageHeading")}</p>

          <section className="rounded-lg border border-border bg-card p-5 shadow-(--shadow-1)" aria-labelledby="summary-next-sprint">
            <h2 id="summary-next-sprint" className="mb-3 text-sm font-semibold text-foreground">{t("completeSummaryNextSprintHeading")}</h2>
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">{t("sprintName")}</dt>
                <dd className="font-medium text-foreground">{nextName.trim() || createdSprint.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("fieldPointsPlanned")}</dt>
                <dd className="text-foreground">{displayOptionalInt(nextPointsPlanned)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">{t("fieldSprintGoals")}</dt>
                <dd className="whitespace-pre-wrap text-foreground">{nextGoals.trim() || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("fieldStartDate")}</dt>
                <dd className="text-foreground">{nextStartDate.trim() || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("fieldEndDate")}</dt>
                <dd className="text-foreground">{nextEndDate.trim() || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("fieldMaxManSprints")}</dt>
                <dd className="text-foreground">{displayOptionalInt(nextMaxManSprints)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("fieldDaysOff")}</dt>
                <dd className="text-foreground">{displayOptionalInt(nextDaysOff)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("fieldCarryOver")}</dt>
                <dd className="text-foreground">{displayOptionalInt(nextCarryOverPts)}</dd>
              </div>
            </dl>
            <div className="mt-4 rounded-md border border-border bg-muted/30 px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">{t("projectsInSprint")}</p>
              <p className="mt-1 text-foreground">{summaryNextProjectNames || "—"}</p>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-(--shadow-1)">
            <h2 className="mb-3 text-sm font-semibold text-foreground">{t("completeSummaryClosingHeading")}</h2>
            <p className="text-sm font-medium text-foreground">{closingSprint.name}</p>
            {planningMetaClosing ? (
              <p className="mt-1 text-xs tabular-nums text-muted-foreground">{planningMetaClosing}</p>
            ) : null}
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-(--shadow-1)">
            <h2 className="mb-3 text-sm font-semibold text-foreground">{t("completeSummaryHeading")}</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t("completeSummaryDone")}</p>
                <p className="mt-1 text-sm text-foreground">{t("completeSummaryTickets", { count: preview.doneTicketCount })}</p>
                <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">{t("completeSummaryPoints", { points: preview.velocity })}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t("completeSummaryCarryover")}</p>
                <p className="mt-1 text-sm text-foreground">{t("completeSummaryTickets", { count: preview.carryover.length })}</p>
                <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">{t("completeSummaryPoints", { points: carryPtSum })}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t("completeSummaryInto")}</p>
                <p className="mt-1 text-sm font-medium text-foreground">{nextName.trim() || createdSprint?.name || "—"}</p>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-(--shadow-1)">
            <h2 className="mb-3 text-sm font-semibold text-foreground">{t("completeCarryoverTableHeading")}</h2>
            {preview.carryover.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("completeDialogCarryoverEmpty")}</p>
            ) : (
              <div className="max-h-[min(36vh,280px)] overflow-auto rounded-sm border border-border">
                <table className="w-full min-w-[480px] border-collapse text-sm">
                  <thead className="sticky top-0 bg-muted/80">
                    <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                      <th className="px-3 py-2">{t("completeTableRef")}</th>
                      <th className="px-3 py-2">{t("completeTableTitle")}</th>
                      <th className="px-3 py-2">{t("completeTableStatus")}</th>
                      <th className="px-3 py-2 text-right">{t("completeTablePoints")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.carryover.map((row) => (
                      <tr key={row.id} className="border-b border-border last:border-0">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">{row.ref}</td>
                        <td className="max-w-[200px] truncate px-3 py-2 text-foreground">{row.title}</td>
                        <td className="px-3 py-2">
                          <TicketStatusBadge status={row.status} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {row.storyPoints != null ? row.storyPoints : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-(--shadow-1)">
            <h2 className="mb-3 text-sm font-semibold text-foreground">{t("completeSummaryExtraTicketsHeading")}</h2>
            {selectedExtraRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("completeSummaryExtraTicketsEmpty")}</p>
            ) : (
              <div className="max-h-[min(36vh,280px)] overflow-auto rounded-sm border border-border">
                <table className="w-full min-w-[480px] border-collapse text-sm">
                  <thead className="sticky top-0 bg-muted/80">
                    <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                      <th className="px-3 py-2">{t("completeTableRef")}</th>
                      <th className="px-3 py-2">{t("completeTableTitle")}</th>
                      <th className="px-3 py-2">{t("completeTableStatus")}</th>
                      <th className="px-3 py-2 text-right">{t("completeTablePoints")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedExtraRows.map((row) => (
                      <tr key={row.id} className="border-b border-border last:border-0">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">{row.ref}</td>
                        <td className="max-w-[200px] truncate px-3 py-2 text-foreground">{row.title}</td>
                        <td className="px-3 py-2">
                          <TicketStatusBadge status={row.status} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {row.storyPoints != null ? row.storyPoints : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-sm border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
              disabled={completing}
              onClick={() => setStep("extraTickets")}
            >
              {t("completePageBack")}
            </button>
            <button
              type="button"
              className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              disabled={completing}
              onClick={() => void submitComplete()}
            >
              {completing ? t("completing") : t("completeDialogConfirm")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
