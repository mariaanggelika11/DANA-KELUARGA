BEGIN;

ALTER TABLE "User" ADD COLUMN "whatsappOptInAt" TIMESTAMP(3);
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SIMULATED', 'FAILED', 'CANCELLED');
CREATE TABLE "WhatsAppMessage" (
  "id" UUID NOT NULL, "eventKey" TEXT NOT NULL, "userId" UUID NOT NULL,
  "familyId" UUID NOT NULL, "kind" TEXT NOT NULL, "body" TEXT NOT NULL,
  "installmentId" UUID, "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WhatsAppMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WhatsAppMessage_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WhatsAppMessage_eventKey_key" ON "WhatsAppMessage"("eventKey");
CREATE INDEX "WhatsAppMessage_status_nextAttemptAt_idx" ON "WhatsAppMessage"("status", "nextAttemptAt");
CREATE INDEX "WhatsAppMessage_familyId_createdAt_idx" ON "WhatsAppMessage"("familyId", "createdAt");
CREATE INDEX "WhatsAppMessage_installmentId_kind_status_idx" ON "WhatsAppMessage"("installmentId", "kind", "status");
-- Only one pending payment per installment, including concurrent requests.
-- Existing duplicates must be reviewed before migration; never cancel payments silently.
CREATE UNIQUE INDEX "Payment_one_pending_installment" ON "Payment"("installmentId") WHERE "status" = 'PENDING';

COMMIT;
