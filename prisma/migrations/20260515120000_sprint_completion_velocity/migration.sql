-- AlterTable
ALTER TABLE "sprints" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "velocity" INTEGER;

-- CreateIndex
CREATE INDEX "sprints_teamId_completedAt_idx" ON "sprints"("teamId", "completedAt");

-- AlterTable
ALTER TABLE "sprint_tickets" ADD COLUMN     "isCarriedOver" BOOLEAN NOT NULL DEFAULT false;
