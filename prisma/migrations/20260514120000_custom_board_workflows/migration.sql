-- Step 1: Drop the DEFAULT on tickets.status (it references the TicketStatus enum type)
ALTER TABLE "tickets" ALTER COLUMN "status" DROP DEFAULT;

-- Step 2: Convert tickets.status from TicketStatus enum to plain VARCHAR
ALTER TABLE "tickets" ALTER COLUMN "status" TYPE VARCHAR(100) USING "status"::TEXT;

-- Step 3: Restore a plain-string default
ALTER TABLE "tickets" ALTER COLUMN "status" SET DEFAULT 'BACKLOG';

-- Step 4: Drop the old TicketStatus enum (no longer needed)
DROP TYPE IF EXISTS "TicketStatus";

-- Step 5: Create the SwimlaneBy enum
CREATE TYPE "swimlane_by" AS ENUM ('NONE', 'ASSIGNEE', 'TYPE', 'PRIORITY', 'PROJECT');

-- Step 6: Create the team_board_statuses table
CREATE TABLE "team_board_statuses" (
    "id"        TEXT NOT NULL,
    "teamId"    TEXT NOT NULL,
    "key"       TEXT NOT NULL,
    "label"     TEXT NOT NULL,
    "color"     TEXT,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_board_statuses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_board_statuses_teamId_key_key" ON "team_board_statuses"("teamId", "key");
CREATE INDEX "team_board_statuses_teamId_idx" ON "team_board_statuses"("teamId");

ALTER TABLE "team_board_statuses" ADD CONSTRAINT "team_board_statuses_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 7: Create the team_swimlane_configs table
CREATE TABLE "team_swimlane_configs" (
    "id"         TEXT NOT NULL,
    "teamId"     TEXT NOT NULL,
    "swimlaneBy" "swimlane_by" NOT NULL DEFAULT 'NONE',
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_swimlane_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_swimlane_configs_teamId_key" ON "team_swimlane_configs"("teamId");

ALTER TABLE "team_swimlane_configs" ADD CONSTRAINT "team_swimlane_configs_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 8: Seed the 8 built-in board statuses for every existing team
-- ARCHIVED is seeded with isEnabled=false to preserve the opt-in toggle behaviour
INSERT INTO "team_board_statuses" ("id", "teamId", "key", "label", "isBuiltIn", "isEnabled", "sortOrder", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    t.id,
    bs.key,
    bs.label,
    true,
    bs.enabled,
    bs.sort_order,
    NOW(),
    NOW()
FROM "teams" t
CROSS JOIN (
    VALUES
        ('BACKLOG',        'Backlog',          true,  0),
        ('READY',          'Ready',            true,  1),
        ('IN_PROGRESS',    'In Progress',      true,  2),
        ('FOR_REVIEW',     'For Review',       true,  3),
        ('RESOLVED',       'Resolved',         true,  4),
        ('TO_BE_DEPLOYED', 'To Be Deployed',   true,  5),
        ('DONE',           'Done',             true,  6),
        ('ARCHIVED',       'Archived',         false, 7)
) AS bs(key, label, enabled, sort_order)
ON CONFLICT ("teamId", "key") DO NOTHING;
