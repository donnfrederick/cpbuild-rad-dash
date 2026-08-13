"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export interface TicketTagFilterMultiSelectProps {
  id?: string;
  /** Baseline list from GET /api/tags?limit=500 */
  options: ReadonlyArray<{ id: string; name: string }>;
  selectedIds: readonly string[];
  onSelectedIdsChange: (ids: string[]) => void;
  /** Applied to outer wrapper (e.g. min width) */
  className?: string;
  triggerClassName?: string;
}

export function TicketTagFilterMultiSelect({
  id,
  options,
  selectedIds,
  onSelectedIdsChange,
  className,
  triggerClassName,
}: TicketTagFilterMultiSelectProps): React.ReactElement {
  const t = useTranslations("tickets");
  const genId = useId();
  const listId = `${genId}-list`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [remoteHits, setRemoteHits] = useState<Array<{ id: string; name: string }>>([]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const qTrim = searchQuery.trim();
  const qLower = qTrim.toLowerCase();

  useEffect(() => {
    if (!open || !qTrim) {
      return;
    }
    let cancelled = false;
    const tmr = setTimeout(() => {
      void fetch(`/api/tags?q=${encodeURIComponent(qTrim)}&limit=50`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("tags"))))
        .then((data: { tags?: Array<{ id: string; name: string }> }) => {
          if (!cancelled) setRemoteHits(data.tags ?? []);
        })
        .catch(() => {
          if (!cancelled) setRemoteHits([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(tmr);
    };
  }, [open, qTrim]);

  const visibleOptions = useMemo(() => {
    const remoteSlice = open ? remoteHits : [];
    const byId = new Map<string, { id: string; name: string }>();
    for (const o of options) {
      if (!qLower || o.name.toLowerCase().includes(qLower)) {
        byId.set(o.id, o);
      }
    }
    for (const o of remoteSlice) {
      if (!qLower || o.name.toLowerCase().includes(qLower)) {
        byId.set(o.id, o);
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [options, remoteHits, qLower, open]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) m.set(o.id, o.name);
    for (const o of remoteHits) m.set(o.id, o.name);
    for (const o of visibleOptions) m.set(o.id, o.name);
    return m;
  }, [options, remoteHits, visibleOptions]);

  const triggerLabel = useMemo(() => {
    if (selectedIds.length === 0) return t("filterOptionAllTags");
    if (selectedIds.length <= 2) {
      return selectedIds
        .map((tid) => nameById.get(tid) ?? tid)
        .join(", ");
    }
    return t("filterTagMultiselectSummary", { count: selectedIds.length });
  }, [selectedIds, nameById, t]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const node = e.target as Node;
      if (wrapRef.current?.contains(node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      if (prev) {
        setSearchQuery("");
        setRemoteHits([]);
      } else {
        queueMicrotask(() => searchInputRef.current?.focus());
      }
      return !prev;
    });
  }, []);

  const toggle = useCallback(
    (tagId: string) => {
      const next = new Set(selectedIds);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      onSelectedIdsChange([...next]);
    },
    [selectedIds, onSelectedIdsChange]
  );

  const clearSelection = useCallback(() => {
    onSelectedIdsChange([]);
  }, [onSelectedIdsChange]);

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
        <ChevronDown className={cn("h-4 w-4 shrink-0 opacity-70 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={t("filterTagAria")}
          aria-multiselectable="true"
          className="absolute right-0 left-auto top-full z-[100] mt-1 flex max-h-64 min-w-[min(100%,22rem)] w-max max-w-[min(96vw,40rem)] flex-col overflow-hidden rounded-md border border-border bg-card py-1 text-sm shadow-(--shadow-2)"
        >
          <div className="shrink-0 border-b border-border px-2 py-1.5">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("filterTagSearchPlaceholder")}
                className="h-8 w-full rounded-sm border border-border bg-background pl-7 pr-2 text-xs text-foreground"
                autoComplete="off"
                aria-label={t("filterTagSearchPlaceholder")}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-1 py-0.5">
            {visibleOptions.length === 0 ? (
              <li className="px-2 py-2 text-xs text-muted-foreground">{t("filterTagNoMatches")}</li>
            ) : (
              visibleOptions.map((opt) => {
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
                        onChange={() => toggle(opt.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="min-w-0 flex-1 whitespace-normal break-words text-foreground">{opt.name}</span>
                    </label>
                  </li>
                );
              })
            )}
          </ul>
          {selectedIds.length > 0 ? (
            <div className="shrink-0 border-t border-border px-2 py-1.5">
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={() => {
                  clearSelection();
                }}
              >
                {t("filterTagClearSelection")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
