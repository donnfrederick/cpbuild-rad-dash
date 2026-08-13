"use client";

import type { ReactElement } from "react";
import type { TicketRow } from "@/components/tickets/ticket-types";

export function TicketInboxPlanningOverlayCard({ ticket }: { ticket: TicketRow }): ReactElement {
  return (
    <div className="pointer-events-none flex max-w-[min(100vw-2rem,20rem)] rounded-md border border-border bg-card p-3 shadow-xl">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] text-muted-foreground">{ticket.ref}</p>
        <p className="truncate text-sm font-semibold text-foreground">{ticket.title}</p>
      </div>
    </div>
  );
}
