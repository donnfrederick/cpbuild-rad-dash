import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  DEFAULT_DUPLICATE_THRESHOLD,
  auditDuplicateClusters,
  findSimilarToTicket,
} from "@/lib/embeddings";
import {
  buildRefFromTicketRow,
  findTicketIdByRefString,
  loadTicketDisplayRefsByIds,
} from "@/lib/ticket-ref-resolve";

// ─── Shared helpers ──────────────────────────────────────────────────────────

function displayName(u: { name: string | null; email: string }): string {
  return u.name?.trim() || u.email;
}

// ─── Schema types ─────────────────────────────────────────────────────────────

const searchTicketsSchema = z.object({
  query: z.string().optional().describe("Free-text search across title and description"),
  status: z
    .enum(["BACKLOG", "READY", "IN_PROGRESS", "FOR_REVIEW", "RESOLVED", "TO_BE_DEPLOYED", "DONE", "ARCHIVED"])
    .optional()
    .describe("Filter by ticket status"),
  priority: z
    .enum(["LOW", "MEDIUM", "HIGH", "NONE"])
    .optional()
    .describe("Filter by priority. Use NONE to find tickets with no priority assigned (not yet triaged)."),
  type: z.string().optional().describe("Filter by ticket type (e.g. BUG, FEATURE_REQUEST, FEEDBACK, MINOR_ENHANCEMENT, REGRESSION, SECURITY_IMPROVEMENT, or a custom team type)"),
  assigneeEmail: z.string().optional().describe("Filter by assignee email (partial match)"),
  noAssignee: z
    .boolean()
    .optional()
    .describe(
      "If true, only return tickets that have no assignee (shown as Unassigned in the UI). Takes precedence over assigneeEmail if both are provided."
    ),
  projectId: z.string().optional().describe("Filter by project UUID — only return tickets belonging to this project"),
  noProject: z.boolean().optional().describe("If true, only return tickets that have no project assigned"),
  limit: z.number().int().min(1).max(20).optional().default(10).describe("Max results to return"),
});
type SearchTicketsInput = z.infer<typeof searchTicketsSchema>;

const getTicketSchema = z.object({
  ref: z.string().describe(
    "Ticket reference — project-scoped key like PREFIX-0042, UN-0042 (unassigned), legacy RAD-0042, or raw UUID"
  ),
});
type GetTicketInput = z.infer<typeof getTicketSchema>;

const getTicketAnalyticsSchema = z.object({
  groupBy: z
    .enum(["status", "priority", "type", "assignee"])
    .describe("The dimension to group counts by"),
  projectId: z
    .string()
    .optional()
    .describe("Optional: restrict analytics to a specific project ID"),
  excludeArchived: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to exclude ARCHIVED tickets (default: true)"),
});
type GetTicketAnalyticsInput = z.infer<typeof getTicketAnalyticsSchema>;

const getAppHelpSchema = z.object({
  topic: z.string().describe(
    "The help topic or question, e.g. 'how do I create a ticket', 'what does ARCHIVED status mean'"
  ),
});
type GetAppHelpInput = z.infer<typeof getAppHelpSchema>;

// ─── Read tools (auto-execute on server) ─────────────────────────────────────

