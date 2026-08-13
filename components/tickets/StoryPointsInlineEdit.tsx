"use client";

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { TicketReport } from "@/components/tickets/ticket-types";
import { cn } from "@/lib/utils";

export interface StoryPointsInlineEditProps {
  ticketId: string;
  storyPoints: number | null | undefined;
  canEdit: boolean;
  size?: "card" | "list";
  teamId?: string;
  onPatched?: (report: TicketReport) => void;
}

function parseStoryPoints(raw: string): number | null | undefined {
  if (raw.trim() === "") return null;
  const n = Number.parseInt(raw.trim(), 10);
  if (Number.isNaN(n) || n < 0 || n > 99) return undefined;
  return n;
}

function stopActivation(e: MouseEvent | PointerEvent): void {
  e.stopPropagation();
}

export function StoryPointsInlineEdit({
  ticketId,
  storyPoints,
  canEdit,
  size = "list",
  teamId,
  onPatched,
}: StoryPointsInlineEditProps): ReactElement | null {
  const t = useTranslations("tickets");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const badgeClass = cn(
    "rounded border border-border font-mono tabular-nums",
    size === "card" ? "px-1 py-0.5 text-[10px]" : "px-1.5 py-0.5 text-[11px]"
  );

  const commit = useCallback(
    async (raw: string) => {
      const next = parseStoryPoints(raw);
      if (next === undefined) return;
      if (next === (storyPoints ?? null)) return;

      setSaving(true);
      try {
        const ticketUrl = teamId
          ? `/api/tickets/${encodeURIComponent(ticketId)}?team=${encodeURIComponent(teamId)}`
          : `/api/tickets/${encodeURIComponent(ticketId)}`;
        const res = await fetch(ticketUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storyPoints: next }),
        });
        if (!res.ok) throw new Error("sp");
        const data = (await res.json()) as TicketReport;
        onPatched?.(data);
        toast.success(t("storyPointsUpdated"));
      } catch {
        toast.error(t("storyPointsUpdateFailed"));
      } finally {
        setSaving(false);
      }
    },
    [storyPoints, teamId, ticketId, onPatched, t]
  );

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!canEdit && (storyPoints == null || storyPoints === undefined)) {
    return null;
  }

  if (!canEdit) {
    return (
      <span className={cn(badgeClass, "text-muted-foreground")}>
        {t("storyPointsShort", { n: storyPoints! })}
      </span>
    );
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={0}
        max={99}
        defaultValue={storyPoints ?? ""}
        key={`sp-inline-${ticketId}-${storyPoints ?? "x"}`}
        className={cn(
          badgeClass,
          "w-12 bg-background text-foreground outline-none ring-1 ring-primary"
        )}
        disabled={saving}
        onPointerDown={stopActivation}
        onMouseDown={stopActivation}
        onClick={stopActivation}
        onBlur={(e) => {
          setEditing(false);
          void commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        aria-label={t("storyPointsChangeAria")}
      />
    );
  }

  if (storyPoints != null) {
    return (
      <button
        type="button"
        className={cn(badgeClass, "cursor-pointer text-muted-foreground hover:bg-muted/50")}
        onPointerDown={stopActivation}
        onMouseDown={stopActivation}
        onClick={(e) => {
          stopActivation(e);
          setEditing(true);
        }}
        aria-label={t("storyPointsChangeAria")}
      >
        {t("storyPointsShort", { n: storyPoints })}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        badgeClass,
        "cursor-pointer border-dashed text-muted-foreground hover:bg-muted/50"
      )}
      onPointerDown={stopActivation}
      onMouseDown={stopActivation}
      onClick={(e) => {
        stopActivation(e);
        setEditing(true);
      }}
      aria-label={t("storyPointsChangeAria")}
    >
      SP
    </button>
  );
}
