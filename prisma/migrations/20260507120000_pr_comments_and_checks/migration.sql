-- CreateEnum
CREATE TYPE "ChecksStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "PRCommentType" AS ENUM ('ISSUE_COMMENT', 'REVIEW');

-- AlterTable
ALTER TABLE "ticket_linked_prs"
  ADD COLUMN "checksStatus" "ChecksStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "ticket_linked_pr_comments" (
    "id" TEXT NOT NULL,
    "linkedPRId" TEXT NOT NULL,
    "githubCommentId" BIGINT NOT NULL,
    "commentType" "PRCommentType" NOT NULL,
    "authorLogin" TEXT NOT NULL,
    "authorAvatarUrl" TEXT,
    "body" TEXT NOT NULL,
    "htmlUrl" TEXT NOT NULL,
    "reviewState" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_linked_pr_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_linked_pr_comments_linkedPRId_githubCommentId_commen_key" ON "ticket_linked_pr_comments"("linkedPRId", "githubCommentId", "commentType");

-- CreateIndex
CREATE INDEX "ticket_linked_pr_comments_linkedPRId_postedAt_idx" ON "ticket_linked_pr_comments"("linkedPRId", "postedAt");

-- AddForeignKey
ALTER TABLE "ticket_linked_pr_comments" ADD CONSTRAINT "ticket_linked_pr_comments_linkedPRId_fkey" FOREIGN KEY ("linkedPRId") REFERENCES "ticket_linked_prs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
