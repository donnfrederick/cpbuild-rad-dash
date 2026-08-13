"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { GlobalProjectFilterQuery } from "@/components/tickets/useTicketsInboxData";

export interface TicketProjectFilterMultiSelectProps {
  id?: string;
  projectOptions: ReadonlyArray<{ id: string; name: string }>;
  query: GlobalProjectFilterQuery;
  onQueryChange: (q: GlobalProjectFilterQuery) => void;
  className?: string;
  triggerClassName?: string;
}

export function TicketProjectFilterMultiSelect({
  id,
  projectOptions,
  query,
  onQueryChange,
  className,
  triggerClassName,
}: TicketProjectFilterMultiSelectProps): React.ReactElement {
  const t = useTranslations("tickets");
  const genId = useId();
  const listId = `${genId}-plist`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const qLower = searchQuery.trim().toLowerCase();

  const { selectedProjectIds, includeUnassigned, isAllMode } = useMemo((): {
    selectedProjectIds: string[];
    includeUnassigned: boolean;
    isAllMode: boolean;
  } => {
    if (query.mode === "all") {
      return {
        selectedProjectIds: projectOptions.map((p) => p.id),
        includeUnassigned: true,
        isAllMode: true,
      };
    }
    return {
      selectedProjectIds: query.pids,
      includeUnassigned: query.includeUnassigned,
      isAllMode: false,
    };
  }, [query, projectOptions]);

  const selectedPSet = useMemo(() => new Set(selectedProjectIds), [selectedProjectIds]);
  const totalProjects = projectOptions.length;

  const triggerLabel = useMemo(() => {
    if (isAllMode) return t("filterProjectAll");
    const nP = selectedProjectIds.length;
    if (nP === 0 && !includeUnassigned) return t("filterProjectNone");
    if (nP === totalProjects && includeUnassigned) {
      return t("filterProjectAll");
    }
    return t("filterProjectSummary", { n: nP, u: includeUnassigned ? "y" : "n" });
  }, [isAllMode, selectedProjectIds, includeUnassigned, totalProjects, t]);

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
    (pids: string[], un: boolean) => {
      onQueryChange({ mode: "explicit", pids, includeUnassigned: un });
    },
    [onQueryChange]
  );

  const toggleUnassigned = useCallback(() => {
    const un = !includeUnassigned;
    if (isAllMode) {
      const all = projectOptions.map((p) => p.id);
      applyExplicit(all, un);
    } else {
      applyExplicit([...selectedPSet], un);
    }
  }, [includeUnassigned, isAllMode, projectOptions, applyExplicit, selectedPSet]);

  const toggleProject = useCallback(
    (projectId: string) => {
      if (isAllMode) {
        const all = new Set(projectOptions.map((p) => p.id));
        if (all.has(projectId)) {
          all.delete(projectId);
        } else {
          all.add(projectId);
        }
        applyExplicit([...all], true);
        return;
      }
      const next = new Set(selectedPSet);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      applyExplicit([...next], includeUnassigned);
    },
    [isAllMode, projectOptions, applyExplicit, selectedPSet, includeUnassigned]
  );

  const resetToAll = useCallback(() => {
    onQueryChange({ mode: "all" });
    setOpen(false);
  }, [onQueryChange]);

  const visible = useMemo(() => {
    return projectOptions.filter(
      (p) => !qLower || p.name.toLowerCase().includes(qLower) || p.id.toLowerCase().includes(qLower)
    );
  }, [projectOptions, qLower]);

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
              {t("filterProjectResetAll")}
            </button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-1 py-0.5">
            <li>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 hover:bg-muted",
                  includeUnassigned && "bg-muted/80"
                )}
              >
                <input
                  type="checkbox"
                  checked={includeUnassigned}
                  className="mt-0.5 shrink-0 rounded border-border"
                  onChange={toggleUnassigned}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="min-w-0 text-foreground">{t("includeUnassignedLabel")}</span>
              </label>
            </li>
            {visible.map((opt) => {
              const checked = selectedPSet.has(opt.id);
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
                      onChange={() => toggleProject(opt.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="min-w-0 flex-1 whitespace-normal break-words text-foreground">
                      {opt.name}
                    </span>
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
