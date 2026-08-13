-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TicketType" ADD VALUE 'MINOR_ENHANCEMENT';
ALTER TYPE "TicketType" ADD VALUE 'REGRESSION';
ALTER TYPE "TicketType" ADD VALUE 'SECURITY_IMPROVEMENT';

-- DropIndex
DROP INDEX "tickets_embedding_cosine_idx";

-- CreateTable
CREATE TABLE "releases" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prNumber" INTEGER,
    "branch" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'all',
    "mergedAt" TIMESTAMP(3) NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '[]',
    "verificationSteps" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_verifications" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "release_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "environment_visits" (
    "userId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "lastVisitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "environment_visits_pkey" PRIMARY KEY ("userId","environment")
);

-- CreateIndex
CREATE INDEX "releases_mergedAt_idx" ON "releases"("mergedAt");

-- CreateIndex
CREATE INDEX "releases_environment_idx" ON "releases"("environment");

-- CreateIndex
CREATE INDEX "release_verifications_userId_environment_idx" ON "release_verifications"("userId", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "release_verifications_releaseId_userId_environment_key" ON "release_verifications"("releaseId", "userId", "environment");

-- AddForeignKey
ALTER TABLE "release_verifications" ADD CONSTRAINT "release_verifications_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_verifications" ADD CONSTRAINT "release_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environment_visits" ADD CONSTRAINT "environment_visits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
