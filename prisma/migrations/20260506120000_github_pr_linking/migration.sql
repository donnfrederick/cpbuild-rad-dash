-- CreateEnum
CREATE TYPE "LinkedPRStatus" AS ENUM ('OPEN', 'MERGED', 'CLOSED');

-- CreateTable
CREATE TABLE "project_github_configs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "repoOwner" TEXT NOT NULL,
    "repoName" TEXT NOT NULL,
    "webhookSecretEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_github_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_linked_prs" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "repoOwner" TEXT NOT NULL,
    "repoName" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "prUrl" TEXT NOT NULL,
    "prTitle" TEXT,
    "status" "LinkedPRStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_linked_prs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_github_configs_projectId_key" ON "project_github_configs"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_github_configs_repoOwner_repoName_key" ON "project_github_configs"("repoOwner", "repoName");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_linked_prs_ticketId_repoOwner_repoName_prNumber_key" ON "ticket_linked_prs"("ticketId", "repoOwner", "repoName", "prNumber");

-- CreateIndex
CREATE INDEX "ticket_linked_prs_repoOwner_repoName_prNumber_idx" ON "ticket_linked_prs"("repoOwner", "repoName", "prNumber");

-- AddForeignKey
ALTER TABLE "project_github_configs" ADD CONSTRAINT "project_github_configs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ticket_linked_prs" ADD CONSTRAINT "ticket_linked_prs_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
