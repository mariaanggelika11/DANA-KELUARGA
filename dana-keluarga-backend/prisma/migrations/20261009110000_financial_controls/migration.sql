-- CreateEnum
CREATE TYPE "ContributionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedById" UUID;

-- CreateTable
CREATE TABLE "ContributionReport" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "purpose" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "ContributionStatus" NOT NULL DEFAULT 'PENDING',
    "bankAccountId" UUID NOT NULL,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributionReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContributionReport_familyId_status_createdAt_idx" ON "ContributionReport"("familyId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContributionReport_familyId_userId_idempotencyKey_key" ON "ContributionReport"("familyId", "userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionReport" ADD CONSTRAINT "ContributionReport_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionReport" ADD CONSTRAINT "ContributionReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionReport" ADD CONSTRAINT "ContributionReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionReport" ADD CONSTRAINT "ContributionReport_bankAccountId_familyId_fkey" FOREIGN KEY ("bankAccountId", "familyId") REFERENCES "FamilyBankAccount"("id", "familyId") ON DELETE RESTRICT ON UPDATE CASCADE;
