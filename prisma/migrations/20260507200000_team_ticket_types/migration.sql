-- Step 1: Change Ticket.type from TicketType enum to plain VARCHAR
ALTER TABLE "tickets" ALTER COLUMN "type" TYPE VARCHAR(100) USING "type"::TEXT;

-- Step 2: Drop the old TicketType enum (no longer needed)
DROP TYPE IF EXISTS "TicketType";

-- Step 3: Create the team_ticket_types table
CREATE TABLE "team_ticket_types" (
    "id"        TEXT NOT NULL,
    "teamId"    TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "key"       TEXT NOT NULL,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_ticket_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_ticket_types_teamId_key_key" ON "team_ticket_types"("teamId", "key");
CREATE INDEX "team_ticket_types_teamId_idx" ON "team_ticket_types"("teamId");

ALTER TABLE "team_ticket_types" ADD CONSTRAINT "team_ticket_types_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 4: Seed the 6 built-in ticket types for every existing team
INSERT INTO "team_ticket_types" ("id", "teamId", "name", "key", "isBuiltIn", "isEnabled", "sortOrder", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    t.id,
    bt.name,
    bt.key,
    true,
    true,
    bt.sort_order,
    NOW(),
    NOW()
FROM "teams" t
CROSS JOIN (
    VALUES
        ('Bug',                 'BUG',                  0),
        ('Feature Request',     'FEATURE_REQUEST',      1),
        ('Feedback',            'FEEDBACK',             2),
        ('Minor Enhancement',   'MINOR_ENHANCEMENT',    3),
        ('Regression',          'REGRESSION',           4),
        ('Security Improvement','SECURITY_IMPROVEMENT', 5)
) AS bt(name, key, sort_order)
ON CONFLICT ("teamId", "key") DO NOTHING;
