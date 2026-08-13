-- AlterTable: record similarity at link time (nullable for existing rows)
ALTER TABLE "ticket_duplicates" ADD COLUMN "similarity" DOUBLE PRECISION;

-- CreateTable: persist "keep separate" decisions so dismissed pairs never resurface
CREATE TABLE "ticket_duplicate_dismissals" (
    "id" TEXT NOT NULL,
    "ticketAId" TEXT NOT NULL,
    "ticketBId" TEXT NOT NULL,
    "dismissedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_duplicate_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_duplicate_dismissals_ticketBId_idx" ON "ticket_duplicate_dismissals"("ticketBId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_duplicate_dismissals_ticketAId_ticketBId_key" ON "ticket_duplicate_dismissals"("ticketAId", "ticketBId");

-- AddForeignKey
ALTER TABLE "ticket_duplicate_dismissals" ADD CONSTRAINT "ticket_duplicate_dismissals_ticketAId_fkey" FOREIGN KEY ("ticketAId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_duplicate_dismissals" ADD CONSTRAINT "ticket_duplicate_dismissals_ticketBId_fkey" FOREIGN KEY ("ticketBId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_duplicate_dismissals" ADD CONSTRAINT "ticket_duplicate_dismissals_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
