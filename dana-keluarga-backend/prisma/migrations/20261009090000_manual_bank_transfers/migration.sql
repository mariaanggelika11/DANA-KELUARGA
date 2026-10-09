-- Additive only: legacy provider rows and financial history are preserved.
CREATE TABLE "FamilyBankAccount" (
  "id" UUID NOT NULL,
  "familyId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "bankName" TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "accountHolder" TEXT NOT NULL,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FamilyBankAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FamilyBankAccount_version_check" CHECK ("version" > 0),
  CONSTRAINT "FamilyBankAccount_number_check" CHECK ("accountNumber" ~ '^[0-9]{6,34}$'),
  CONSTRAINT "FamilyBankAccount_family_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT,
  CONSTRAINT "FamilyBankAccount_creator_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "FamilyBankAccount_familyId_version_key" ON "FamilyBankAccount"("familyId", "version");
CREATE UNIQUE INDEX "FamilyBankAccount_id_familyId_key" ON "FamilyBankAccount"("id", "familyId");
ALTER TABLE "Payment"
  ADD COLUMN "bankAccountId" UUID,
  ADD COLUMN "transferReference" TEXT,
  ADD COLUMN "transferredAt" TIMESTAMP(3),
  ADD COLUMN "transferNotes" TEXT,
  ADD COLUMN "reviewedById" UUID,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewNotes" TEXT;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bankAccount_family_fkey" FOREIGN KEY ("bankAccountId", "familyId") REFERENCES "FamilyBankAccount"("id", "familyId") ON DELETE RESTRICT;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "Payment_manual_transfer_reference_unique" ON "Payment"("familyId", "transferReference")
  WHERE "provider" = 'MANUAL' AND "status" IN ('PENDING', 'SUCCESS') AND "transferReference" IS NOT NULL;
CREATE FUNCTION protect_bank_account_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Bank account versions are append-only'; END;
$$;
CREATE TRIGGER bank_account_version_immutable BEFORE UPDATE OR DELETE ON "FamilyBankAccount"
  FOR EACH ROW EXECUTE FUNCTION protect_bank_account_version();
