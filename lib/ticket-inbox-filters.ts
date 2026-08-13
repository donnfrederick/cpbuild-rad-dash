/**
 * Client-side filters for the ticket inbox list (single-environment app; no prod merge).
 */

export type TicketInboxView = "all" | "mine";

export type TicketInboxTypeFilter =
  | "ALL"
  | "BUG"
  | "FEATURE_REQUEST"
  | "FEEDBACK"
  | "MINOR_ENHANCEMENT"
  | "REGRESSION"
  | "SECURITY_IMPROVEMENT";

export type TicketInboxPriorityFilter = "ALL" | "NONE" | "LOW" | "MEDIUM" | "HIGH";

/** Selected tag ids; empty means no tag filter. Tickets matching any selected tag are shown (OR). */
export type TicketInboxTagFilter = readonly string[];

export interface TicketInboxRowShape {
  assignee?: { id: string; name?: string | null; email?: string | null } | null;
  status: string;
  type: string;
  priority?: string | null;
  title: string;
  description: string;
  tags?: ReadonlyArray<{ id: string; name: string }>;
}

export interface TicketInboxFilterCriteria {
  view: TicketInboxView;
  currentUserId: string;
  typeFilter: TicketInboxTypeFilter;
  priorityFilter: TicketInboxPriorityFilter;
  tagFilter: TicketInboxTagFilter;
  search: string;
}

export function filterTicketInboxRows<T extends TicketInboxRowShape>(
  rows: T[],
  criteria: TicketInboxFilterCriteria
): T[] {
  let out = rows;

  if (criteria.view === "mine") {
    out = out.filter((r) => r.assignee?.id === criteria.currentUserId);
  }

  if (criteria.typeFilter !== "ALL") {
    out = out.filter((r) => r.type === criteria.typeFilter);
  }

  if (criteria.priorityFilter === "NONE") {
    out = out.filter((r) => r.priority == null);
  } else if (criteria.priorityFilter !== "ALL") {
    out = out.filter((r) => r.priority === criteria.priorityFilter);
  }

  if (criteria.tagFilter.length > 0) {
    const wanted = new Set(criteria.tagFilter);
    out = out.filter((r) => r.tags?.some((tag) => wanted.has(tag.id)) ?? false);
  }

  if (criteria.search.length > 0) {
    const q = criteria.search;
    out = out.filter((r) => {
      const t = `${r.title} ${r.description}`.toLowerCase();
      return t.includes(q);
    });
  }

  return out;
}