export const searchTickets = tool({
  description:
    "Search tickets in the RAD Dashboard. Supports filtering by status, priority (including NONE for tickets with no priority assigned), type, assignee email, unassigned status (noAssignee), a free-text query that matches title and description, and project. Returns up to 20 results.",
  inputSchema: searchTicketsSchema,
  execute: async (input: SearchTicketsInput) => {
    const { query, status, priority, type, assigneeEmail, noAssignee, projectId, noProject, limit } = input;

    const where: Prisma.TicketWhereInput = {
      duplicateOf: null,
    };

    if (status) where.status = status;
    if (priority === "NONE") {
      where.priority = null;
    } else if (priority) {
      where.priority = priority;
    }
    if (type) where.type = type;
    if (projectId) where.projectId = projectId;
    if (noProject) where.projectId = null;

    if (query?.trim()) {
      const q = query.trim();
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ];
    }

    if (assigneeEmail?.trim()) {
      where.assignee = { email: { contains: assigneeEmail.trim(), mode: "insensitive" } };
    }

    if (noAssignee) {
      delete where.assignee;
      where.assigneeId = null;
    }

    const tickets = await db.ticket.findMany({
      where,
      select: {
        id: true,
        shortId: true,
        ticketScopeKey: true,
        ticketKeyNumber: true,
        title: true,
        status: true,
        priority: true,
        type: true,
        createdAt: true,
        assignee: { select: { name: true, email: true } },
        project: { select: { name: true, ticketKeyPrefix: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit ?? 10,
    });

    if (tickets.length === 0) {
      return { count: 0, tickets: [] as Array<{ ref: string; id: string; title: string; status: string; priority: string; type: string; assignee: string; project: string; createdAt: string }>, message: "No tickets found matching those filters." };
    }

    const result = {
      count: tickets.length,
      tickets: tickets.map((t) => ({
        ref: buildRefFromTicketRow({
          ticketScopeKey: t.ticketScopeKey,
          ticketKeyNumber: t.ticketKeyNumber,
          project: t.project ? { ticketKeyPrefix: t.project.ticketKeyPrefix } : null,
        }),
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority ?? "none",
        type: t.type,
        assignee: t.assignee ? displayName(t.assignee) : "Unassigned",
        project: t.project?.name ?? "Unassigned",
        createdAt: t.createdAt.toISOString(),
      })),
    };
    return result;
  },
});

export const getTicket = tool({
  description:
    "Get the full details of a single ticket. Accepts a display ref (PREFIX-0042, UN-0042, legacy RAD-0042) or a UUID.",
  inputSchema: getTicketSchema,
  execute: async (input: GetTicketInput) => {
    const { ref } = input;
    const id = await findTicketIdByRefString(ref);
    if (!id) {
      return { found: false as const, message: `Ticket ${ref} not found.` };
    }

    const ticket = await db.ticket.findFirst({
      where: { id },
      include: {
        user: { select: { name: true, email: true } },
        assignee: { select: { name: true, email: true } },
        project: { select: { id: true, name: true, ticketKeyPrefix: true } },
        tags: { select: { name: true }, orderBy: { name: "asc" } },
        _count: { select: { comments: { where: { deletedAt: null } } } },
      },
    });

    if (!ticket) {
      return { found: false as const, message: `Ticket ${ref} not found.` };
    }

    return {
      found: true as const,
      ref: buildRefFromTicketRow({
        ticketScopeKey: ticket.ticketScopeKey,
        ticketKeyNumber: ticket.ticketKeyNumber,
        project: ticket.project ? { ticketKeyPrefix: ticket.project.ticketKeyPrefix } : null,
      }),
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority ?? "none",
      type: ticket.type,
      source: ticket.source,
      submittedBy: displayName(ticket.user),
      assignee: ticket.assignee ? displayName(ticket.assignee) : "Unassigned",
      project: ticket.project?.name ?? "Unassigned",
      tags: ticket.tags.map((t) => t.name),
      storyPoints: ticket.storyPoints ?? null,
      adminNote: ticket.adminNote ?? null,
      commentsCount: ticket._count.comments,
      pageUrl: ticket.pageUrl ?? null,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
    };
  },
});

export const listProjects = tool({
  description: "List all projects in RAD Dashboard with ticket counts.",
  inputSchema: z.object({}),
  execute: async () => {
    const projects = await db.project.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        _count: { select: { tickets: true } },
      },
      orderBy: { name: "asc" },
    });

    if (projects.length === 0) {
      return { count: 0 as const, projects: [] as Array<{ id: string; name: string; description: string | null; totalTickets: number }>, message: "No projects found." };
    }

    return {
      count: projects.length,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? null,
        totalTickets: p._count.tickets,
      })),
    };
  },
});

