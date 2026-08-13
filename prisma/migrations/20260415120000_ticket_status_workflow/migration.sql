-- Replace TicketStatus enum with dev workflow: Backlog → … → Done, Archived.

CREATE TYPE "TicketStatus_new" AS ENUM (
  'BACKLOG',
  'READY',
  'IN_PROGRESS',
  'FOR_REVIEW',
  'RESOLVED',
  'TO_BE_DEPLOYED',
  'DONE',
  'ARCHIVED'
);

ALTER TABLE "tickets" ADD COLUMN "status_new" "TicketStatus_new";

UPDATE "tickets" SET "status_new" = (
  CASE "status"::text
    WHEN 'OPEN' THEN 'READY'::"TicketStatus_new"
    WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'::"TicketStatus_new"
    WHEN 'FOR_REVIEW' THEN 'FOR_REVIEW'::"TicketStatus_new"
    WHEN 'WAITING_FOR_RESPONSE' THEN 'FOR_REVIEW'::"TicketStatus_new"
    WHEN 'NEEDS_INVESTIGATION' THEN 'IN_PROGRESS'::"TicketStatus_new"
    WHEN 'WONT_FIX' THEN 'DONE'::"TicketStatus_new"
    WHEN 'RESOLVED' THEN 'RESOLVED'::"TicketStatus_new"
    WHEN 'DELETED' THEN 'ARCHIVED'::"TicketStatus_new"
    ELSE 'BACKLOG'::"TicketStatus_new"
  END
);

ALTER TABLE "tickets" DROP COLUMN "status";
ALTER TABLE "tickets" RENAME COLUMN "status_new" TO "status";
ALTER TABLE "tickets" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "tickets" ALTER COLUMN "status" SET DEFAULT 'BACKLOG'::"TicketStatus_new";

DROP TYPE "TicketStatus";
ALTER TYPE "TicketStatus_new" RENAME TO "TicketStatus";
