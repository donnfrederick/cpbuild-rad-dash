"use client";

import type { ReactElement, ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";

export function TicketInboxPlanningDropZone({
  id,
  children,
  variant = "card",
}: {
  id: string;
  children: ReactNode;
  /** `stacked` = full-width list with row dividers (Jira-style). */
  variant?: "card" | "stacked";
}): ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col transition-colors",
        variant === "stacked"
          ? cn(
              "min-h-[4rem] divide-y divide-border bg-card",
              isOver && "bg-primary/5 ring-1 ring-inset ring-primary/30"
            )
          : cn(
              "min-h-[5rem] gap-2 rounded-md border border-dashed border-border bg-muted/10 p-2",
              isOver && "border-primary bg-primary/5"
            )
      )}
    >
      {children}
    </div>
  );
}
