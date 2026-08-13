"use client";

import { TicketsWorkspace } from "@/components/tickets/TicketsWorkspace";

/** All tickets: list-only, project filter, no board / inbox scope tabs. */
export default function TicketsPage(): React.ReactElement {
  return <TicketsWorkspace variant="globalAllTickets" />;
}
