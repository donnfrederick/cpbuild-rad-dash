-- Add fieldTrackerItemId to tickets
-- Stores the original Field Tracker feedbackItem.id so rad-dash can call back
-- to field-tracker's /api/webhooks/status-change when a ticket status changes.

ALTER TABLE "tickets" ADD COLUMN "fieldTrackerItemId" TEXT;

CREATE INDEX "tickets_fieldTrackerItemId_idx" ON "tickets"("fieldTrackerItemId");
