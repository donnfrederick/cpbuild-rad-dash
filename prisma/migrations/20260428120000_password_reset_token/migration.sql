-- Add password reset token fields to users table
ALTER TABLE "User" ADD COLUMN "passwordResetToken" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_passwordResetToken_key" ON "User"("passwordResetToken");
