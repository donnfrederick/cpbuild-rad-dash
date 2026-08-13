"use client";

import type { CSSProperties, MouseEvent, ReactElement, ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";

export function TicketInboxPlanningShell({
  ticketId,
  zone,
  canDrag,
  stacked,
  onRowContextMenu,
  children,
}: {
  ticketId: string;
  zone: "sprint" | "backlog";
  canDrag: boolean;
  /** Flush rows with dividers from parent (Jira-style list). */
  stacked?: boolean;
  onRowContextMenu?: (e: MouseEvent) => void;
  children: ReactNode;
}): ReactElement {
  const dragId = `planning-${zone}-${ticketId}`;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragId,
    disabled: !canDrag,
  });
  const style: CSSProperties | undefined = isDragging
    ? { opacity: 0 }
    : transform
      ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
      : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      onContextMenu={onRowContextMenu}
      {...(canDrag ? { ...listeners, ...attributes } : {})}
      className={cn(
        "flex w-full gap-1 bg-card transition-colors",
        stacked
          ? "rounded-none border-0 shadow-none hover:bg-muted/50"
          : "rounded-md border border-border shadow-(--shadow-1) hover:bg-muted",
        canDrag && "cursor-grab active:cursor-grabbing",
        isDragging && "z-10"
      )}
    >
      {children}
    </div>
  );
}
