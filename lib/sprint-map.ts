/** Prisma select shape shared by GET list, GET one, POST, PATCH responses. */
export function sprintApiSelect(): {
  id: true;
  name: true;
  startDate: true;
  endDate: true;
  completedAt: true;
  velocity: true;
  maxManSprints: true;
  daysOff: true;
  carryOverPoints: true;
  pointsPlanned: true;
  goals: true;
  createdAt: true;
  updatedAt: true;
  _count: { select: { sprintTickets: true } };
  projects: {
    select: { projectId: true; project: { select: { id: true; name: true } } };
    orderBy: { projectId: "asc" };
  };
} {
  return {
    id: true,
    name: true,
    startDate: true,
    endDate: true,
    completedAt: true,
    velocity: true,
    maxManSprints: true,
    daysOff: true,
    carryOverPoints: true,
    pointsPlanned: true,
    goals: true,
    createdAt: true,
    updatedAt: true,
    _count: { select: { sprintTickets: true } },
    projects: {
      select: {
        projectId: true,
        project: { select: { id: true, name: true } },
      },
      orderBy: { projectId: "asc" as const },
    },
  };
}

export interface SprintProjectSummary {
  id: string;
  name: string;
}

/** JSON shape returned by `/api/sprints` and `/api/sprints/[id]`. */
export interface SprintApiPayload {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  completedAt: string | null;
  velocity: number | null;
  maxManSprints: number | null;
  daysOff: number;
  carryOverPoints: number | null;
  pointsPlanned: number | null;
  goals: string | null;
  createdAt: string;
  updatedAt: string;
  projects: SprintProjectSummary[];
  /** When true, the board lists only tickets in `sprint_tickets`; when false, all tickets from linked projects. */
  usesExplicitTicketList: boolean;
}

export function mapSprintRowToApi(row: {
  id: string;
  name: string;
  startDate: Date | null;
  endDate: Date | null;
  completedAt: Date | null;
  velocity: number | null;
  maxManSprints: number | null;
  daysOff: number;
  carryOverPoints: number | null;
  pointsPlanned: number | null;
  goals: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { sprintTickets: number };
  projects: Array<{ project: SprintProjectSummary; projectId?: string }>;
}): SprintApiPayload {
  return {
    id: row.id,
    name: row.name,
    startDate: row.startDate ? row.startDate.toISOString() : null,
    endDate: row.endDate ? row.endDate.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    velocity: row.velocity,
    maxManSprints: row.maxManSprints,
    daysOff: row.daysOff,
    carryOverPoints: row.carryOverPoints,
    pointsPlanned: row.pointsPlanned,
    goals: row.goals ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    projects: row.projects.map((sp) => sp.project),
    usesExplicitTicketList: row._count.sprintTickets > 0,
  };
}
