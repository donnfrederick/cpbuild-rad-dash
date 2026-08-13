-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "parentId" TEXT;

-- CreateIndex
CREATE INDEX "tickets_parentId_idx" ON "tickets"("parentId");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
