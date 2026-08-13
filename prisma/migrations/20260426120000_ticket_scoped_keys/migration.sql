-- Per-scope key counters
CREATE TABLE "ticket_key_counters" (
    "scopeKey" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ticket_key_counters_pkey" PRIMARY KEY ("scopeKey")
);

-- Project display prefix (e.g. RAD, ENG) — backfilled for existing rows, then required
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "ticketKeyPrefix" TEXT;

WITH n AS (
  SELECT
    id,
    ('RAD' || row_number() OVER (ORDER BY "createdAt" ASC, id ASC))::text AS p
  FROM "projects"
)
UPDATE "projects" pr
SET "ticketKeyPrefix" = n.p
FROM n
WHERE pr.id = n.id
  AND pr."ticketKeyPrefix" IS NULL;

ALTER TABLE "projects" ALTER COLUMN "ticketKeyPrefix" SET NOT NULL;
CREATE UNIQUE INDEX "projects_ticketKeyPrefix_key" ON "projects"("ticketKeyPrefix");

-- Ticket scoped keys
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "ticketScopeKey" TEXT;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "ticketKeyNumber" INTEGER;

UPDATE "tickets" t
SET
  "ticketScopeKey" = t."projectId",
  "ticketKeyNumber" = s.n
FROM (
  SELECT
    id,
    (row_number() OVER (PARTITION BY "projectId" ORDER BY "createdAt" ASC, id ASC))::int AS n
  FROM "tickets"
  WHERE "projectId" IS NOT NULL
) s
WHERE t.id = s.id
  AND t."ticketScopeKey" IS NULL;

UPDATE "tickets" t
SET
  "ticketScopeKey" = '__unassigned__',
  "ticketKeyNumber" = s.n
FROM (
  SELECT
    id,
    (row_number() OVER (ORDER BY "createdAt" ASC, id ASC))::int AS n
  FROM "tickets"
  WHERE "projectId" IS NULL
) s
WHERE t.id = s.id
  AND t."ticketScopeKey" IS NULL;

ALTER TABLE "tickets" ALTER COLUMN "ticketScopeKey" SET NOT NULL;
ALTER TABLE "tickets" ALTER COLUMN "ticketKeyNumber" SET NOT NULL;

CREATE UNIQUE INDEX "tickets_ticketScopeKey_ticketKeyNumber_key" ON "tickets"("ticketScopeKey", "ticketKeyNumber");
CREATE INDEX "tickets_ticketScopeKey_idx" ON "tickets"("ticketScopeKey");

INSERT INTO "ticket_key_counters" ("scopeKey", "lastNumber")
SELECT "ticketScopeKey", max("ticketKeyNumber")::int
FROM "tickets"
GROUP BY "ticketScopeKey"
ON CONFLICT ("scopeKey") DO UPDATE SET "lastNumber" = GREATEST(
  "ticket_key_counters"."lastNumber",
  EXCLUDED."lastNumber"
);
