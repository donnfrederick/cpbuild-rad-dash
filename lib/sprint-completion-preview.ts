import type { TicketStatus } from "@/components/tickets/ticket-types";
import { buildTicketRefFromParts } from "@/lib/ticket-display-ref";
import type { SprintCompletionCarryoverRow, SprintCompletionPreview } from "@/lib/sprint-completion-types";

export interface SprintCompletionTicketRow {
  id: string;
  title: string;
  status: TicketStatus;
  storyPoints: number | null;
  ticketScopeKey: string;
  ticketKeyNumber: number;
  project: { ticketKeyPrefix: string } | null;
}

export function buildSprintCompletionPreview(tickets: SprintCompletionTicketRow[]): SprintCompletionPreview {
  let doneTicketCount = 0;
  let velocity = 0;
  const carryover: SprintCompletionCarryoverRow[] = [];
  for (const t of tickets) {
    if (t.status === "DONE") {
      doneTicketCount += 1;
      velocity += t.storyPoints ?? 0;
    } else {
      carryover.push({
        id: t.id,
        ref: buildTicketRefFromParts(
          t.ticketScopeKey,
          t.ticketKeyNumber,
          t.project?.ticketKeyPrefix
        ),
        title: t.title,
        status: t.status,
        storyPoints: t.storyPoints,
      });
    }
  }
  return { doneTicketCount, velocity, carryover };
}