export const getTicketAnalytics = tool({
  description:
    "Get ticket counts grouped by status, priority, type, or assignee. Useful for answering questions like 'how many open bugs are there?' or 'what is the breakdown by priority?'",
  inputSchema: getTicketAnalyticsSchema,
  execute: async (input: GetTicketAnalyticsInput) => {
    const { groupBy, projectId, excludeArchived } = input;

    const baseWhere: Prisma.TicketWhereInput = {
      duplicateOf: null,
    };
    if (projectId) baseWhere.projectId = projectId;
    if (excludeArchived) {
      baseWhere.status = { not: "ARCHIVED" };
    }

    if (groupBy === "status") {
      const statuses = [
        "BACKLOG",
        "READY",
        "IN_PROGRESS",
        "FOR_REVIEW",
        "RESOLVED",
        "TO_BE_DEPLOYED",
        "DONE",
        "ARCHIVED",
      ] as const;

      const counts = await Promise.all(
        statuses.map(async (s) => ({
          label: s,
          count: await db.ticket.count({ where: { ...baseWhere, status: s } }),
        }))
      );
      return { groupBy, breakdown: counts.filter((c) => c.count > 0) };
    }

    if (groupBy === "priority") {
      const priorities = ["HIGH", "MEDIUM", "LOW"] as const;
      const withPriority = await Promise.all(
        priorities.map(async (p) => ({
          label: p,
          count: await db.ticket.count({ where: { ...baseWhere, priority: p } }),
        }))
      );
      const noneCount = await db.ticket.count({ where: { ...baseWhere, priority: null } });
      const counts = [...withPriority, { label: "NONE", count: noneCount }];
      return { groupBy, breakdown: counts.filter((c) => c.count > 0) };
    }

    if (groupBy === "type") {
      const distinctTypes = await db.ticket.groupBy({
        by: ["type"],
        where: baseWhere,
        _count: { _all: true },
      });
      const counts = distinctTypes.map((row) => ({
        label: row.type,
        count: row._count._all,
      }));
      return { groupBy, breakdown: counts.filter((c) => c.count > 0) };
    }

    if (groupBy === "assignee") {
      const tickets = await db.ticket.findMany({
        where: baseWhere,
        select: { assignee: { select: { name: true, email: true } } },
      });

      const tally: Record<string, number> = {};
      for (const t of tickets) {
        const label = t.assignee ? displayName(t.assignee) : "Unassigned";
        tally[label] = (tally[label] ?? 0) + 1;
      }

      const breakdown = Object.entries(tally)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);

      return { groupBy, breakdown };
    }

    return { groupBy, breakdown: [] as Array<{ label: string; count: number }> };
  },
});

