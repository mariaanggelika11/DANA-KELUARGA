BEGIN;

-- Retired sandbox/provider previews and manual rows without a bank account are
-- historical records, not active reports in the manual bank-transfer workflow.
-- Preserve those records while enforcing one real pending report per installment.
DROP INDEX "Payment_one_pending_installment";
CREATE UNIQUE INDEX "Payment_one_pending_installment"
  ON "Payment"("installmentId")
  WHERE "status" = 'PENDING'
    AND "provider" = 'MANUAL'
    AND "bankAccountId" IS NOT NULL;

COMMIT;
