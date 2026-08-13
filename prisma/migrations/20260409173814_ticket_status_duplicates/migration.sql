-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TicketStatus" ADD VALUE 'WAITING_FOR_RESPONSE';
ALTER TYPE "TicketStatus" ADD VALUE 'NEEDS_INVESTIGATION';
ALTER TYPE "TicketStatus" ADD VALUE 'WONT_FIX';
ALTER TYPE "TicketStatus" ADD VALUE 'DELETED';

-- CreateTable
CREATE TABLE "ticket_duplicates" (
    "id" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "duplicateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_duplicates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_duplicates_duplicateId_key" ON "ticket_duplicates"("duplicateId");

-- CreateIndex
CREATE INDEX "ticket_duplicates_canonicalId_idx" ON "ticket_duplicates"("canonicalId");

-- AddForeignKey
ALTER TABLE "ticket_duplicates" ADD CONSTRAINT "ticket_duplicates_canonicalId_fkey" FOREIGN KEY ("canonicalId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_duplicates" ADD CONSTRAINT "ticket_duplicates_duplicateId_fkey" FOREIGN KEY ("duplicateId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
