-- Semantic duplicate detection: pgvector extension + ticket embedding column.
-- Uses 768-dimensional vectors (Google text-embedding-004 output size).

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "embedding" vector(768);

-- ivfflat index for approximate nearest-neighbor cosine similarity search.
-- `lists = 100` is a sensible default for up to ~1M rows; tune later if needed.
CREATE INDEX IF NOT EXISTS "tickets_embedding_cosine_idx"
  ON "tickets"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);
