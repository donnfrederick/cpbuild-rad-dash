-- Add grantAllTeams flag to invites table
-- When true, the accepted user is automatically granted the access:all_teams special permission.

ALTER TABLE "invites" ADD COLUMN "grantAllTeams" BOOLEAN NOT NULL DEFAULT false;
