import type { Loan, Installment } from "../../types/finance";
export type InstallmentGroup = {
  borrowerId: string;
  borrowerName: string;
  loans: Loan[];
  installments: Array<{ loan: Loan; installment: Installment }>;
};
export function groupInstallments(loans: Loan[]): InstallmentGroup[] {
  const groups = new Map<string, InstallmentGroup>();
  for (const loan of loans) {
    let group = groups.get(loan.borrower.id);
    if (!group) {
      group = {
        borrowerId: loan.borrower.id,
        borrowerName: loan.borrower.name,
        loans: [],
        installments: [],
      };
      groups.set(loan.borrower.id, group);
    }
    group.loans.push(loan);
    for (const installment of loan.installments)
      group.installments.push({ loan, installment });
  }
  return [...groups.values()];
}
