"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useAppUser } from "@/contexts/AppUserContext";
import { useCurrentTeam } from "@/contexts/CurrentTeamContext";
import { canManageProjects } from "@/lib/project-management";
import type { TicketStatus } from "@/components/tickets/ticket-types";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";

const STATUS_I18N: Record<TicketStatus, string> = {
  BACKLOG: "statusBacklog",
  READY: "statusReady",
  IN_PROGRESS: "statusInProgress",
  FOR_REVIEW: "statusForReview",
  RESOLVED: "statusResolved",
  TO_BE_DEPLOYED: "statusToBeDeployed",
  DONE: "statusDone",
  ARCHIVED: "statusArchived",
};

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  ticketKeyPrefix: string;
  createdAt: string;
  updatedAt: string;
  statusBreakdown: { status: TicketStatus; count: number }[];
}

interface ProjectsApiResponse {
  projects: ProjectRow[];
}

/** API shape for project create/update JSON bodies (dates are ISO strings). */
interface ProjectApiRow {
  id: string;
  name: string;
  description: string | null;
  ticketKeyPrefix: string;
  createdAt: string;
  updatedAt: string;
}

function ProjectStatusSummary({
  breakdown,
  labelForStatus,
  emptyLabel,
}: {
  breakdown: { status: TicketStatus; count: number }[];
  labelForStatus: (status: TicketStatus) => string;
  emptyLabel: string;
}): React.ReactElement {
  if (breakdown.length === 0) {
    return <p className="mt-1 w-full text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <p className="mt-1 w-full text-sm text-muted-foreground">
      {breakdown.map(({ status, count }, i) => (
        <span key={status}>
          {i > 0 ? " · " : null}
          {count} {labelForStatus(status)}
        </span>
      ))}
    </p>
  );
}

