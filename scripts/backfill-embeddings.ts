/**
 * Backfill semantic embeddings for every ticket that doesn't have one yet.
 *
 * Usage:
 *   DATABASE_URL=... GOOGLE_GENERATIVE_AI_API_KEY=... npx tsx scripts/backfill-embeddings.ts
 *   (GEMINI_API_KEY also works — same key, alternate name.)
 *   — or via the npm script: `npm run embeddings:backfill`
 *
 * Safe to re-run: skips tickets whose `embedding` column is already populated.
 * Processes in batches to stay under Gemini embedMany limits and to be friendly
 * to the database.
 *
 * Model choice and dimensions MUST stay in sync with `lib/embeddings.ts` —
 * mixing models/dimensions produces vectors that aren't comparable.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { embedMany } from "ai";
import { getGoogleGenerativeAiApiKey, getGoogleGenerativeAI } from "../lib/google-generative-ai";

const BATCH_SIZE = 50;
const EMBEDDING_MODEL_ID = "gemini-embedding-001";
const EXPECTED_DIMENSIONS = 768;
const EMBEDDING_PROVIDER_OPTIONS = {
  google: {
    outputDimensionality: EXPECTED_DIMENSIONS,
    taskType: "SEMANTIC_SIMILARITY" as const,
  },
};

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
if (!getGoogleGenerativeAiApiKey()) {
  console.error("Set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

function composeText(title: string, description: string): string {
  const t = title.trim();
  const d = description.trim();
  if (!t && !d) return "";
  if (!d) return t;
  return `${t}\n\n${d}`;
}

function vectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

async function main(): Promise<void> {
  console.log("[backfill] Starting ticket embedding backfill…");

  const pending = await prisma.$queryRaw<
    Array<{ id: string; title: string; description: string }>
  >`
    SELECT "id", "title", "description"
    FROM "tickets"
    WHERE "embedding" IS NULL
    ORDER BY "createdAt" ASC
  `;

  if (pending.length === 0) {
    console.log("[backfill] All tickets already have embeddings. Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  console.log(`[backfill] Found ${pending.length} tickets missing embeddings.`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const usable = batch.filter((t) => composeText(t.title, t.description).length > 0);

    if (usable.length === 0) {
      skipped += batch.length;
      continue;
    }

    const values = usable.map((t) => composeText(t.title, t.description));

    try {
      const { embeddings } = await embedMany({
        model: getGoogleGenerativeAI().textEmbeddingModel(EMBEDDING_MODEL_ID),
        values,
        providerOptions: EMBEDDING_PROVIDER_OPTIONS,
      });

      for (let j = 0; j < usable.length; j++) {
        const ticket = usable[j];
        const embedding = embeddings[j];
        if (!Array.isArray(embedding) || embedding.length !== EXPECTED_DIMENSIONS) {
          console.warn(
            `[backfill] Unexpected embedding shape for ticket ${ticket.id}; skipping.`
          );
          failed += 1;
          continue;
        }
        const literal = vectorLiteral(embedding);
        await prisma.$executeRaw`
          UPDATE "tickets"
          SET "embedding" = ${literal}::vector
          WHERE "id" = ${ticket.id}
        `;
        processed += 1;
      }

      console.log(
        `[backfill] Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${usable.length} embedded, ${batch.length - usable.length} empty-skipped.`
      );
      skipped += batch.length - usable.length;
    } catch (err) {
      console.error(
        `[backfill] Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`,
        err
      );
      failed += batch.length;
    }
  }

  console.log(
    `[backfill] Done. Embedded: ${processed}, skipped (empty): ${skipped}, failed: ${failed}.`
  );
  await prisma.$disconnect();
}

void main().catch(async (err: unknown) => {
  console.error("[backfill] Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