export const getAppHelp = tool({
  description:
    "Answer how-to questions about using RAD Dashboard. Returns guidance on using the app's features.",
  inputSchema: getAppHelpSchema,
  execute: async (input: GetAppHelpInput) => {
    const { topic } = input;
    const t = topic.toLowerCase();

    const helpContent: Record<string, string> = {
      create_ticket: `To create a ticket, click the **+ New Ticket** button in the top bar of the Ticket Inbox. Fill in the title, description, and type (Bug, Feature Request, or Feedback). Project is optional — leave unassigned or pick a project. Optionally set priority, tags, and assignee if you have triage access.`,

      status: `Ticket statuses in order of workflow:
- **BACKLOG** (shown in the app as **Planning**) — newly submitted, not yet triaged
- **READY** — triaged and ready to be picked up
- **IN_PROGRESS** — actively being worked on
- **FOR_REVIEW** — work done, awaiting review
- **RESOLVED** — resolved, pending deployment
- **TO_BE_DEPLOYED** — ready to go to production
- **DONE** — deployed and verified
- **ARCHIVED** — closed or won't-fix; hidden from main inbox`,

      priority: `Priorities are **HIGH**, **MEDIUM**, and **LOW**. Only users with triage access can set or change priority. Unset priority means the ticket has not been triaged yet.`,

      assign: `To assign a ticket, open the ticket detail view and click the assignee field. Only users with appropriate roles can be assigned. You need triage access to change assignees.`,

      comment: `To add a comment, open the ticket detail view and scroll to the comment section at the bottom. You can also attach files (images, videos) to comments.`,

      project: `Projects group related tickets together. Navigate to Projects in the sidebar to see all projects. Tickets can be assigned to a project from their detail view.`,

      search: `Use the search bar at the top of the Ticket Inbox to search by title. Use the filter buttons to filter by status, type, priority, or tags. You can also switch between "All Tickets" and "My Tickets".`,

      duplicate: `To mark a ticket as a duplicate, open the ticket detail view and use the "Link as duplicate" option. This hides the duplicate from the main inbox and links it to the canonical ticket.`,

      tags: `Tags help categorize tickets. You can add tags from the ticket detail view (triage access required). Tags can be filtered from the inbox filter bar.`,

      archive: `To archive a ticket, change its status to ARCHIVED from the ticket detail view (triage access required). Archived tickets are hidden from the main inbox but accessible via the Archived tab.`,
    };

    if (t.includes("creat") && t.includes("ticket")) return { help: helpContent.create_ticket };
    if (t.includes("status") || t.includes("backlog") || t.includes("planning") || t.includes("archived") || t.includes("progress") || t.includes("done")) return { help: helpContent.status };
    if (t.includes("priority") || t.includes("high") || t.includes("medium") || t.includes("low")) return { help: helpContent.priority };
    if (t.includes("assign")) return { help: helpContent.assign };
    if (t.includes("comment") || t.includes("reply")) return { help: helpContent.comment };
    if (t.includes("project")) return { help: helpContent.project };
    if (t.includes("search") || t.includes("filter") || t.includes("find")) return { help: helpContent.search };
    if (t.includes("duplicat")) return { help: helpContent.duplicate };
    if (t.includes("tag")) return { help: helpContent.tags };
    if (t.includes("archiv")) return { help: helpContent.archive };

    return {
      help: `RAD Dashboard is the RAD team's internal ticket and project tracking tool. You can:
- **Create tickets** (bugs or feature requests) using the + New Ticket button
- **Manage tickets** by updating status, priority, assignee, and tags (requires triage access)
- **Organise tickets** using projects and tags
- **Collaborate** via comments and @mentions
- **Track progress** through the status workflow: Planning (BACKLOG) → READY → IN_PROGRESS → FOR_REVIEW → RESOLVED → TO_BE_DEPLOYED → DONE

Ask me about any specific feature for more detailed help.`,
    };
  },
});

// ─── Semantic duplicate detection (read) ─────────────────────────────────────

const findDuplicateCandidatesSchema = z.object({
  ref: z
    .string()
    .describe(
      "Ticket reference: PREFIX-0042, UN-0042, legacy RAD-0042, or raw UUID. Finds other tickets that are semantically similar."
    ),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      `Cosine similarity threshold between 0 and 1. Only tickets scoring at or above this value are returned. Defaults to ${DEFAULT_DUPLICATE_THRESHOLD} (balanced).`
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Max candidates to return (default 5)."),
});
type FindDuplicateCandidatesInput = z.infer<typeof findDuplicateCandidatesSchema>;

