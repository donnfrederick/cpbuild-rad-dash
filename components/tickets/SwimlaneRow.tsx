"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface SwimlaneRowProps {
  label: string;
  children: React.ReactNode;
  ticketCount: number;
  /** When true the row fills remaining height (last or only swimlane). */
  flex?: boolean;
}

export function SwimlaneRow({ label, children, ticketCount, flex }: SwimlaneRowProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={cn("flex min-h-0 flex-col", flex && "flex-1")}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-left hover:bg-muted/60"
      >
        {collapsed ? (
          <ChevronRight size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">({ticketCount})</span>
      </button>
      {!collapsed ? (
        <div className={cn("flex min-h-0", flex ? "flex-1" : "h-56")}>{children}</div>
      ) : null}
    </div>
  );
}
