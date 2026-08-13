/** Any board status key — built-in (e.g. "BACKLOG") or custom (e.g. "AWAITING_QA"). */
export type TicketStatus = string;

export type TicketSource = "IN_APP" | "MARKER_IO" | "FIELD_TRACKER";

/** Built-in ticket type keys — used as seed values and fallback references. */
export const TICKET_TYPE_KIND_VALUES = [
  "BUG",
  "FEATURE_REQUEST",
  "FEEDBACK",
  "MINOR_ENHANCEMENT",
  "REGRESSION",
  "SECURITY_IMPROVEMENT",
] as const;

/** Built-in ticket type keys. Custom team types are plain strings. */
export type BuiltInTicketTypeKind = (typeof TICKET_TYPE_KIND_VALUES)[number];

/** Any ticket type key (built-in or custom). */
export type TicketTypeKind = string;

export type TicketTypeLabelKey =
  | "typeBug"
  | "typeFeature"
  | "typeFeedback"
  | "typeMinorEnhancement"
  | "typeRegression"
  | "typeSecurityImprovement";

/** Maps a stored type key to an i18n key under `tickets`. Falls back to null for unknown/custom types. */
export function ticketTypeKindLabelKey(type: string): TicketTypeLabelKey | null {
  if (type === "BUG") return "typeBug";
  if (type === "FEATURE_REQUEST") return "typeFeature";
  if (type === "FEEDBACK") return "typeFeedback";
  if (type === "MINOR_ENHANCEMENT") return "typeMinorEnhancement";
  if (type === "REGRESSION") return "typeRegression";
  if (type === "SECURITY_IMPROVEMENT") return "typeSecurityImprovement";
  return null;
}

/**
 * Returns a display label for any ticket type key.
 * For built-in types, the result is the i18n key to pass to `t()`.
 * For custom types, a human-readable label is derived from the key itself.
 * Pass `t` (the translator) when dealing with built-ins; for custom types
 * you can use `formatCustomTypeKey` directly.
 */
export function formatCustomTypeKey(key: string): string {
  return key
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Shape returned by GET /api/teams/[id]/board-statuses */
export interface TeamBoardStatus {
  id: string;
  key: string;
  label: string;
  color: string | null;
  isBuiltIn: boolean;
  isEnabled: boolean;
  sortOrder: number;
}

export type SwimlaneBy = "NONE" | "ASSIGNEE" | "TYPE" | "PRIORITY" | "PROJECT";

/** Shape returned by GET /api/teams/[id]/swimlane-config */
export interface TeamSwimlaneConfig {
  id: string;
  teamId: string;
  swimlaneBy: SwimlaneBy;
}

/** Shape returned by GET /api/teams/[id]/ticket-types */
export interface TeamTicketType {
  id: string;
  name: string;
  key: string;
  isBuiltIn: boolean;
  isEnabled: boolean;
  sortOrder: number;
}


/** Compact row for parent/child/sibling links on ticket detail. */
export interface TicketHierarchyRow {
  id: string;
  ref: string;
  shortId: number;
  title: string;
}

export interface TicketDuplicateLink {
  id: string;
  duplicateId: string;
  duplicate: {
    id: string;
    ref: string;
    shortId: number;
    title: string;
    description: string;
    screenshot: string | null;
    pageUrl: string | null;
    createdAt: string;
    user: { id: string; name: string | null; email: string };
  };
}

export interface TicketLinkedPRSummaryRow {
  id: string;
  status: "OPEN" | "MERGED" | "CLOSED";
}

/** List/board row shape from GET /api/tickets */
export interface TicketRow {
  id: string;
  shortId: number;
  /** Public ref e.g. ENG-0001, UN-0001 */
  ref: string;
  type: TicketTypeKind;
  title: string;
  description: string;
  status: TicketStatus;
  priority: "LOW" | "MEDIUM" | "HIGH" | null;
  source?: TicketSource;
  environment?: string | null;
  user: { id: string; name: string | null; email: string };
  assignee: { id: string; name: string | null; email: string } | null;
  parent?: { id: string; ref: string; title: string } | null;
  /** Set in list loader payload; used for sprint / project filters. */
  projectId?: string | null;
  project?: { id: string; name: string; ticketKeyPrefix: string } | null;
  storyPoints?: number | null;
  tags?: { id: string; name: string }[];
  /** Sprints this ticket belongs to (membership + implicit scope — same rules as the sprint board). */
  sprints?: { id: string; name: string }[];
  commentsCount: number;
  duplicatesCount?: number;
  createdAt: string;
  viewerContext?: "submitter" | "mentioned";
  duplicateOf?: { canonicalId: string } | null;
  linkedPRs?: TicketLinkedPRSummaryRow[];
  /** Current sprint membership when returned by API (detail/list enrichment). */
  sprint?: { id: string; name: string } | null;
}

export interface TicketReport {
  id: string;
  shortId: number;
  ref: string;
  source?: TicketSource;
  environment?: string | null;
  type: TicketTypeKind;
  title: string;
  description: string;
  screenshot: string | null;
  videoUrl: string | null;
  pageUrl: string | null;
  status: TicketStatus;
  priority?: "LOW" | "MEDIUM" | "HIGH" | null;
  adminNote: string | null;
  projectId?: string | null;
  project?: { id: string; name: string; ticketKeyPrefix?: string; githubConnected?: boolean } | null;
  storyPoints?: number | null;
  tags?: { id: string; name: string }[];
  createdAt: string;
  user: { id: string; name: string | null; email: string };
  assignee?: { id: string; name: string | null; email: string } | null;
  parent?: { id: string; ref: string; title: string; shortId?: number } | null;
  childTickets?: TicketHierarchyRow[];
  siblingTickets?: TicketHierarchyRow[];
  commentsCount?: number;
  duplicatesCount?: number;
  viewerContext?: "submitter" | "mentioned";
  duplicateOf?: {
    canonicalId: string;
    canonical: { id: string; shortId: number; ref: string; title: string };
  } | null;
  canonicalDuplicates?: TicketDuplicateLink[];
  /** Current sprint membership (at most one sprint enforced by UI/API). */
  sprint?: { id: string; name: string } | null;
  linkedPRs?: TicketLinkedPRRow[];
}

export interface TicketLinkedPRRow {
  id: string;
  repoOwner: string;
  repoName: string;
  prNumber: number;
  prUrl: string;
  prTitle: string | null;
  status: "OPEN" | "MERGED" | "CLOSED";
  checksStatus: "PENDING" | "IN_PROGRESS" | "SUCCESS" | "FAILURE";
  createdAt: string;
  comments?: TicketLinkedPRCommentRow[];
}

export interface TicketLinkedPRCommentRow {
  id: string;
  commentType: "ISSUE_COMMENT" | "REVIEW";
  authorLogin: string;
  authorAvatarUrl: string | null;
  body: string;
  htmlUrl: string;
  /** Lower-case GitHub review state when commentType === "REVIEW". */
  reviewState: string | null;
  postedAt: string;
}
