import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { canViewProject } from "@/lib/project-management-server";
import { auditDuplicateClusters } from "@/lib/embeddings";
import { buildTicketRefFromParts } from "@/lib/ticket-display-ref";
import type { TicketStatus } from "@/components/tickets/ticket-types";

interface TicketSummary {
  id: string;
  ref: string;
  shortId: number;
  title: string;
  status: TicketStatus;
  priority: "LOW" | "MEDIUM" | "HIGH" | null;
}

interface ClusterSuggestion {
  ticket: TicketSummary;
  similarity: number;
}

interface Cluster {
  canonical: TicketSummary;
  suggestions: ClusterSuggestion[];
}

interface LinkedPair {
  id: string;
  canonical: TicketSummary;
  duplicate: TicketSummary;
  similarity: number | null;
  linkedAt: string;
}

export interface ProjectDuplicatesResponse {
  projectId: string;
  totals: {
    clusters: number;
    linkedPairs: number;
    pendingPairs: number;
  };
  clusters: Cluster[];
  linked: LinkedPair[];
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: projectId } = await params;

  const allowed = await canViewProject(
    ctx.user.id,
    ctx.user.role,
    ctx.user.specialPermissions,
    projectId
  );
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, ticketKeyPrefix: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const summaryOnly = url.searchParams.get("summary") === "1";
  const clusterLimit = summaryOnly ? 3 : 50;

  // Clusters of likely duplicates (semantic, above threshold, excluding already-linked/dismissed).
  const rawClusters = await auditDuplicateClusters({
    projectId,
    limit: clusterLimit,
  });

  // Hydrate cluster tickets with status + priority for richer UI rendering.
  const clusterTicketIds = new Set<string>();
  for (const c of rawClusters) {
    clusterTicketIds.add(c.canonical.id);
    for (const d of c.duplicates) clusterTicketIds.add(d.id);
  }
  const clusterTickets = clusterTicketIds.size > 0
    ? await db.ticket.findMany({
        where: { id: { in: Array.from(clusterTicketIds) } },
        select: {
          id: true,
          shortId: true,
          title: true,
          status: true,
          priority: true,
          ticketScopeKey: true,
          ticketKeyNumber: true,
        },
      })
    : [];
  const prefix = project.ticketKeyPrefix;
  const clusterTicketMap = new Map(
    clusterTickets.map((t) => {
      const row: TicketSummary = {
        id: t.id,
        ref: buildTicketRefFromParts(t.ticketScopeKey, t.ticketKeyNumber, prefix),
        shortId: t.shortId,
        title: t.title,
        status: t.status,
        priority: t.priority,
      };
      return [t.id, row] as const;
    })
  );

  const clusters: Cluster[] = rawClusters
    .map((c): Cluster | null => {
      const canonical = clusterTicketMap.get(c.canonical.id);
      if (!canonical) return null;
      const suggestions: ClusterSuggestion[] = c.duplicates
        .map((d) => {
          const ticket = clusterTicketMap.get(d.id);
          if (!ticket) return null;
          return { ticket, similarity: d.similarity };
        })
        .filter((v): v is ClusterSuggestion => v !== null);
      if (suggestions.length === 0) return null;
      return { canonical, suggestions };
    })
    .filter((c): c is Cluster => c !== null);

  // Already-linked duplicate pairs in this project (canonical scoped to projectId).
  const linkedRows = await db.ticketDuplicate.findMany({
    where: { canonical: { projectId } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      similarity: true,
      createdAt: true,
      canonical: {
        select: {
          id: true,
          shortId: true,
          title: true,
          status: true,
          priority: true,
          ticketScopeKey: true,
          ticketKeyNumber: true,
        },
      },
      duplicate: {
        select: {
          id: true,
          shortId: true,
          title: true,
          status: true,
          priority: true,
          ticketScopeKey: true,
          ticketKeyNumber: true,
        },
      },
    },
  });

  const toSummary = (t: {
    id: string;
    shortId: number;
    title: string;
    status: TicketStatus;
    priority: "LOW" | "MEDIUM" | "HIGH" | null;
    ticketScopeKey: string;
    ticketKeyNumber: number;
  }): TicketSummary => ({
    id: t.id,
    ref: buildTicketRefFromParts(t.ticketScopeKey, t.ticketKeyNumber, prefix),
    shortId: t.shortId,
    title: t.title,
    status: t.status,
    priority: t.priority,
  });

  const linked: LinkedPair[] = linkedRows.map((r) => ({
    id: r.id,
    canonical: toSummary(r.canonical),
    duplicate: toSummary(r.duplicate),
    similarity: r.similarity,
    linkedAt: r.createdAt.toISOString(),
  }));

  const pendingPairs = clusters.reduce((sum, c) => sum + c.suggestions.length, 0);

  const response: ProjectDuplicatesResponse = {
    projectId,
    totals: {
      clusters: clusters.length,
      linkedPairs: linked.length,
      pendingPairs,
    },
    clusters,
    linked,
  };

  return NextResponse.json(response);
}