export default function ProjectsPage(): React.ReactElement {
  const t = useTranslations("projects");
  const tTickets = useTranslations("tickets");
  const user = useAppUser();
  const { currentTeam } = useCurrentTeam();
  const canManage = canManageProjects(
    user.role,
    user.specialPermissions,
    currentTeam?.teamRole
  );
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPrefix, setNewPrefix] = useState("");
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrefix, setEditPrefix] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const labelForStatus = useCallback(
    (status: TicketStatus) => tTickets(STATUS_I18N[status]),
    [tTickets]
  );

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) {
      setLoading(true);
    }
    const teamParam = currentTeam ? `?team=${encodeURIComponent(currentTeam.teamSlug)}` : "";
    try {
      const res = await fetch(`/api/projects${teamParam}`, { cache: "no-store" });
      if (!res.ok) throw new Error("load");
      const data = (await res.json()) as ProjectsApiResponse;
      setProjects(data.projects ?? []);
    } catch {
      toast.error(t("loadFailed"));
      setProjects([]);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [t, currentTeam]);

  useEffect(() => {
    void load();
  }, [load]);

  function onCreateOpenChange(open: boolean): void {
    setCreateOpen(open);
    if (!open) {
      setName("");
      setNewDescription("");
      setNewPrefix("");
    }
  }

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !canManage) return;
    setCreating(true);
    try {
      const desc = newDescription.trim();
      const body: { name: string; description?: string | null; ticketKeyPrefix?: string } = {
        name: trimmed,
        description: desc.length > 0 ? desc : null,
      };
      const p = newPrefix.trim().toUpperCase();
      if (p.length >= 2) {
        body.ticketKeyPrefix = p;
      }
      const res = await fetch(`/api/projects${currentTeam ? `?team=${encodeURIComponent(currentTeam.teamSlug)}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? t("createFailed"));
        return;
      }
      const created = (await res.json()) as ProjectApiRow;
      const newRow: ProjectRow = { ...created, statusBreakdown: [] };
      setProjects((prev) => {
        const without = prev.filter((p) => p.id !== newRow.id);
        return [...without, newRow].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        );
      });
      toast.success(t("createSuccess"));
      setName("");
      setNewDescription("");
      setNewPrefix("");
      setCreateOpen(false);
      await load({ silent: true });
    } catch {
      toast.error(t("createFailed"));
    } finally {
      setCreating(false);
    }
  }

  function openEdit(p: ProjectRow) {
    setEditId(p.id);
    setEditName(p.name);
    setEditDescription(p.description ?? "");
    setEditPrefix(p.ticketKeyPrefix);
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editId || !canManage) return;
    setSavingEdit(true);
    try {
      const prefix = editPrefix.trim().toUpperCase();
      const payload: {
        name: string;
        description: string | null;
        ticketKeyPrefix?: string;
      } = {
        name: editName.trim(),
        description: editDescription.trim() || null,
      };
      if (prefix.length >= 2) {
        payload.ticketKeyPrefix = prefix;
      }
      const res = await fetch(`/api/projects/${encodeURIComponent(editId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? t("saveFailed"));
        return;
      }
      const updated = (await res.json()) as ProjectApiRow;
      setProjects((prev) =>
        prev
          .map((p) =>
            p.id === updated.id ? { ...updated, statusBreakdown: p.statusBreakdown } : p
          )
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      );
      toast.success(t("saveSuccess"));
      setEditOpen(false);
      await load({ silent: true });
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSavingEdit(false);
    }
  }

  async function removeProject(id: string) {
    if (!canManage) return;
    const { isConfirmed } = await Swal.fire({
      text: t("deleteConfirm"),
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: t("deleteAction"),
      confirmButtonColor: "#B42318",
      cancelButtonText: t("cancel"),
      focusCancel: true,
    });
    if (!isConfirmed) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.status === 409) {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? t("deleteBlocked"));
        return;
      }
      if (!res.ok) {
        toast.error(t("deleteFailed"));
        return;
      }
      setProjects((prev) => prev.filter((p) => p.id !== id));
      toast.success(t("deleteSuccess"));
      await load({ silent: true });
    } catch {
      toast.error(t("deleteFailed"));
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className="mx-auto max-w-3xl py-(--page-padding-y)"
      style={{ paddingLeft: "var(--page-padding-x)", paddingRight: "var(--page-padding-x)" }}
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
        {canManage ? (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="shrink-0 rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t("newProject")}
          </button>
        ) : null}
      </div>

      <ul className="flex flex-col gap-2">
        {projects.map((p) => (
          <li
            key={p.id}
            className="rounded-md border border-border bg-card px-4 py-3 shadow-(--shadow-1)"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href={`/projects/${p.id}/overview`}
                className="flex min-w-0 flex-1 items-center gap-2 font-medium text-primary hover:underline"
              >
                <span className="min-w-0 truncate">{p.name}</span>
                <span className="shrink-0 rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {p.ticketKeyPrefix}
                </span>
              </Link>
              {canManage ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="rounded-sm p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={t("editAria")}
                    onClick={() => openEdit(p)}
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="rounded-sm p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
                    aria-label={t("deleteAria")}
                    onClick={() => void removeProject(p.id)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ) : null}
            </div>
            <ProjectStatusSummary
              breakdown={p.statusBreakdown}
              labelForStatus={labelForStatus}
              emptyLabel={t("cardStatusEmpty")}
            />
          </li>
        ))}
      </ul>

      {projects.length === 0 ? <p className="mt-6 text-sm text-muted-foreground">{t("empty")}</p> : null}

      <Dialog open={createOpen} onOpenChange={onCreateOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("newProjectTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void createProject(e)} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1" htmlFor="new-project-name-modal">
              <span className="text-xs text-muted-foreground">{t("newProjectName")}</span>
              <input
                id="new-project-name-modal"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="min-h-(--input-height) w-full rounded-sm border border-border bg-card px-3 text-sm shadow-(--shadow-1)"
                placeholder={t("newProjectPlaceholder")}
                maxLength={120}
                autoFocus
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1" htmlFor="new-project-description-modal">
              <span className="text-xs text-muted-foreground">{t("descriptionLabel")}</span>
              <textarea
                id="new-project-description-modal"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="min-h-[100px] rounded-sm border border-border bg-card px-3 py-2 text-sm shadow-(--shadow-1)"
                maxLength={4000}
                autoComplete="off"
              />
            </label>
            <div>
              <label htmlFor="new-project-prefix-modal" className="mb-1 block text-xs text-muted-foreground">
                {t("newProjectPrefix")}
              </label>
              <input
                id="new-project-prefix-modal"
                value={newPrefix}
                onChange={(e) => setNewPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                className="min-h-(--input-height) w-full max-w-xs rounded-sm border border-border bg-card px-3 font-mono text-sm shadow-(--shadow-1)"
                maxLength={10}
                placeholder="RAD"
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-muted-foreground">{t("newProjectPrefixHelp")}</p>
            </div>
            <DialogFooter className="gap-2 sm:justify-end">
              <button
                type="button"
                className="rounded-sm border border-border px-3 py-2 text-sm"
                onClick={() => onCreateOpenChange(false)}
                disabled={creating}
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={creating || !name.trim()}
                className="rounded-sm bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {creating ? t("creating") : t("create")}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t("newProjectName")}</span>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="min-h-(--input-height) rounded-sm border border-border bg-card px-3 text-sm"
                maxLength={120}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t("descriptionLabel")}</span>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="min-h-[100px] rounded-sm border border-border bg-card px-3 py-2 text-sm"
                maxLength={4000}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t("ticketKeyPrefixLabel")}</span>
              <input
                value={editPrefix}
                onChange={(e) => setEditPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                className="min-h-(--input-height) rounded-sm border border-border bg-card px-3 font-mono text-sm"
                maxLength={10}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">{t("newProjectPrefixHelp")}</p>
            </label>
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
              disabled={savingEdit || !editName.trim()}
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
