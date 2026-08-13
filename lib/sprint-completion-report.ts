import type { TicketStatus } from "@/components/tickets/ticket-types";
import { buildTicketRefFromParts } from "@/lib/ticket-display-ref";
import type {
  SprintCompletionReport,
  SprintCompletionReportAssigneeRow,
  SprintCompletionReportDimensionRow,
  SprintCompletionReportProjectRow,
  SprintCompletionReportTicket,
} from "@/lib/sprint-completion-report-types";

export interface SprintCompletionReportSourceTicket {
  id: string;
  title: string;
  status: TicketStatus;
  type: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | null;
  storyPoints: number | null;
  ticketScopeKey: string;
  ticketKeyNumber: number;
  assignee: { id: string; name: string | null; email: string } | null;
  project: { id: string; name: string; ticketKeyPrefix: string } | null;
}

const UNASSIGNED_PROJECT = "__unassigned_project__";
const UNASSIGNED_USER = "__unassigned_user__";

function assigneeLabel(assignee: SprintCompletionReportSourceTicket["assignee"]): string {
  if (!assignee) return "";
  return assignee.name?.trim() || assignee.email;
}

function toReportTicket(
  t: SprintCompletionReportSourceTicket,
  unassignedProjectLabel: string,
  unassignedAssigneeLabel: string
): SprintCompletionReportTicket {
  return {
    id: t.id,
    ref: buildTicketRefFromParts(
      t.ticketScopeKey,
      t.ticketKeyNumber,
      t.project?.ticketKeyPrefix
    ),
    title: t.title,
    status: t.status,
    storyPoints: t.storyPoints,
    assigneeId: t.assignee?.id ?? null,
    assigneeLabel: assigneeLabel(t.assignee) || unassignedAssigneeLabel,
    projectId: t.project?.id ?? null,
    projectName: t.project?.name ?? unassignedProjectLabel,
  };
}

interface AggregateBucket {
  ticketCount: number;
  doneCount: number;
  velocityPoints: number;
  carryoverPoints: number;
  totalPoints: number;
}

function bumpBucket(bucket: AggregateBucket, points: number, isDone: boolean): void {
  bucket.ticketCount += 1;
  bucket.totalPoints += points;
  if (isDone) {
    bucket.doneCount += 1;
    bucket.velocityPoints += points;
  } else {
    bucket.carryoverPoints += points;
  }
}

function sortByVelocityThenName<T extends { velocityPoints: number; projectName?: string; assigneeLabel?: string }>(
  rows: T[],
  nameKey: "projectName" | "assigneeLabel"
): T[] {
  return [...rows].sort((a, b) => {
    if (b.velocityPoints !== a.velocityPoints) return b.velocityPoints - a.velocityPoints;
    const aName = nameKey === "projectName" ? a.projectName ?? "" : a.assigneeLabel ?? "";
    const bName = nameKey === "projectName" ? b.projectName ?? "" : b.assigneeLabel ?? "";
    return aName.localeCompare(bName, undefined, { sensitivity: "base" });
  });
}

function sortDimensionRows(rows: SprintCompletionReportDimensionRow[]): SprintCompletionReportDimensionRow[] {
  return [...rows].sort((a, b) => {
    if (b.ticketCount !== a.ticketCount) return b.ticketCount - a.ticketCount;
    if (b.velocityPoints !== a.velocityPoints) return b.velocityPoints - a.velocityPoints;
    return a.key.localeCompare(b.key, undefined, { sensitivity: "base" });
  });
}

function priorityKey(priority: SprintCompletionReportSourceTicket["priority"]): string {
  return priority ?? "NONE";
}

