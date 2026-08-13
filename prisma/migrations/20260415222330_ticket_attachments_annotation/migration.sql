-- AlterTable
ALTER TABLE "media_attachments" ADD COLUMN     "imageAnnotation" JSONB,
ADD COLUMN     "lastMarkedAt" TIMESTAMP(3),
ADD COLUMN     "lastMarkedById" TEXT,
ADD COLUMN     "ticketId" TEXT;

-- CreateIndex
CREATE INDEX "media_attachments_ticketId_idx" ON "media_attachments"("ticketId");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "tickets"("status");

-- AddForeignKey
ALTER TABLE "media_attachments" ADD CONSTRAINT "media_attachments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_attachments" ADD CONSTRAINT "media_attachments_lastMarkedById_fkey" FOREIGN KEY ("lastMarkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
