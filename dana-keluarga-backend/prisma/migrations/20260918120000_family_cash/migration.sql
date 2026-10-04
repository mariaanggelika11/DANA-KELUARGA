-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SENT', 'SIMULATED', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "LedgerType" ADD VALUE 'WITHDRAWAL';

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "balanceAfter" DECIMAL(18,2),
ADD COLUMN     "balanceBefore" DECIMAL(18,2),
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "ownerUserId" UUID;

-- AlterTable
ALTER TABLE "ApprovalAction" ADD COLUMN     "afterStatus" "ApprovalRequestStatus",
ADD COLUMN     "beforeStatus" "ApprovalRequestStatus";

-- CreateTable
CREATE TABLE "FundRequest" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "withdrawalAmount" DECIMAL(18,2) NOT NULL,
    "loanAmount" DECIMAL(18,2) NOT NULL,
    "purpose" TEXT NOT NULL,
    "tenorMonths" INTEGER NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'PENDING',
    "loanId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" UUID NOT NULL,
    "eventKey" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FundRequest_loanId_key" ON "FundRequest"("loanId");

-- CreateIndex
CREATE INDEX "FundRequest_familyId_status_idx" ON "FundRequest"("familyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FundRequest_familyId_userId_idempotencyKey_key" ON "FundRequest"("familyId", "userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_eventKey_key" ON "EmailMessage"("eventKey");

-- CreateIndex
CREATE INDEX "EmailMessage_status_nextAttemptAt_idx" ON "EmailMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_familyId_ownerUserId_type_idx" ON "LedgerEntry"("familyId", "ownerUserId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_familyId_createdById_idempotencyKey_key" ON "LedgerEntry"("familyId", "createdById", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundRequest" ADD CONSTRAINT "FundRequest_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundRequest" ADD CONSTRAINT "FundRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundRequest" ADD CONSTRAINT "FundRequest_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Additive checks: legacy ledger snapshots stay NULL until separately reconciled.
ALTER TABLE "FundRequest" ADD CONSTRAINT "FundRequest_amounts_check" CHECK (
  "amount" > 0 AND "amount" = trunc("amount") AND "withdrawalAmount" >= 0 AND "loanAmount" >= 0
  AND "withdrawalAmount" = trunc("withdrawalAmount") AND "loanAmount" = trunc("loanAmount")
  AND "amount" = "withdrawalAmount" + "loanAmount" AND "tenorMonths" BETWEEN 1 AND 60
);
ALTER TABLE "FundRequest" ADD CONSTRAINT "FundRequest_membership_fkey" FOREIGN KEY ("familyId", "userId") REFERENCES "FamilyMember"("familyId", "userId") ON DELETE RESTRICT;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_owner_membership_fkey" FOREIGN KEY ("familyId", "ownerUserId") REFERENCES "FamilyMember"("familyId", "userId") ON DELETE RESTRICT;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_snapshot_check" CHECK (
  ("balanceBefore" IS NULL AND "balanceAfter" IS NULL) OR
  ("balanceBefore" IS NOT NULL AND "balanceAfter" IS NOT NULL AND "balanceBefore" >= 0 AND "balanceAfter" >= 0 AND "amount" > 0 AND "amount" = trunc("amount") AND
   "balanceAfter" = "balanceBefore" + CASE WHEN "direction" = 'IN' THEN "amount" ELSE -"amount" END)
);
CREATE FUNCTION protect_financial_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Financial ledger is append-only; post a reversal instead'; END;
$$;
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION protect_financial_ledger();
