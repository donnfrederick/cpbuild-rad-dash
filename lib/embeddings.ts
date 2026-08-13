import "server-only";
import { embed, embedMany } from "ai";
import { getGoogleGenerativeAI } from "@/lib/google-generative-ai";
import { db } from "@/lib/db";

/**
 * Default cosine similarity threshold for considering two tickets likely duplicates.
 * Tune this single constant to adjust aggressiveness globally. Agent tools accept
 * per-call overrides but fall back to this default.
 */
export const DEFAULT_DUPLICATE_THRESHOLD = 0.85;

/**
 * Expected embedding dimensionality (must match pgvector column: vector(768)).
 *
 * We use Google's `gemini-embedding-001`, which natively returns 3072-dim
 * vectors but supports Matryoshka-style truncation via `outputDimensionality`.
 * We explicitly ask for 768 dims so the output fits the existing pgvector
 * column and keeps the ivfflat index usable.
 */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Google embedding model. `text-embedding-004` was deprecated from the
 * `@ai-sdk/google` typings; the current supported IDs are
 * `gemini-embedding-001` (GA) and `gemini-embedding-2-preview`.
 */
const EMBEDDING_MODEL_ID = "gemini-embedding-001";

/**
 * Provider options applied to every embed / embedMany call.
 * - `outputDimensionality`: shrink 3072 → 768 so we don't have to grow the
 *   pgvector column. Cosine similarity still works after truncation.
 * - `taskType`: `SEMANTIC_SIMILARITY` is the right task for duplicate
 *   detection (as opposed to RETRIEVAL_* or CLASSIFICATION).
 */
const EMBEDDING_PROVIDER_OPTIONS = {
  google: {
    outputDimensionality: EMBEDDING_DIMENSIONS,
    taskType: "SEMANTIC_SIMILARITY" as const,
  },
};

function composeTicketText(title: string, description: string): string {
  const t = title.trim();
  const d = description.trim();
  if (!t && !d) return "";
  if (!d) return t;
  return `${t}\n\n${d}`;
}

/**
 * Format a JS number[] as a pgvector literal: "[0.1,0.2,...]".
 * Using this + a ::vector cast lets us bind the value as a text parameter and
 * have Postgres parse it — avoiding the need for a vector-aware driver.
 */
function vectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

/**
 * Generate an embedding for a ticket's title + description.
 * Throws on failure — callers decide whether to swallow the error.
 */
