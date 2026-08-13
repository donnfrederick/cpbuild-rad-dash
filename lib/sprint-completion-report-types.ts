import type { TicketStatus } from "@/components/tickets/ticket-types";

export interface SprintCompletionReportTicket {
  id: string;
  ref: string;
  title: string;
  status: TicketStatus;
  storyPoints: number | null;
  assigneeId: string | null;
  assigneeLabel: string;
  projectId: string | null;
  projectName: string;
}

export interface SprintCompletionReportProjectRow {
  projectId: string | null;
  projectName: string;
  ticketCount: number;
  doneCount: number;
  velocityPoints: number;
  carryoverPoints: number;
  totalPoints: number;
}

export interface SprintCompletionReportAssigneeRow {
  userId: string | null;
  assigneeLabel: string;
  ticketCount: number;
  doneCount: number;
  velocityPoints: number;
  carryoverPoints: number;
}

/** Aggregated row for ticket type or priority (key is type code or HIGH/MEDIUM/LOW/NONE). */
export interface SprintCompletionReportDimensionRow {
  key: string;
  ticketCount: number;
  doneCount: number;
  velocityPoints: number;
  carryoverPoints: number;
}

export interface SprintCompletionReportSummary {
  totalTickets: number;
  doneTicketCount: number;
  carryoverTicketCount: number;
  velocityPoints: number;
  carryoverPoints: number;
  totalScopePoints: number;
  pointsPlanned: number | null;
}

export interface SprintCompletionReport {
  summary: SprintCompletionReportSummary;
  projects: SprintCompletionReportProjectRow[];
  byAssignee: SprintCompletionReportAssigneeRow[];
  byType: SprintCompletionReportDimensionRow[];
  byPriority: SprintCompletionReportDimensionRow[];
  doneTickets: SprintCompletionReportTicket[];
  carryoverTickets: SprintCompletionReportTicket[];
}
