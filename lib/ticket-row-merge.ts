import type { TicketReport, TicketRow } from "@/components/tickets/ticket-types";

/**
 * Applies fields from a PATCH/detail `TicketReport` onto an existing list row.
 * Preserves list-only fields when the report omits them.
 */
export function mergeTicketReportIntoRow(existing: TicketRow, report: TicketReport): TicketRow {
  const project =
    report.project === undefined
      ? existing.project
      : report.project
        ? {
            id: report.project.id,
            name: report.project.name,
            ticketKeyPrefix:
              report.project.ticketKeyPrefix ?? existing.project?.ticketKeyPrefix ?? "",
          }
        : null;

  const duplicateOf =
    report.duplicateOf === undefined
      ? existing.duplicateOf
      : report.duplicateOf
        ? { canonicalId: report.duplicateOf.canonicalId }
        : null;

  return {
    ...existing,
    id: report.id,
    shortId: report.shortId,
    ref: report.ref,
    type: report.type,
    title: report.title,
    description: report.description,
    status: report.status,
    priority: report.priority ?? null,
    user: report.user,
    assignee: report.assignee ?? null,
    projectId: report.projectId !== undefined ? report.projectId : existing.projectId,
    project,
    storyPoints: report.storyPoints !== undefined ? report.storyPoints : existing.storyPoints,
    tags: report.tags !== undefined ? report.tags : existing.tags,
    parent:
      report.parent !== undefined
        ? report.parent
          ? { id: report.parent.id, ref: report.parent.ref, title: report.parent.title }
          : null
        : existing.parent,
    commentsCount: report.commentsCount ?? existing.commentsCount,
    duplicatesCount: report.duplicatesCount ?? existing.duplicatesCount,
    duplicateOf,
    createdAt: report.createdAt,
    viewerContext: report.viewerContext ?? existing.viewerContext,
  };
}
