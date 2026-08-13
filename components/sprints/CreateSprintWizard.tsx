"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { useCurrentTeam } from "@/contexts/CurrentTeamContext";
import type { TicketRow } from "@/components/tickets/ticket-types";
import {
  clearSprintCreateDraft,
  readSprintCreateDraft,
  writeSprintCreateDraft,
  type SprintCreateWizardStep,
} from "@/lib/sprint-create-draft";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export interface CreateSprintWizardProject {
  id: string;
  name: string;
}

interface CreateSprintWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: CreateSprintWizardProject[];
  onCreated: () => void | Promise<void>;
}

function optionalIntFromInput(s: string): number | undefined {
  const trimmed = s.trim();
  if (trimmed === "") return undefined;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function CreateSprintWizard({
  open,
  onOpenChange,
  projects,
  onCreated,
}: CreateSprintWizardProps): React.ReactElement {
  const t = useTranslations("sprints");
  const { currentTeam } = useCurrentTeam();
  const [step, setStep] = useState<SprintCreateWizardStep>("details");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [maxManSprints, setMaxManSprints] = useState("");
  const [daysOff, setDaysOff] = useState("");
  const [carryOverPoints, setCarryOverPoints] = useState("");
  const [pointsPlanned, setPointsPlanned] = useState("");
  const [goals, setGoals] = useState("");
  const [selectedProjectIds, setSelectedProjectIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedTicketIds, setSelectedTicketIds] = useState<ReadonlySet<string>>(() => new Set());
  const [ticketRows, setTicketRows] = useState<TicketRow[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const lastOpen = useRef(false);

  const resetForm = useCallback(() => {
    setStep("details");
    setName("");
    setStartDate("");
    setEndDate("");
    setMaxManSprints("");
    setDaysOff("");
    setCarryOverPoints("");
    setPointsPlanned("");
    setGoals("");
    setSelectedProjectIds(new Set());
    setSelectedTicketIds(new Set());
    setTicketRows([]);
  }, []);

  const hydrateFromDraft = useCallback(
    (d: import("@/lib/sprint-create-draft").SprintCreateDraftV1) => {
      const validProjectIds = new Set(projects.map((p) => p.id));
      const proj = d.selectedProjectIds.filter((id) => validProjectIds.has(id));
      setStep(d.step);
      setName(d.name);
      setStartDate(d.startDate);
      setEndDate(d.endDate);
      setMaxManSprints(d.maxManSprints);
      setDaysOff(d.daysOff);
      setCarryOverPoints(d.carryOverPoints);
      setPointsPlanned(d.pointsPlanned);
      setGoals(d.goals);
      setSelectedProjectIds(new Set(proj));
      setSelectedTicketIds(new Set(d.selectedTicketIds));
      setTicketRows([]);
    },
    [projects]
  );

  useEffect(() => {
    if (open && !lastOpen.current) {
      const d = readSprintCreateDraft();
      if (d) hydrateFromDraft(d);
      else resetForm();
    }
    lastOpen.current = open;
  }, [open, hydrateFromDraft, resetForm]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      writeSprintCreateDraft({
        v: 1,
        step,
        name,
        startDate,
        endDate,
        maxManSprints,
        daysOff,
        carryOverPoints,
        pointsPlanned,
        goals,
        selectedProjectIds: [...selectedProjectIds],
        selectedTicketIds: [...selectedTicketIds],
        savedAt: Date.now(),
      });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [
    open,
    step,
    name,
    startDate,
    endDate,
    maxManSprints,
    daysOff,
    carryOverPoints,
    pointsPlanned,
    goals,
    selectedProjectIds,
    selectedTicketIds,
  ]);

  const projectIdsKey = useMemo(() => [...selectedProjectIds].sort().join("\u001f"), [selectedProjectIds]);

  useEffect(() => {
    if (!open || step !== "tickets") return;
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
  }, [open, step, projectIdsKey, selectedProjectIds, t]);

  useEffect(() => {
    const valid = new Set(ticketRows.map((r) => r.id));
    setSelectedTicketIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      if (!changed && next.size === prev.size) return prev;
      return next;
    });
  }, [ticketRows]);

  const pointsPlannedNum = useMemo(() => optionalIntFromInput(pointsPlanned), [pointsPlanned]);

  const selectedPointsTotal = useMemo(() => {
    let n = 0;
    for (const row of ticketRows) {
      if (!selectedTicketIds.has(row.id)) continue;
      n += row.storyPoints ?? 0;
    }
    return n;
  }, [ticketRows, selectedTicketIds]);

  const selectedTicketCount = selectedTicketIds.size;

  const detailsNextDisabled = !name.trim();
  const detailsNextHint = useMemo((): string | null => {
    if (!name.trim()) return t("hintDisabledNeedName");
    return null;
  }, [name, t]);

  function toggleProject(id: string): void {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTicket(id: string): void {
    setSelectedTicketIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllTickets(): void {
    setSelectedTicketIds(new Set(ticketRows.map((r) => r.id)));
  }

  function deselectAllTickets(): void {
    setSelectedTicketIds(new Set());
  }

  function goNextFromDetails(): void {
    if (startDate.trim() && endDate.trim() && endDate.trim() < startDate.trim()) {
      toast.error(t("invalidDateRange"));
      return;
    }
    if (detailsNextDisabled) {
      if (detailsNextHint) toast.error(detailsNextHint);
      return;
    }
    setStep("tickets");
  }

  function goNextFromTickets(): void {
    if (selectedTicketIds.size === 0) {
      toast.error(t("wizardSelectAtLeastOneTicket"));
      return;
    }
    setStep("summary");
  }

  async function submitCreate(): Promise<void> {
    if (selectedTicketIds.size === 0) {
      toast.error(t("wizardSelectAtLeastOneTicket"));
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        name: trimmed,
        ticketIds: [...selectedTicketIds],
      };
      if (selectedProjectIds.size > 0) {
        body.projectIds = [...selectedProjectIds];
      }
      if (startDate.trim()) body.startDate = startDate.trim();
      if (endDate.trim()) body.endDate = endDate.trim();
      const mm = optionalIntFromInput(maxManSprints);
      if (mm !== undefined) body.maxManSprints = mm;
      const doff = optionalIntFromInput(daysOff);
      body.daysOff = doff !== undefined ? doff : 0;
      const co = optionalIntFromInput(carryOverPoints);
      if (co !== undefined) body.carryOverPoints = co;
      const pp = optionalIntFromInput(pointsPlanned);
      if (pp !== undefined) body.pointsPlanned = pp;
      const g = goals.trim();
      if (g.length > 0) body.goals = g;

      const res = await fetch(`/api/sprints${currentTeam ? `?team=${encodeURIComponent(currentTeam.teamSlug)}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      let parsed: { error?: string } | null = null;
      try {
        parsed = JSON.parse(raw) as { error?: string };
      } catch {
        parsed = null;
      }
      if (!res.ok) {
        const fromJson = parsed?.error?.trim();
        const fallback =
          raw.trim().length > 0 && raw.trim().length < 400 && !raw.trim().startsWith("<")
            ? raw.trim()
            : undefined;
        toast.error(fromJson || fallback || t("createFailed"));
        return;
      }
      toast.success(t("createSuccess"));
      clearSprintCreateDraft();
      resetForm();
      onOpenChange(false);
      await onCreated();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : null;
      toast.error(msg && msg.length < 400 ? msg : t("createFailed"));
    } finally {
      setCreating(false);
    }
  }

  function handleDiscardDraft(): void {
    clearSprintCreateDraft();
    resetForm();
    toast(t("wizardDraftDiscarded"));
  }

  function handleDialogOpenChange(next: boolean): void {
    onOpenChange(next);
    if (!next) {
      setTicketRows([]);
    }
  }

  const planningFields = (
    <div className="border-t border-border pt-3">
      <p className="mb-3 text-xs font-medium text-muted-foreground">{t("planningSection")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("fieldStartDate")}</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="min-h-(--input-height) rounded-sm border border-border bg-background px-2 text-sm shadow-(--shadow-1)"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("fieldEndDate")}</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="min-h-(--input-height) rounded-sm border border-border bg-background px-2 text-sm shadow-(--shadow-1)"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("fieldMaxManSprints")}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={maxManSprints}
            onChange={(e) => setMaxManSprints(e.target.value)}
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
            value={daysOff}
            onChange={(e) => setDaysOff(e.target.value)}
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
            value={carryOverPoints}
            onChange={(e) => setCarryOverPoints(e.target.value)}
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
            value={pointsPlanned}
            onChange={(e) => setPointsPlanned(e.target.value)}
            className="min-h-(--input-height) rounded-sm border border-border bg-background px-3 text-sm shadow-(--shadow-1)"
            placeholder="—"
          />
        </label>
      </div>
      <label className="mt-3 flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("fieldSprintGoals")}</span>
        <textarea
          value={goals}
          onChange={(e) => setGoals(e.target.value)}
          rows={4}
          maxLength={8000}
          placeholder={t("goalsPlaceholder")}
          className="min-h-24 resize-y rounded-sm border border-border bg-background px-3 py-2 text-sm shadow-(--shadow-1)"
        />
      </label>
      <p className="mt-2 text-[11px] text-muted-foreground">{t("planningHint")}</p>
    </div>
  );

  const stepper = (
    <div className="mb-4 flex flex-wrap gap-2 border-b border-border pb-3 text-xs">
      <span
        className={
          step === "details"
            ? "font-semibold text-foreground"
            : "font-medium text-muted-foreground"
        }
      >
        1 — {t("wizardStepDetails")}
      </span>
      <span className="text-muted-foreground">·</span>
      <span
        className={
          step === "tickets"
            ? "font-semibold text-foreground"
            : "font-medium text-muted-foreground"
        }
      >
        2 — {t("wizardStepTickets")}
      </span>
      <span className="text-muted-foreground">·</span>
      <span
        className={
          step === "summary"
            ? "font-semibold text-foreground"
            : "font-medium text-muted-foreground"
        }
      >
        3 — {t("wizardStepSummary")}
      </span>
    </div>
  );

  const title =
    step === "details"
      ? t("wizardTitleDetails")
      : step === "tickets"
        ? t("wizardTitleTickets")
        : t("wizardTitleSummary");

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-h-[min(92dvh,800px)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="space-y-2 pr-12 text-left sm:pr-14">
          <DialogTitle className="leading-snug">{title}</DialogTitle>
          <p className="text-[11px] text-muted-foreground">{t("wizardDraftHint")}</p>
        </DialogHeader>

        {stepper}

        {step === "details" ? (
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="wizard-sprint-name" className="mb-1 block text-xs text-muted-foreground">
                {t("sprintName")}
              </label>
              <input
                id="wizard-sprint-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="min-h-(--input-height) w-full rounded-sm border border-border bg-background px-3 text-sm shadow-(--shadow-1)"
                placeholder={t("sprintNamePlaceholder")}
                maxLength={120}
              />
            </div>
            {planningFields}
            <fieldset className="min-w-0" aria-label={t("projectsInSprint")}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">{t("projectsInSprint")} <span className="font-normal text-muted-foreground/70">({t("optional")})</span></span>
                {projects.length > 0 ? (
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      className="font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => setSelectedProjectIds(new Set(projects.map((p) => p.id)))}
                    >
                      {t("selectAllProjects")}
                    </button>
                    <button
                      type="button"
                      className="font-medium text-muted-foreground underline-offset-2 hover:underline"
                      onClick={() => setSelectedProjectIds(new Set())}
                    >
                      {t("clearProjectSelection")}
                    </button>
                  </div>
                ) : null}
              </div>
              {projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noProjectsHint")}</p>
              ) : (
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
              )}
            </fieldset>
          </div>
        ) : null}

        {step === "tickets" ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <p className="font-medium text-foreground">{t("wizardSelectionSummary")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("wizardSelectedTicketsPoints", {
                  count: selectedTicketCount,
                  points: selectedPointsTotal,
                })}
              </p>
              {pointsPlannedNum !== undefined ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("wizardPointsPlannedOnly", { planned: pointsPlannedNum })}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-sm border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                onClick={selectAllTickets}
                disabled={ticketsLoading || ticketRows.length === 0}
              >
                {t("wizardSelectAllTickets")}
              </button>
              <button
                type="button"
                className="rounded-sm border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                onClick={deselectAllTickets}
                disabled={ticketsLoading || ticketRows.length === 0}
              >
                {t("wizardDeselectAllTickets")}
              </button>
            </div>
            {ticketsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : ticketRows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("wizardNoTickets")}</p>
            ) : (
              <ul className="flex max-h-[min(52vh,420px)] flex-col gap-1 overflow-y-auto rounded-sm border border-border p-2">
                {ticketRows.map((row) => (
                  <li key={row.id}>
                    <label className="flex cursor-pointer gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted/60">
                      <input
                        type="checkbox"
                        checked={selectedTicketIds.has(row.id)}
                        onChange={() => toggleTicket(row.id)}
                        className="mt-0.5 rounded border-border"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-mono text-xs text-muted-foreground">RAD-{row.shortId}</span>{" "}
                        <span className="text-foreground">{row.title}</span>
                        {row.project ? (
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {row.project.name}
                          </span>
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
        ) : null}

        {step === "summary" ? (
          <div className="flex flex-col gap-3 text-sm">
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">{t("sprintName")}</dt>
                <dd className="font-medium text-foreground">{name.trim() || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("fieldPointsPlanned")}</dt>
                <dd className="text-foreground">{pointsPlanned.trim() || "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">{t("fieldSprintGoals")}</dt>
                <dd className="whitespace-pre-wrap text-foreground">{goals.trim() || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("fieldStartDate")}</dt>
                <dd className="text-foreground">{startDate || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("fieldEndDate")}</dt>
                <dd className="text-foreground">{endDate || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("fieldMaxManSprints")}</dt>
                <dd className="text-foreground">{maxManSprints.trim() || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("fieldDaysOff")}</dt>
                <dd className="text-foreground">{daysOff.trim() || "0"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("fieldCarryOver")}</dt>
                <dd className="text-foreground">{carryOverPoints.trim() || "—"}</dd>
              </div>
            </dl>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">{t("projectsInSprint")}</p>
              <p className="mt-1 text-foreground">
                {projects
                  .filter((p) => selectedProjectIds.has(p.id))
                  .map((p) => p.name)
                  .join(", ") || "—"}
              </p>
            </div>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">{t("wizardSummaryTickets")}</p>
              <p className="mt-1 text-foreground">
                {t("wizardSelectedTicketsPoints", {
                  count: selectedTicketCount,
                  points: selectedPointsTotal,
                })}
              </p>
            </div>
          </div>
        ) : null}

        {step === "details" && detailsNextDisabled && detailsNextHint ? (
          <p className="text-xs text-muted-foreground">{detailsNextHint}</p>
        ) : null}

        <DialogFooter className="mt-2 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-sm px-2 py-1.5 text-xs font-medium text-muted-foreground underline-offset-2 hover:bg-muted/80 hover:text-foreground hover:underline"
              disabled={creating}
              onClick={handleDiscardDraft}
            >
              {t("wizardDiscardDraft")}
            </button>
            {step !== "details" ? (
              <button
                type="button"
                className="rounded-sm border border-border px-3 py-2 text-sm"
                disabled={creating}
                onClick={() => setStep(step === "summary" ? "tickets" : "details")}
              >
                {t("wizardBack")}
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="rounded-sm border border-border px-3 py-2 text-sm"
              disabled={creating}
              onClick={() => handleDialogOpenChange(false)}
            >
              {t("cancel")}
            </button>
            {step === "details" ? (
              <button
                type="button"
                className="rounded-sm bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                disabled={detailsNextDisabled}
                title={detailsNextDisabled && detailsNextHint ? detailsNextHint : undefined}
                onClick={goNextFromDetails}
              >
                {t("wizardNext")}
              </button>
            ) : null}
            {step === "tickets" ? (
              <button
                type="button"
                className="rounded-sm bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                disabled={selectedTicketIds.size === 0}
                onClick={goNextFromTickets}
              >
                {t("wizardNext")}
              </button>
            ) : null}
            {step === "summary" ? (
              <button
                type="button"
                className="rounded-sm bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                disabled={creating}
                onClick={() => void submitCreate()}
              >
                {creating ? t("creating") : t("create")}
              </button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
