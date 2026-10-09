CREATE TABLE "AuthSession" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AuthSession_userId_revokedAt_idx" ON "AuthSession"("userId", "revokedAt");
-- Preserve existing refresh tokens. They upgrade old access tokens at the next refresh.
INSERT INTO "AuthSession" ("id", "userId", "expiresAt", "revokedAt", "createdAt")
SELECT "id", "userId", "expiresAt", "revokedAt", "createdAt" FROM "RefreshToken";
ALTER TABLE "RefreshToken" ADD COLUMN "sessionId" UUID;
UPDATE "RefreshToken" SET "sessionId" = "id";
ALTER TABLE "RefreshToken" ALTER COLUMN "sessionId" SET NOT NULL;
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AuthSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");
CREATE TABLE "PasswordResetToken" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "authVersion" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_createdAt_idx" ON "PasswordResetToken"("userId", "createdAt");
ALTER TYPE "LedgerType" ADD VALUE 'CONTRIBUTION_REVERSAL';
ALTER TYPE "ContributionStatus" ADD VALUE 'REVERSED';
ALTER TABLE "ContributionReport" ADD COLUMN "reversedById" UUID, ADD COLUMN "reversedAt" TIMESTAMP(3), ADD COLUMN "reversalReason" TEXT;
ALTER TABLE "ContributionReport" ADD CONSTRAINT "ContributionReport_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