export function buildSprintCompletionReport(
  tickets: SprintCompletionReportSourceTicket[],
  options: {
    pointsPlanned: number | null;
    unassignedProjectLabel: string;
    unassignedAssigneeLabel: string;
  }
): SprintCompletionReport {
  const doneTickets: SprintCompletionReportTicket[] = [];
  const carryoverTickets: SprintCompletionReportTicket[] = [];

  const projectBuckets = new Map<
    string,
    AggregateBucket & { projectId: string | null; projectName: string }
  >();
  const assigneeBuckets = new Map<
    string,
    AggregateBucket & { userId: string | null; assigneeLabel: string }
  >();
  const typeBuckets = new Map<string, AggregateBucket & { key: string }>();
  const priorityBuckets = new Map<string, AggregateBucket & { key: string }>();

  let doneTicketCount = 0;
  let velocityPoints = 0;
  let carryoverPoints = 0;
  let totalScopePoints = 0;

  for (const t of tickets) {
    const points = t.storyPoints ?? 0;
    const isDone = t.status === "DONE";
    totalScopePoints += points;

    const reportRow = toReportTicket(
      t,
      options.unassignedProjectLabel,
      options.unassignedAssigneeLabel
    );
    if (isDone) {
      doneTicketCount += 1;
      velocityPoints += points;
      doneTickets.push(reportRow);
    } else {
      carryoverPoints += points;
      carryoverTickets.push(reportRow);
    }

    const projectKey = t.project?.id ?? UNASSIGNED_PROJECT;
    let projectBucket = projectBuckets.get(projectKey);
    if (!projectBucket) {
      projectBucket = {
        projectId: t.project?.id ?? null,
        projectName: reportRow.projectName,
        ticketCount: 0,
        doneCount: 0,
        velocityPoints: 0,
        carryoverPoints: 0,
        totalPoints: 0,
      };
      projectBuckets.set(projectKey, projectBucket);
    }
    bumpBucket(projectBucket, points, isDone);

    const userKey = t.assignee?.id ?? UNASSIGNED_USER;
    let assigneeBucket = assigneeBuckets.get(userKey);
    if (!assigneeBucket) {
      assigneeBucket = {
        userId: t.assignee?.id ?? null,
        assigneeLabel: reportRow.assigneeLabel,
        ticketCount: 0,
        doneCount: 0,
        velocityPoints: 0,
        carryoverPoints: 0,
        totalPoints: 0,
      };
      assigneeBuckets.set(userKey, assigneeBucket);
    }
    bumpBucket(assigneeBucket, points, isDone);

    const typeKey = t.type;
    let typeBucket = typeBuckets.get(typeKey);
    if (!typeBucket) {
      typeBucket = {
        key: typeKey,
        ticketCount: 0,
        doneCount: 0,
        velocityPoints: 0,
        carryoverPoints: 0,
        totalPoints: 0,
      };
      typeBuckets.set(typeKey, typeBucket);
    }
    bumpBucket(typeBucket, points, isDone);

    const priKey = priorityKey(t.priority);
    let priorityBucket = priorityBuckets.get(priKey);
    if (!priorityBucket) {
      priorityBucket = {
        key: priKey,
        ticketCount: 0,
        doneCount: 0,
        velocityPoints: 0,
        carryoverPoints: 0,
        totalPoints: 0,
      };
      priorityBuckets.set(priKey, priorityBucket);
    }
    bumpBucket(priorityBucket, points, isDone);
  }

  const projects: SprintCompletionReportProjectRow[] = sortByVelocityThenName(
    [...projectBuckets.values()],
    "projectName"
  );
  const byAssignee: SprintCompletionReportAssigneeRow[] = sortByVelocityThenName(
    [...assigneeBuckets.values()],
    "assigneeLabel"
  );
  const byType: SprintCompletionReportDimensionRow[] = sortDimensionRows(
    [...typeBuckets.values()].map(({ key, ticketCount, doneCount, velocityPoints, carryoverPoints }) => ({
      key,
      ticketCount,
      doneCount,
      velocityPoints,
      carryoverPoints,
    }))
  );
  const priorityOrder = ["HIGH", "MEDIUM", "LOW", "NONE"];
  const toDimensionRow = (b: AggregateBucket & { key: string }): SprintCompletionReportDimensionRow => ({
    key: b.key,
    ticketCount: b.ticketCount,
    doneCount: b.doneCount,
    velocityPoints: b.velocityPoints,
    carryoverPoints: b.carryoverPoints,
  });
  const byPriorityOrdered = priorityOrder
    .filter((k) => priorityBuckets.has(k))
    .map((k) => toDimensionRow(priorityBuckets.get(k)!));
  const byPriorityExtra = sortDimensionRows(
    [...priorityBuckets.entries()]
      .filter(([k]) => !priorityOrder.includes(k))
      .map(([, b]) => toDimensionRow(b))
  );
  const byPriority = [...byPriorityOrdered, ...byPriorityExtra];

  doneTickets.sort((a, b) => a.ref.localeCompare(b.ref, undefined, { sensitivity: "base" }));
  carryoverTickets.sort((a, b) => a.ref.localeCompare(b.ref, undefined, { sensitivity: "base" }));

  return {
    summary: {
      totalTickets: tickets.length,
      doneTicketCount,
      carryoverTicketCount: carryoverTickets.length,
      velocityPoints,
      carryoverPoints,
      totalScopePoints,
      pointsPlanned: options.pointsPlanned,
    },
    projects,
    byAssignee,
    byType,
    byPriority,
    doneTickets,
    carryoverTickets,
  };
}
