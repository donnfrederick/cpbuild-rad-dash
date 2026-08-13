"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { TicketRow } from "@/components/tickets/ticket-types";
import { TICKETS_INBOX_REFRESH_EVENT } from "@/lib/ticket-inbox-events";

export interface AddExistingTicketsToSprintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sprintId: string;
  fetchTickets: (opts?: { soft?: boolean }) => Promise<void>;
}

export function AddExistingTicketsToSprintDialog({
  open,
  onOpenChange,
  sprintId,
  fetchTickets,
}: AddExistingTicketsToSprintDialogProps): React.ReactElement {
  const t = useTranslations("tickets");
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<TicketRow[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sprints/${encodeURIComponent(sprintId)}/addable-tickets`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? t("addExistingToSprintLoadFailed"));
        setCandidates([]);
        return;
      }
      const data = (await res.json()) as { tickets?: TicketRow[]; reason?: string };
      setCandidates(Array.isArray(data.tickets) ? data.tickets : []);
      if (data.reason === "implicit_scope") {
        toast.info(t("addExistingToSprintImplicitSprint"));
      }
    } catch {
      toast.error(t("addExistingToSprintLoadFailed"));
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [sprintId, t]);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setSearch("");
      return;
    }
    void load();
  }, [open, load]);

  const searchNorm = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (searchNorm.length === 0) return candidates;
    return candidates.filter((r) => {
      const ref = (r.ref ?? "").toLowerCase();
      const title = (r.title ?? "").toLowerCase();
      const desc = (r.description ?? "").toLowerCase();
      return ref.includes(searchNorm) || title.includes(searchNorm) || desc.includes(searchNorm);
    });
  }, [candidates, searchNorm]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelected(new Set(filtered.map((r) => r.id)));
  }, [filtered]);

  const clearSel = useCallback(() => setSelected(new Set()), []);

  const onSubmit = useCallback(async () => {
    if (selected.size === 0) {
      toast.error(t("addExistingToSprintNoneSelected"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sprints/${encodeURIComponent(sprintId)}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketIds: [...selected] }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; added?: number };
      if (!res.ok) {
        toast.error(data.error ?? t("addExistingToSprintFailed"));
        return;
      }
      const n = typeof data.added === "number" ? data.added : selected.size;
      toast.success(t("addExistingToSprintSuccess", { count: n }));
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(TICKETS_INBOX_REFRESH_EVENT));
      }
      await fetchTickets({ soft: true });
      onOpenChange(false);
    } catch {
      toast.error(t("addExistingToSprintFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [selected, sprintId, fetchTickets, onOpenChange, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90dvh,36rem)] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("addExistingToSprintTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t("addExistingToSprintHint")}</p>
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="min-h-(--input-height) w-full rounded-sm border border-border bg-card px-3 text-sm"
            autoComplete="off"
          />
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={selectAllVisible}
              className="text-primary underline-offset-2 hover:underline"
              disabled={loading || filtered.length === 0}
            >
              {t("addExistingToSprintSelectVisible")}
            </button>
            <button
              type="button"
              onClick={clearSel}
              className="text-muted-foreground underline-offset-2 hover:underline"
              disabled={selected.size === 0}
            >
              {t("addExistingToSprintClearSelection")}
            </button>
            <span className="text-muted-foreground">
              {t("addExistingToSprintSelectedCount", { count: selected.size })}
            </span>
          </div>
          <div
            className="min-h-[200px] max-h-[min(50dvh,280px)] overflow-y-auto rounded-md border border-border p-2"
            role="list"
          >
            {loading ? (
              <div className="flex justify-center py-12 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {candidates.length === 0
                  ? t("addExistingToSprintEmpty")
                  : t("addExistingToSprintNoMatches")}
              </p>
            ) : (
              <ul className="space-y-1">
                {filtered.map((r) => (
                  <li key={r.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted/50",
                        selected.has(r.id) && "bg-primary/5"
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-border"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                      />
                      <span>
                        <span className="font-mono text-xs text-muted-foreground">{r.ref}</span>{" "}
                        <span className="text-foreground">{r.title}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex min-h-9 items-center justify-center rounded-sm border border-border px-3 text-sm"
            disabled={submitting}
          >
            {t("addExistingToSprintCancel")}
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            className="inline-flex min-h-9 items-center justify-center rounded-sm bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
            disabled={submitting || selected.size === 0}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t("addExistingToSprintConfirm")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
