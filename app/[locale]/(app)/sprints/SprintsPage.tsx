"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { SprintApiPayload } from "@/lib/sprint-map";
import { isSprintDraft, isSprintOverdue, isSprintRunning } from "@/lib/sprint-active";
import { formatSprintPlanningMetaLine } from "@/lib/sprint-planning-meta";
import { CreateSprintWizard } from "@/components/sprints/CreateSprintWizard";
import { useAppUser } from "@/contexts/AppUserContext";
import { useCurrentTeam } from "@/contexts/CurrentTeamContext";
import { hasTicketTriageAccess } from "@/lib/ticket-triage";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { SprintActiveTag } from "@/components/sprints/SprintActiveTag";
import { SprintCompletedTag } from "@/components/sprints/SprintCompletedTag";
import { SprintOverdueTag } from "@/components/sprints/SprintOverdueTag";
import { SprintDraftTag } from "@/components/sprints/SprintDraftTag";

interface ProjectOption {
  id: string;
  name: string;
}

type SprintRow = SprintApiPayload;

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function optionalIntFromInput(s: string): number | undefined {
  const trimmed = s.trim();
  if (trimmed === "") return undefined;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export default function SprintsPage(): React.ReactElement {
  const t = useTranslations("sprints");
  const user = useAppUser();
  const { currentTeam } = useCurrentTeam();
  const canTriage = hasTicketTriageAccess(user.role, user.specialPermissions);
  const [sprints, setSprints] = useState<SprintRow[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editMaxManSprints, setEditMaxManSprints] = useState("");
  const [editDaysOff, setEditDaysOff] = useState("");
  const [editCarryOverPoints, setEditCarryOverPoints] = useState("");
  const [editPointsPlanned, setEditPointsPlanned] = useState("");
  const [editGoals, setEditGoals] = useState("");
  const [editSelectedIds, setEditSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [savingEdit, setSavingEdit] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const teamParam = currentTeam ? `?team=${encodeURIComponent(currentTeam.teamSlug)}` : "";
    try {
      const [sRes, pRes] = await Promise.all([
        fetch(`/api/sprints${teamParam}`, { cache: "no-store" }),
        fetch(`/api/projects${teamParam}`, { cache: "no-store" }),
      ]);

      if (pRes.ok) {
        try {
          const pData = (await pRes.json()) as { projects?: ProjectOption[] };
          setProjects(Array.isArray(pData.projects) ? pData.projects : []);
        } catch {
          setProjects([]);
          toast.error(t("projectsLoadFailed"));
        }
      } else {
        setProjects([]);
        if (pRes.status !== 401) {
          toast.error(t("projectsLoadFailed"));
        }
      }

      if (sRes.ok) {
        try {
          const sData = (await sRes.json()) as { sprints?: SprintRow[] };
          setSprints(Array.isArray(sData.sprints) ? sData.sprints : []);
        } catch {
          setSprints([]);
          toast.error(t("sprintsLoadFailed"));
        }
      } else {
        if (sRes.status === 401) {
          setSprints([]);
        } else {
          try {
            const errBody = (await sRes.json()) as {
              error?: string;
              detail?: string;
              sprints?: SprintRow[];
            };
            setSprints(Array.isArray(errBody.sprints) ? errBody.sprints : []);
            const primary = errBody.error?.trim();
            const extra = errBody.detail?.trim();
            const combined =
              primary && extra ? `${primary} — ${extra}` : primary || extra;
            const detail =
              combined && combined.length > 0 && combined.length < 700
                ? combined
                : t("sprintsLoadFailed");
            toast.error(detail);
          } catch {
            setSprints([]);
            toast.error(t("sprintsLoadFailed"));
          }
        }
      }
    } catch {
      toast.error(t("loadFailed"));
      setSprints([]);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [t, currentTeam]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleEdit(id: string) {
    setEditSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openEdit(s: SprintRow) {
    setEditId(s.id);
    setEditName(s.name);
    setEditStartDate(toDateInputValue(s.startDate));
    setEditEndDate(toDateInputValue(s.endDate));
    setEditMaxManSprints(s.maxManSprints != null ? String(s.maxManSprints) : "");
    setEditDaysOff(s.daysOff > 0 ? String(s.daysOff) : "");
    setEditCarryOverPoints(s.carryOverPoints != null ? String(s.carryOverPoints) : "");
    setEditPointsPlanned(s.pointsPlanned != null ? String(s.pointsPlanned) : "");
    setEditGoals(s.goals ?? "");
    setEditSelectedIds(new Set(s.projects.map((p) => p.id)));
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editId || !canTriage) return;
    if (editSelectedIds.size === 0) {
      toast.error(t("projectsRequired"));
      return;
    }
    if (editStartDate.trim() && editEndDate.trim() && editEndDate.trim() < editStartDate.trim()) {
      toast.error(t("invalidDateRange"));
      return;
    }
    setSavingEdit(true);
    try {
      const body: Record<string, unknown> = {
        name: editName.trim(),
        projectIds: [...editSelectedIds],
      };
      body.startDate = editStartDate.trim() ? editStartDate.trim() : null;
      body.endDate = editEndDate.trim() ? editEndDate.trim() : null;
      const mm = optionalIntFromInput(editMaxManSprints);
      body.maxManSprints = mm !== undefined ? mm : null;
      const doff = optionalIntFromInput(editDaysOff);
      body.daysOff = doff !== undefined ? doff : 0;
      const co = optionalIntFromInput(editCarryOverPoints);
      body.carryOverPoints = co !== undefined ? co : null;
      const pp = optionalIntFromInput(editPointsPlanned);
      body.pointsPlanned = pp !== undefined ? pp : null;
      body.goals = editGoals.trim() ? editGoals.trim() : null;

      const res = await fetch(`/api/sprints/${encodeURIComponent(editId)}`, {
        method: "PATCH",
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
        toast.error(fromJson || fallback || t("saveFailed"));
        return;
      }
      toast.success(t("saveSuccess"));
      setEditOpen(false);
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : null;
      toast.error(msg && msg.length < 400 ? msg : t("saveFailed"));
    } finally {
      setSavingEdit(false);
    }
  }

  async function removeSprint(id: string) {
    if (!canTriage) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      const res = await fetch(`/api/sprints/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(t("deleteFailed"));
        return;
      }
      toast.success(t("deleteSuccess"));
      await load();
    } catch {
      toast.error(t("deleteFailed"));
    }
  }

  const planningFieldsEdit = (
    <div className="border-t border-border pt-3">
      <p className="mb-3 text-xs font-medium text-muted-foreground">{t("planningSection")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("fieldStartDate")}</span>
          <input
            type="date"
            value={editStartDate}
            onChange={(e) => setEditStartDate(e.target.value)}
            className="min-h-(--input-height) rounded-sm border border-border bg-card px-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("fieldEndDate")}</span>
          <input
            type="date"
            value={editEndDate}
            onChange={(e) => setEditEndDate(e.target.value)}
            className="min-h-(--input-height) rounded-sm border border-border bg-card px-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("fieldMaxManSprints")}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={editMaxManSprints}
            onChange={(e) => setEditMaxManSprints(e.target.value)}
            className="min-h-(--input-height) rounded-sm border border-border bg-card px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("fieldDaysOff")}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={editDaysOff}
            onChange={(e) => setEditDaysOff(e.target.value)}
            className="min-h-(--input-height) rounded-sm border border-border bg-card px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("fieldCarryOver")}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={editCarryOverPoints}
            onChange={(e) => setEditCarryOverPoints(e.target.value)}
            className="min-h-(--input-height) rounded-sm border border-border bg-card px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("fieldPointsPlanned")}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={editPointsPlanned}
            onChange={(e) => setEditPointsPlanned(e.target.value)}
            className="min-h-(--input-height) rounded-sm border border-border bg-card px-3 text-sm"
          />
        </label>
      </div>
      <label className="mt-3 flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("fieldSprintGoals")}</span>
        <textarea
          value={editGoals}
          onChange={(e) => setEditGoals(e.target.value)}
          rows={4}
          maxLength={8000}
          placeholder={t("goalsPlaceholder")}
          className="min-h-24 resize-y rounded-sm border border-border bg-card px-3 py-2 text-sm"
        />
      </label>
    </div>
  );

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className="mx-auto max-w-4xl py-(--page-padding-y)"
      style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
    >
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="mb-2 text-xl font-semibold text-foreground">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canTriage ? (
          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="size-4 shrink-0" aria-hidden />
            {t("createSprintOpen")}
          </button>
        ) : null}
      </div>

      {canTriage ? (
        <CreateSprintWizard
          open={createModalOpen}
          onOpenChange={setCreateModalOpen}
          projects={projects}
          onCreated={load}
        />
      ) : null}

      <ul className="flex flex-col gap-2">
        {sprints.map((s) => {
          const meta = formatSprintPlanningMetaLine(s, t);
          return (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-4 py-3 shadow-(--shadow-1)"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Link
                    href={`/sprints/${s.id}/overview`}
                    className="min-w-0 truncate font-medium text-primary hover:underline"
                  >
                    {s.name}
                  </Link>
                  {s.completedAt ? <SprintCompletedTag /> : null}
                  {!s.completedAt && isSprintRunning(s) ? <SprintActiveTag /> : null}
                  {!s.completedAt && isSprintOverdue(s) ? <SprintOverdueTag /> : null}
                  {!s.completedAt && isSprintDraft(s) ? <SprintDraftTag /> : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("projectCount", { count: s.projects.length })}
                  {s.projects.length > 0 ? `: ${s.projects.map((p) => p.name).join(", ")}` : ""}
                </p>
                {meta ? <p className="mt-1 text-[11px] text-muted-foreground">{meta}</p> : null}
                {s.goals ? (
                  <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground whitespace-pre-wrap">
                    {s.goals}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/sprints/${s.id}/overview`}
                  className="rounded-sm border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  {t("openBoard")}
                </Link>
                {s.completedAt ? (
                  <Link
                    href={`/sprints/${s.id}/report`}
                    className="rounded-sm border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
                  >
                    {t("reportOpen")}
                  </Link>
                ) : null}
                {!s.completedAt && canTriage ? (
                  <Link
                    href={`/sprints/${s.id}/complete`}
                    className="rounded-sm border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                  >
                    {t("completeSprintOpen")}
                  </Link>
                ) : null}
                {canTriage && !s.completedAt ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded-sm p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={t("editAria")}
                      onClick={() => openEdit(s)}
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-sm p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
                      aria-label={t("deleteAria")}
                      onClick={() => void removeSprint(s.id)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {sprints.length === 0 ? <p className="mt-6 text-sm text-muted-foreground">{t("empty")}</p> : null}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[min(90dvh,720px)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t("sprintName")}</span>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="min-h-(--input-height) rounded-sm border border-border bg-card px-3 text-sm"
                maxLength={120}
              />
            </label>
            {planningFieldsEdit}
            <fieldset className="min-w-0">
              <legend className="mb-2 text-xs font-medium text-muted-foreground">{t("projectsInSprint")}</legend>
              <ul className="flex max-h-40 flex-col gap-2 overflow-y-auto rounded-sm border border-border p-2">
                {projects.map((p) => (
                  <li key={p.id}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editSelectedIds.has(p.id)}
                        onChange={() => toggleEdit(p.id)}
                        className="rounded border-border"
                      />
                      <span>{p.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          </div>
          <DialogFooter className="gap-2">
            <button
              type="button"
              className="rounded-sm border border-border px-3 py-2 text-sm"
              onClick={() => setEditOpen(false)}
              disabled={savingEdit}
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              className="rounded-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
              disabled={savingEdit || !editName.trim() || editSelectedIds.size === 0}
              onClick={() => void saveEdit()}
            >
              {savingEdit ? t("saving") : t("save")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
