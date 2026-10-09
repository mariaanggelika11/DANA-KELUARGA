import type { LedgerEntry } from "../../types/finance";

const legacyDisbursement =
  /^Pencairan pinjaman [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ledgerDescription(
  entry: LedgerEntry,
  borrowersByLoan: ReadonlyMap<string, string>,
) {
  if (
    entry.type !== "LOAN_DISBURSEMENT" ||
    !legacyDisbursement.test(entry.description)
  )
    return entry.description;
  const borrower = entry.referenceId
    ? borrowersByLoan.get(entry.referenceId)
    : undefined;
  return borrower
    ? `Pencairan pinjaman untuk ${borrower}`
    : "Pencairan pinjaman";
}
