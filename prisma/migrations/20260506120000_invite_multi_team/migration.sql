-- CreateTable
CREATE TABLE "invite_teams" (
    "id" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamRole" "team_role" NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "invite_teams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invite_teams_inviteId_idx" ON "invite_teams"("inviteId");

-- CreateIndex
CREATE UNIQUE INDEX "invite_teams_inviteId_teamId_key" ON "invite_teams"("inviteId", "teamId");

-- AddForeignKey
ALTER TABLE "invite_teams" ADD CONSTRAINT "invite_teams_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_teams" ADD CONSTRAINT "invite_teams_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
