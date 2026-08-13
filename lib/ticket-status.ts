/**
 * Default built-in status keys in pipeline order.
 * These are used to seed TeamBoardStatus rows on team creation and as
 * fallback ordering when board config has not yet loaded.
 * The Ticket.status column is now a plain VARCHAR; the source of truth
 * for valid keys per team is the team_board_statuses table.
 */
export const DEFAULT_BOARD_STATUS_KEYS = [
  "BACKLOG",
  "READY",
  "IN_PROGRESS",
  "FOR_REVIEW",
  "RESOLVED",
  "TO_BE_DEPLOYED",
  "DONE",
  "ARCHIVED",
] as const;

export type DefaultBoardStatusKey = (typeof DEFAULT_BOARD_STATUS_KEYS)[number];

/** Default display labels for the built-in status keys. */
export const DEFAULT_BOARD_STATUS_LABELS: Record<DefaultBoardStatusKey, string> = {
  BACKLOG: "Backlog",
  READY: "Ready",
  IN_PROGRESS: "In Progress",
  FOR_REVIEW: "For Review",
  RESOLVED: "Resolved",
  TO_BE_DEPLOYED: "To Be Deployed",
  DONE: "Done",
  ARCHIVED: "Archived",
};

/**
 * Built-in statuses shown by default as board columns (ARCHIVED is opt-in).
 * Used as fallback when team board config has not yet loaded.
 */
export const DEFAULT_COLUMN_KEYS: readonly string[] = [
  "BACKLOG",
  "READY",
  "IN_PROGRESS",
  "FOR_REVIEW",
  "RESOLVED",
  "TO_BE_DEPLOYED",
  "DONE",
];

/**
 * @deprecated Use DEFAULT_BOARD_STATUS_KEYS for seed data.
 * Retained for any migration code that still imports this name.
 */
export const TICKET_STATUS_ENUM_TUPLE = DEFAULT_BOARD_STATUS_KEYS;

/**
 * @deprecated Use DEFAULT_BOARD_STATUS_KEYS.
 */
export const TICKET_STATUS_ORDER: readonly string[] = DEFAULT_BOARD_STATUS_KEYS;

/**
 * @deprecated Use DEFAULT_COLUMN_KEYS or team board statuses from the API.
 */
export const BOARD_COLUMN_STATUSES: readonly string[] = DEFAULT_COLUMN_KEYS;
