-- CreateEnum
CREATE TYPE "team_role" AS ENUM ('ADMIN', 'MEMBER');

-- CreateTable: teams
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");
CREATE UNIQUE INDEX "teams_slug_key" ON "teams"("slug");

-- CreateTable: team_memberships
CREATE TABLE "team_memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamRole" "team_role" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_memberships_userId_teamId_key" ON "team_memberships"("userId", "teamId");
CREATE INDEX "team_memberships_userId_idx" ON "team_memberships"("userId");
CREATE INDEX "team_memberships_teamId_idx" ON "team_memberships"("teamId");

-- AlterTable: add nullable teamId to projects and sprints (back-filled below)
ALTER TABLE "projects" ADD COLUMN "teamId" TEXT;
ALTER TABLE "sprints" ADD COLUMN "teamId" TEXT;

-- AlterTable: add team invite fields
ALTER TABLE "invites" ADD COLUMN "teamId" TEXT;
ALTER TABLE "invites" ADD COLUMN "teamRole" "team_role";

-- Seed Team RAD (stable cuid-style id so back-fill is deterministic)
INSERT INTO "teams" ("id", "name", "slug", "updatedAt")
VALUES ('cm000000000000teamrad0000', 'Team RAD', 'team-rad', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Back-fill all existing projects → Team RAD
UPDATE "projects" SET "teamId" = 'cm000000000000teamrad0000';

-- Back-fill all existing sprints → Team RAD
UPDATE "sprints" SET "teamId" = 'cm000000000000teamrad0000';

-- Make teamId non-nullable on projects and sprints
ALTER TABLE "projects" ALTER COLUMN "teamId" SET NOT NULL;
ALTER TABLE "sprints" ALTER COLUMN "teamId" SET NOT NULL;

-- AddForeignKey: projects.teamId → teams.id
ALTER TABLE "projects" ADD CONSTRAINT "projects_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddIndex for projects.teamId
CREATE INDEX "projects_teamId_idx" ON "projects"("teamId");

-- AddForeignKey: sprints.teamId → teams.id
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddIndex for sprints.teamId
CREATE INDEX "sprints_teamId_idx" ON "sprints"("teamId");

-- AddForeignKey: invites.teamId → teams.id
ALTER TABLE "invites" ADD CONSTRAINT "invites_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: team_memberships.userId → "User".id
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: team_memberships.teamId → teams.id
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed TeamMembership: enrol every existing user in Team RAD with role matching their app role
INSERT INTO "team_memberships" ("id", "userId", "teamId", "teamRole", "createdAt")
SELECT
    'tm' || substr(md5(random()::text), 1, 22),
    u."id",
    'cm000000000000teamrad0000',
    CASE
        WHEN r."code" = 'ADMIN' THEN 'ADMIN'::"team_role"
        ELSE 'MEMBER'::"team_role"
    END,
    CURRENT_TIMESTAMP
FROM "User" u
JOIN "roles" r ON r."id" = u."roleId"
ON CONFLICT ("userId", "teamId") DO NOTHING;