export async function generateTicketEmbedding(
  title: string,
  description: string
): Promise<number[]> {
  const text = composeTicketText(title, description);
  if (!text) {
    throw new Error("Cannot embed empty ticket text");
  }
  const { embedding } = await embed({
    model: getGoogleGenerativeAI().textEmbeddingModel(EMBEDDING_MODEL_ID),
    value: text,
    providerOptions: EMBEDDING_PROVIDER_OPTIONS,
  });
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Unexpected embedding shape: got ${Array.isArray(embedding) ? embedding.length : typeof embedding}, expected ${EMBEDDING_DIMENSIONS}`
    );
  }
  return embedding;
}

/**
 * Generate embeddings for many ticket texts at once (more efficient for backfill).
 */
export async function generateTicketEmbeddings(
  inputs: Array<{ title: string; description: string }>
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const values = inputs.map((i) => composeTicketText(i.title, i.description));
  const { embeddings } = await embedMany({
    model: getGoogleGenerativeAI().textEmbeddingModel(EMBEDDING_MODEL_ID),
    values,
    providerOptions: EMBEDDING_PROVIDER_OPTIONS,
  });
  return embeddings;
}

/**
 * Persist a ticket's embedding via raw SQL (Prisma's generated client cannot
 * bind `vector` columns directly because the type is Unsupported).
 */
export async function storeTicketEmbedding(
  ticketId: string,
  embedding: number[]
): Promise<void> {
  const literal = vectorLiteral(embedding);
  await db.$executeRaw`
    UPDATE "tickets"
    SET "embedding" = ${literal}::vector
    WHERE "id" = ${ticketId}
  `;
}

export interface SimilarTicket {
  id: string;
  shortId: number;
  title: string;
  similarity: number;
}

interface FindSimilarOptions {
  threshold?: number;
  limit?: number;
  excludeId?: string;
  projectId?: string;
  /** Exclude tickets that are already marked as duplicates of a canonical. */
  excludeExistingDuplicates?: boolean;
  /** Exclude ARCHIVED tickets. Default true. */
  excludeArchived?: boolean;
  /**
   * Exclude pairs the user explicitly "kept separate" via TicketDuplicateDismissal.
   * Only applies when `excludeId` is provided (otherwise there's no "current"
   * ticket to pair the candidates against). Default true.
   */
  excludeDismissed?: boolean;
}

/**
 * Find tickets whose embedding is most similar to the given embedding vector.
 * Returns tickets sorted by descending similarity (1 - cosine distance).
 */
export async function findSimilarByEmbedding(
  embedding: number[],
  options: FindSimilarOptions = {}
): Promise<SimilarTicket[]> {
  const {
    threshold = DEFAULT_DUPLICATE_THRESHOLD,
    limit = 5,
    excludeId,
    projectId,
    excludeExistingDuplicates = true,
    excludeArchived = true,
    excludeDismissed = true,
  } = options;

  const literal = vectorLiteral(embedding);
  // Dismissal exclusion only makes sense when we know which ticket is the
  // "current" one being compared against. Without that, a candidate pair
  // can't be derived. Callers that omit `excludeId` (e.g. pre-create) will
  // simply skip this filter.
  const applyDismissalFilter = excludeDismissed && !!excludeId;

  const rows = await db.$queryRaw<
    Array<{ id: string; shortId: number; title: string; similarity: number }>
  >`
    SELECT
      t."id" AS "id",
      t."shortId" AS "shortId",
      t."title" AS "title",
      1 - (t."embedding" <=> ${literal}::vector) AS "similarity"
    FROM "tickets" t
    LEFT JOIN "ticket_duplicates" td ON td."duplicateId" = t."id"
    WHERE t."embedding" IS NOT NULL
      AND (${excludeId}::text IS NULL OR t."id" <> ${excludeId})
      AND (${projectId}::text IS NULL OR t."projectId" = ${projectId})
      AND (NOT ${excludeExistingDuplicates} OR td."id" IS NULL)
      AND (NOT ${excludeArchived} OR t."status" <> 'ARCHIVED')
      AND (
        NOT ${applyDismissalFilter}
        OR NOT EXISTS (
          SELECT 1 FROM "ticket_duplicate_dismissals" d
          WHERE d."ticketAId" = LEAST(${excludeId}::text, t."id")
            AND d."ticketBId" = GREATEST(${excludeId}::text, t."id")
        )
      )
      AND (1 - (t."embedding" <=> ${literal}::vector)) >= ${threshold}
    ORDER BY t."embedding" <=> ${literal}::vector ASC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    id: r.id,
    shortId: Number(r.shortId),
    title: r.title,
    similarity: Number(r.similarity),
  }));
}

/**
 * Find tickets similar to an existing ticket by id.
 * Loads the target ticket's embedding, then delegates to findSimilarByEmbedding.
 * Returns null if the ticket has no embedding yet (needs backfill).
 */
export async function findSimilarToTicket(
  ticketId: string,
  options: Omit<FindSimilarOptions, "excludeId"> = {}
): Promise<SimilarTicket[] | null> {
  const rows = await db.$queryRaw<Array<{ embedding: string | null }>>`
    SELECT "embedding"::text AS "embedding"
    FROM "tickets"
    WHERE "id" = ${ticketId}
    LIMIT 1
  `;

  const raw = rows[0]?.embedding;
  if (!raw) return null;

  // pgvector renders as "[0.1,0.2,...]" when cast to text.
  const parsed = raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((n) => Number(n));
  if (parsed.length !== EMBEDDING_DIMENSIONS || parsed.some((n) => Number.isNaN(n))) {
    return null;
  }

  return findSimilarByEmbedding(parsed, { ...options, excludeId: ticketId });
}

