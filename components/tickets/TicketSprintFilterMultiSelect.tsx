"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { GlobalSprintFilterQuery } from "@/components/tickets/useTicketsInboxData";

export interface SprintFilterOption {
  id: string;
  name: string;
  /** Whether this sprint is active today (used to mark options with a small dot). */
  isActive?: boolean;
}

export interface TicketSprintFilterMultiSelectProps {
  id?: string;
  sprintOptions: ReadonlyArray<SprintFilterOption>;
  query: GlobalSprintFilterQuery;
  onQueryChange: (q: GlobalSprintFilterQuery) => void;
  className?: string;
  triggerClassName?: string;
}

export function TicketSprintFilterMultiSelect({
  id,
  sprintOptions,
  query,
  onQueryChange,
  className,
  triggerClassName,
}: TicketSprintFilterMultiSelectProps): React.ReactElement {
  const t = useTranslations("tickets");
  const genId = useId();
  const listId = `${genId}-slist`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const qLower = searchQuery.trim().toLowerCase();

  const { selectedSprintIds, isAllMode } = useMemo((): {
    selectedSprintIds: string[];
    isAllMode: boolean;
  } => {
    if (query.mode === "all") {
      return {
        selectedSprintIds: sprintOptions.map((s) => s.id),
        isAllMode: true,
      };
    }
    return { selectedSprintIds: query.sprintIds, isAllMode: false };
  }, [query, sprintOptions]);

  const selectedSet = useMemo(() => new Set(selectedSprintIds), [selectedSprintIds]);
  const totalSprints = sprintOptions.length;

  const triggerLabel = useMemo(() => {
    if (isAllMode) return t("filterSprintAll");
    const n = selectedSprintIds.length;
    if (n === 0) return t("filterSprintNone");
    if (n === totalSprints) return t("filterSprintAll");
    if (n === 1) {
      const onlyId = selectedSprintIds[0];
      const match = sprintOptions.find((s) => s.id === onlyId);
      if (match) return match.name;
    }
    return t("filterSprintSummary", { n });
  }, [isAllMode, selectedSprintIds, totalSprints, sprintOptions, t]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggleOpen = useCallback(() => {
    setOpen((p) => !p);
  }, []);

  const applyExplicit = useCallback(
    (sprintIds: string[]) => {
      onQueryChange({ mode: "explicit", sprintIds });
    },
    [onQueryChange]
  );

  const toggleSprint = useCallback(
    (sprintId: string) => {
      if (isAllMode) {
        const all = new Set(sprintOptions.map((s) => s.id));
        if (all.has(sprintId)) {
          all.delete(sprintId);
        } else {
          all.add(sprintId);
        }
        applyExplicit([...all]);
        return;
      }
      const next = new Set(selectedSet);
      if (next.has(sprintId)) {
        next.delete(sprintId);
      } else {
        next.add(sprintId);
      }
      applyExplicit([...next]);
    },
    [isAllMode, sprintOptions, applyExplicit, selectedSet]
  );

  const resetToAll = useCallback(() => {
    onQueryChange({ mode: "all" });
    setOpen(false);
  }, [onQueryChange]);

  const visible = useMemo(() => {
    return sprintOptions.filter(
      (s) => !qLower || s.name.toLowerCase().includes(qLower) || s.id.toLowerCase().includes(qLower)
    );
  }, [sprintOptions, qLower]);

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={cn(
          "flex min-h-(--input-height) w-full max-w-[min(100vw-2rem,36rem)] min-w-0 items-center justify-between gap-2 text-left text-sm text-foreground",
          triggerClassName
        )}
        onClick={toggleOpen}
      >
        <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 opacity-70 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute right-0 left-auto top-full z-[100] mt-1 flex max-h-64 min-w-[min(100%,20rem)] w-max max-w-[min(96vw,40rem)] flex-col overflow-hidden rounded-md border border-border bg-card py-1 text-sm shadow-(--shadow-2)"
        >
          <div className="shrink-0 border-b border-border px-2 py-1.5">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-full rounded-sm border border-border bg-background pl-7 pr-2 text-xs text-foreground"
                autoComplete="off"
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          </div>
          <div className="shrink-0 border-b border-border px-1 py-1.5">
            <button
              type="button"
              className="w-full rounded-sm px-2 py-1.5 text-left text-xs font-medium text-primary hover:bg-muted"
              onClick={resetToAll}
            >
              {t("filterSprintResetAll")}
            </button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-1 py-0.5">
            {visible.length === 0 ? (
              <li className="px-2 py-1.5 text-xs text-muted-foreground">{t("filterSprintEmpty")}</li>
            ) : null}
            {visible.map((opt) => {
              const checked = selectedSet.has(opt.id);
              return (
                <li key={opt.id} role="option" aria-selected={checked}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 hover:bg-muted",
                      checked && "bg-muted/80"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      className="mt-0.5 shrink-0 rounded border-border"
                      onChange={() => toggleSprint(opt.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="min-w-0 flex-1 whitespace-normal break-words text-foreground">
                      {opt.name}
                    </span>
                    {opt.isActive ? (
                      <span
                        className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                        aria-label={t("filterSprintActiveDotAria")}
                      />
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
