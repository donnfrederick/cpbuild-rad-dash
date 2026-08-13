import type { TicketStatus } from "@/components/tickets/ticket-types";

export interface SprintCompletionCarryoverRow {
  id: string;
  ref: string;
  title: string;
  status: TicketStatus;
  storyPoints: number | null;
}

export interface SprintCompletionPreview {
  doneTicketCount: number;
  /** Sum of story points on DONE tickets (frozen velocity). */
  velocity: number;
  carryover: SprintCompletionCarryoverRow[];
}
