BEGIN;

-- CreateEnum
CREATE TYPE "WorkflowPermission" AS ENUM ('MAKER', 'APPROVER', 'RELEASER');

-- CreateEnum
CREATE TYPE "ApprovalTransactionType" AS ENUM ('LOAN', 'SAVINGS_WITHDRAWAL', 'DEPOSIT_VERIFICATION');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING_APPROVAL', 'PENDING_RELEASE', 'RELEASED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalStepStatus" AS ENUM ('WAITING', 'APPROVED', 'REJECTED', 'RETURNED', 'RELEASED');

-- CreateEnum
CREATE TYPE "ApprovalActionType" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT', 'RETURN', 'RELEASE', 'CANCEL');

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "approvalRequestId" UUID;

-- CreateTable
CREATE TABLE "ApprovalPolicy" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "transactionType" "ApprovalTransactionType" NOT NULL DEFAULT 'LOAN',
    "version" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "distinctActorsRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalAssignment" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "permission" "WorkflowPermission" NOT NULL,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "ApprovalAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "transactionType" "ApprovalTransactionType" NOT NULL DEFAULT 'LOAN',
    "referenceId" UUID NOT NULL,
    "makerId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "permission" "WorkflowPermission" NOT NULL,
    "assignedUserId" UUID NOT NULL,
    "status" "ApprovalStepStatus" NOT NULL DEFAULT 'WAITING',
    "actedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalAction" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "step" INTEGER NOT NULL,
    "actorId" UUID NOT NULL,
    "action" "ApprovalActionType" NOT NULL,
    "notes" TEXT,
    "actedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalPolicy_familyId_transactionType_active_idx" ON "ApprovalPolicy"("familyId", "transactionType", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalPolicy_familyId_transactionType_version_key" ON "ApprovalPolicy"("familyId", "transactionType", "version");

-- CreateIndex
CREATE INDEX "ApprovalAssignment_userId_permission_idx" ON "ApprovalAssignment"("userId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalAssignment_policyId_permission_sequence_key" ON "ApprovalAssignment"("policyId", "permission", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalAssignment_policyId_permission_userId_key" ON "ApprovalAssignment"("policyId", "permission", "userId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_familyId_status_submittedAt_idx" ON "ApprovalRequest"("familyId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_makerId_status_idx" ON "ApprovalRequest"("makerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_transactionType_referenceId_key" ON "ApprovalRequest"("transactionType", "referenceId");

-- CreateIndex
CREATE INDEX "ApprovalStep_assignedUserId_status_idx" ON "ApprovalStep"("assignedUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalStep_requestId_sequence_key" ON "ApprovalStep"("requestId", "sequence");

-- CreateIndex
CREATE INDEX "ApprovalAction_actorId_actedAt_idx" ON "ApprovalAction"("actorId", "actedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalAction_requestId_step_action_key" ON "ApprovalAction"("requestId", "step", "action");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_approvalRequestId_key" ON "Loan"("approvalRequestId");

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalAssignment" ADD CONSTRAINT "ApprovalAssignment_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ApprovalPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalAssignment" ADD CONSTRAINT "ApprovalAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ApprovalPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalAction" ADD CONSTRAINT "ApprovalAction_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalAction" ADD CONSTRAINT "ApprovalAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Custom protections: Prisma does not represent partial indexes and triggers.
CREATE UNIQUE INDEX "ApprovalPolicy_one_active_per_family_type"
  ON "ApprovalPolicy" ("familyId", "transactionType") WHERE "active";
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_positive_version" CHECK ("version" > 0);
ALTER TABLE "ApprovalAssignment" ADD CONSTRAINT "ApprovalAssignment_positive_sequence" CHECK ("sequence" > 0);
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_positive_sequence" CHECK ("sequence" > 0);
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_decision_actor" CHECK ("permission" IN ('APPROVER', 'RELEASER'));
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_valid_amount_step" CHECK ("amount" > 0 AND "currentStep" > 0);
ALTER TABLE "ApprovalAction" ADD CONSTRAINT "ApprovalAction_nonnegative_step" CHECK ("step" >= 0);

CREATE FUNCTION prevent_approval_action_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ApprovalAction history is append-only';
END;
$$;
CREATE TRIGGER approval_action_immutable BEFORE UPDATE OR DELETE ON "ApprovalAction"
  FOR EACH ROW EXECUTE FUNCTION prevent_approval_action_mutation();

COMMIT;