export interface DuplicateCluster {
  canonical: { id: string; shortId: number; title: string };
  duplicates: Array<{ id: string; shortId: number; title: string; similarity: number }>;
}

/**
 * Audit the inbox for likely duplicate clusters.
 *
 * Strategy: for each non-archived, non-duplicate ticket with an embedding,
 * find its nearest neighbor above the threshold. Cluster by canonical
 * (lower shortId wins as canonical so clusters are deterministic).
 *
 * This is O(N log N) for small N via pgvector's ivfflat index, which is
 * acceptable for audits up to a few thousand tickets. For larger inboxes
 * we'd move this to a background job.
 */
export async function auditDuplicateClusters(options: {
  threshold?: number;
  limit?: number;
  projectId?: string;
} = {}): Promise<DuplicateCluster[]> {
  const {
    threshold = DEFAULT_DUPLICATE_THRESHOLD,
    limit = 10,
    projectId,
  } = options;

  // Pull all candidate tickets (id + shortId + title + embedding as text) once.
  const candidates = await db.$queryRaw<
    Array<{ id: string; shortId: number; title: string; embedding: string }>
  >`
    SELECT
      t."id" AS "id",
      t."shortId" AS "shortId",
      t."title" AS "title",
      t."embedding"::text AS "embedding"
    FROM "tickets" t
    LEFT JOIN "ticket_duplicates" td ON td."duplicateId" = t."id"
    WHERE t."embedding" IS NOT NULL
      AND t."status" <> 'ARCHIVED'
      AND td."id" IS NULL
      AND (${projectId}::text IS NULL OR t."projectId" = ${projectId})
  `;

  if (candidates.length < 2) return [];

  // Pairwise nearest-neighbor search using the index — one query per ticket.
  const seen = new Set<string>();
  const clusters = new Map<string, DuplicateCluster>();

  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;

    const vec = candidate.embedding
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((n) => Number(n));
    if (vec.length !== EMBEDDING_DIMENSIONS) continue;

    const neighbors = await findSimilarByEmbedding(vec, {
      threshold,
      limit: 5,
      excludeId: candidate.id,
      projectId,
    });

    if (neighbors.length === 0) continue;

    // Canonical = lowest shortId in the cluster.
    const members = [
      { id: candidate.id, shortId: Number(candidate.shortId), title: candidate.title, similarity: 1 },
      ...neighbors,
    ];
    const canonicalMember = members.reduce((a, b) => (a.shortId < b.shortId ? a : b));
    const canonicalKey = canonicalMember.id;

    if (clusters.has(canonicalKey)) {
      const cluster = clusters.get(canonicalKey)!;
      for (const m of members) {
        if (m.id === canonicalKey) continue;
        if (cluster.duplicates.some((d) => d.id === m.id)) continue;
        cluster.duplicates.push({
          id: m.id,
          shortId: m.shortId,
          title: m.title,
          similarity: m.similarity,
        });
        seen.add(m.id);
      }
    } else {
      clusters.set(canonicalKey, {
        canonical: {
          id: canonicalMember.id,
          shortId: canonicalMember.shortId,
          title: canonicalMember.title,
        },
        duplicates: members
          .filter((m) => m.id !== canonicalKey)
          .map((m) => ({
            id: m.id,
            shortId: m.shortId,
            title: m.title,
            similarity: m.similarity,
          })),
      });
      for (const m of members) seen.add(m.id);
    }
  }

  return Array.from(clusters.values())
    .sort((a, b) => {
      const aTop = Math.max(...a.duplicates.map((d) => d.similarity), 0);
      const bTop = Math.max(...b.duplicates.map((d) => d.similarity), 0);
      return bTop - aTop;
    })
    .slice(0, limit);
}