export const findDuplicateCandidates = tool({
  description:
    "Find tickets that are semantically similar to a given ticket. Uses vector embeddings (pgvector + Google text-embedding-004) to detect duplicates even when the wording differs. Returns up to 10 candidates ordered by similarity, each scored 0–1. This is a READ tool — it does not link anything. To actually link a duplicate, use linkDuplicate (which requires user confirmation).",
  inputSchema: findDuplicateCandidatesSchema,
  execute: async (input: FindDuplicateCandidatesInput) => {
    const { ref, threshold, limit } = input;

    const sourceId = await findTicketIdByRefString(ref);
    if (!sourceId) {
      return { found: false as const, message: `Ticket ${ref} not found.` };
    }

    const source = await db.ticket.findFirst({
      where: { id: sourceId },
      select: { id: true, shortId: true, title: true, ticketScopeKey: true, ticketKeyNumber: true, project: { select: { ticketKeyPrefix: true } } },
    });

    if (!source) {
      return { found: false as const, message: `Ticket ${ref} not found.` };
    }

    const sourceRef = buildRefFromTicketRow({
      ticketScopeKey: source.ticketScopeKey,
      ticketKeyNumber: source.ticketKeyNumber,
      project: source.project,
    });

    const similar = await findSimilarToTicket(source.id, {
      threshold: threshold ?? DEFAULT_DUPLICATE_THRESHOLD,
      limit: limit ?? 5,
    });

    if (similar === null) {
      return {
        found: true as const,
        ref: sourceRef,
        sourceId: source.id,
        title: source.title,
        hasEmbedding: false as const,
        message:
          "This ticket has not been embedded yet. Run the embedding backfill script (npm run embeddings:backfill) so it can participate in semantic duplicate detection.",
        candidates: [] as Array<{
          ref: string;
          id: string;
          title: string;
          similarity: number;
        }>,
      };
    }

    const refById = await loadTicketDisplayRefsByIds([source.id, ...similar.map((s) => s.id)]);

    return {
      found: true as const,
      ref: sourceRef,
      sourceId: source.id,
      title: source.title,
      hasEmbedding: true as const,
      thresholdUsed: threshold ?? DEFAULT_DUPLICATE_THRESHOLD,
      candidates: similar.map((s) => ({
        ref: refById.get(s.id) ?? `?-${s.shortId}`,
        id: s.id,
        title: s.title,
        similarity: Math.round(s.similarity * 1000) / 1000,
      })),
    };
  },
});

const auditDuplicatesSchema = z.object({
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      `Cosine similarity threshold between 0 and 1. Pairs below this are not grouped. Defaults to ${DEFAULT_DUPLICATE_THRESHOLD}.`
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Max clusters to return (default 10)."),
  projectId: z
    .string()
    .optional()
    .describe("Optional: restrict the audit to tickets in a specific project."),
});
type AuditDuplicatesInput = z.infer<typeof auditDuplicatesSchema>;

export const auditDuplicates = tool({
  description:
    "Scan the whole ticket base (or one project) and surface clusters of tickets that look like duplicates of each other based on semantic similarity. Returns clusters of 2+ tickets with a suggested canonical (lowest internal id / stable) and the similarity of each member to that canonical. This is a READ-ONLY audit — no links are created. Use linkDuplicate (write tool, requires confirmation) to actually mark a duplicate.",
  inputSchema: auditDuplicatesSchema,
  execute: async (input: AuditDuplicatesInput) => {
    const { threshold, limit, projectId } = input;

    const clusters = await auditDuplicateClusters({
      threshold: threshold ?? DEFAULT_DUPLICATE_THRESHOLD,
      limit: limit ?? 10,
      projectId,
    });

    if (clusters.length === 0) {
      return {
        thresholdUsed: threshold ?? DEFAULT_DUPLICATE_THRESHOLD,
        clusterCount: 0,
        clusters: [] as Array<{
          canonical: { ref: string; id: string; title: string };
          duplicates: Array<{ ref: string; id: string; title: string; similarity: number }>;
        }>,
        message:
          "No probable duplicate clusters found at this threshold. Try lowering the threshold (e.g. 0.8) for a looser scan.",
      };
    }

    const refById = await loadTicketDisplayRefsByIds(
      clusters.flatMap((c) => [c.canonical.id, ...c.duplicates.map((d) => d.id)])
    );

    return {
      thresholdUsed: threshold ?? DEFAULT_DUPLICATE_THRESHOLD,
      clusterCount: clusters.length,
      clusters: clusters.map((c) => ({
        canonical: {
          ref: refById.get(c.canonical.id) ?? `?-${c.canonical.shortId}`,
          id: c.canonical.id,
          title: c.canonical.title,
        },
        duplicates: c.duplicates.map((d) => ({
          ref: refById.get(d.id) ?? `?-${d.shortId}`,
          id: d.id,
          title: d.title,
          similarity: Math.round(d.similarity * 1000) / 1000,
        })),
      })),
    };
  },
});

// ─── Write tools (NO execute — client must confirm before calling app API) ────

