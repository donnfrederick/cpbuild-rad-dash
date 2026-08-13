-- CreateTable
CREATE TABLE "sprint_tickets" (
    "sprintId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,

    CONSTRAINT "sprint_tickets_pkey" PRIMARY KEY ("sprintId","ticketId")
);

-- CreateIndex
CREATE INDEX "sprint_tickets_ticketId_idx" ON "sprint_tickets"("ticketId");

-- AddForeignKey
ALTER TABLE "sprint_tickets" ADD CONSTRAINT "sprint_tickets_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_tickets" ADD CONSTRAINT "sprint_tickets_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
