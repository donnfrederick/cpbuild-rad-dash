-- CreateEnum
CREATE TYPE "layout_issue_status" AS ENUM ('OPEN', 'FIXED');

-- CreateTable
CREATE TABLE "layout_issues" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "screenshot" TEXT,
    "status" "layout_issue_status" NOT NULL DEFAULT 'OPEN',
    "fixNote" TEXT,
    "fixedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "layout_issues_pkey" PRIMARY KEY ("id")
);