export const createTicket = tool({
  description:
    "Create a new ticket. The user must confirm this action before it is executed. Requires: title, description, and type. Priority, storyPoints, and projectId are optional.",
  inputSchema: z.object({
    title: z.string().min(1).max(120).describe("Ticket title (max 120 characters)"),
    description: z.string().min(1).max(4000).describe("Ticket description"),
    type: z.string().min(1).max(100).describe("Ticket type key — inferred from the user's request. Common values: BUG, FEATURE_REQUEST, FEEDBACK, MINOR_ENHANCEMENT, REGRESSION, SECURITY_IMPROVEMENT. Teams may also have custom types."),
    priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional().describe("Optional priority — inferred from urgency signals"),
    storyPoints: z.number().int().min(1).max(99).optional().describe("Optional story point estimate — inferred from scope"),
    projectId: z
      .string()
      .nullable()
      .optional()
      .describe("Project UUID from listProjects, or omit/null for no project"),
    projectName: z.string().optional().describe("Project name — shown in the confirmation UI only, not sent to the API"),
  }),
});

export const updateTicket = tool({
  description:
    "Update one or more fields on an existing ticket (status, priority, assignee, project). The user must confirm before the change is applied. Use the ticket's UUID id for the ticketId field (obtain it via getTicket or searchTickets). To set a project, obtain the project UUID via listProjects first.",
  inputSchema: z.object({
    ticketId: z.string().describe("The ticket UUID (not the display ref)"),
    ticketRef: z.string().describe("Display ref (e.g. PREFIX-0042) — shown in the confirmation UI"),
    status: z
      .enum(["BACKLOG", "READY", "IN_PROGRESS", "FOR_REVIEW", "RESOLVED", "TO_BE_DEPLOYED", "DONE", "ARCHIVED"])
      .optional()
      .describe("New status"),
    priority: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable().optional().describe("New priority"),
    assigneeId: z.string().nullable().optional().describe("New assignee user ID, or null to unassign"),
    projectId: z.string().nullable().optional().describe("New project UUID (from listProjects), or null to remove the project"),
    projectName: z.string().optional().describe("Project name — shown in the confirmation UI only"),
  }),
});

export const addComment = tool({
  description:
    "Add a comment to a ticket. The user must confirm before the comment is posted. Use the ticket UUID for ticketId.",
  inputSchema: z.object({
    ticketId: z.string().describe("The ticket UUID"),
    ticketRef: z.string().describe("Display ref — shown in the confirmation UI"),
    body: z.string().min(1).max(4000).describe("Comment body in plain text or markdown"),
  }),
});

export const linkDuplicate = tool({
  description:
    "Mark one ticket as a duplicate of another. The duplicate ticket is hidden from the main inbox and linked to the canonical. The user MUST confirm this action in the UI before it is executed — never link duplicates unilaterally. Use duplicateId = the ticket that will be marked as a duplicate; canonicalId = the ticket it is a duplicate of (typically the older / lower-numbered one). Always include similarity if available so the user can judge confidence.",
  inputSchema: z.object({
    duplicateId: z
      .string()
      .describe("UUID of the ticket that will be marked as a duplicate."),
    duplicateRef: z
      .string()
      .describe("Display ref for the duplicate ticket — shown in the confirmation UI."),
    canonicalId: z
      .string()
      .describe("UUID of the canonical ticket (the 'real' one that the duplicate points to)."),
    canonicalRef: z
      .string()
      .describe("Display ref for the canonical ticket — shown in the confirmation UI."),
    similarity: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Cosine similarity score (0–1) that justified the suggestion. Shown in the confirmation UI."),
    reason: z
      .string()
      .optional()
      .describe("Short one-sentence reason explaining why these two tickets look like duplicates. Shown in the confirmation UI."),
  }),
});

// ─── All tools export ────────────────────────────────────────────────────────

export const agentTools = {
  searchTickets,
  getTicket,
  listProjects,
  getTicketAnalytics,
  getAppHelp,
  findDuplicateCandidates,
  auditDuplicates,
  createTicket,
  updateTicket,
  addComment,
  linkDuplicate,
};
