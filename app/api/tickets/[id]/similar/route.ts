import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import { userCanViewTicket } from "@/lib/ticket-access";
import { findSimilarToTicket, DEFAULT_DUPLICATE_THRESHOLD } from "@/lib/embeddings";
import { buildTicketRefFromParts } from "@/lib/ticket-display-ref";
import type { TicketStatus } from "@/components/tickets/ticket-types";

interface SimilarCandidate {
  id: string;
  ref: string;
  shortId: number;
  title: string;
  status: TicketStatus;
  priority: "LOW" | "MEDIUM" | "HIGH" | null;
  similarity: number;
}

export interface TicketSimilarResponse {
  candidates: SimilarCandidate[];
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const ticket = await db.ticket.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      projectId: true,
      status: true,
      duplicateOf: { select: { canonicalId: true } },
    },
  });
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  const allowed = await userCanViewTicket({
    viewerId: ctx.user.id,
    role: ctx.user.role,
    ticket,
    specialPermissions: ctx.user.specialPermissions,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 20 ? limitParam : 5;
  const thresholdParam = Number(url.searchParams.get("threshold"));
  const threshold =
    Number.isFinite(thresholdParam) && thresholdParam >= 0 && thresholdParam <= 1
      ? thresholdParam
      : DEFAULT_DUPLICATE_THRESHOLD;

  const similar = await findSimilarToTicket(id, {
    threshold,
    limit,
    projectId: ticket.projectId ?? undefined,
  });

  if (!similar || similar.length === 0) {
    return NextResponse.json({ candidates: [] } satisfies TicketSimilarResponse);
  }

  // Hydrate with status + priority for the details panel UI.
  const ids = similar.map((s) => s.id);
  const hydrated = await db.ticket.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      status: true,
      priority: true,
      ticketScopeKey: true,
      ticketKeyNumber: true,
      project: { select: { ticketKeyPrefix: true } },
    },
  });
  const metaMap = new Map(hydrated.map((t) => [t.id, t]));

  const candidates: SimilarCandidate[] = similar
    .map((s): SimilarCandidate | null => {
      const meta = metaMap.get(s.id);
      if (!meta) return null;
      return {
        id: s.id,
        ref: buildTicketRefFromParts(
          meta.ticketScopeKey,
          meta.ticketKeyNumber,
          meta.project?.ticketKeyPrefix
        ),
        shortId: s.shortId,
        title: s.title,
        status: meta.status as TicketStatus,
        priority: meta.priority,
        similarity: s.similarity,
      };
    })
    .filter((v): v is SimilarCandidate => v !== null);

  return NextResponse.json({ candidates } satisfies TicketSimilarResponse);
}
