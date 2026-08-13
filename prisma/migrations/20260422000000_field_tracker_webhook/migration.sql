-- AlterEnum
ALTER TYPE "TicketSource" ADD VALUE 'FIELD_TRACKER';

-- AlterTable: add optional environment column to tickets
ALTER TABLE "tickets" ADD COLUMN "environment" TEXT;
