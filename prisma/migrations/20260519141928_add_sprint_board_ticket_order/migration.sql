-- AlterTable
ALTER TABLE "team_board_statuses" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "team_swimlane_configs" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "team_ticket_types" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tickets" ALTER COLUMN "type" SET DATA TYPE TEXT,
ALTER COLUMN "status" SET DATA TYPE TEXT;

-- CreateTable
CREATE TABLE "sprint_board_ticket_orders" (
    "sprintId" TEXT NOT NULL,
    "statusKey" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "sprint_board_ticket_orders_pkey" PRIMARY KEY ("sprintId","statusKey","ticketId")
);

-- CreateIndex
CREATE INDEX "sprint_board_ticket_orders_sprintId_statusKey_idx" ON "sprint_board_ticket_orders"("sprintId", "statusKey");

-- AddForeignKey
ALTER TABLE "sprint_board_ticket_orders" ADD CONSTRAINT "sprint_board_ticket_orders_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_board_ticket_orders" ADD CONSTRAINT "sprint_board_ticket_orders_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
