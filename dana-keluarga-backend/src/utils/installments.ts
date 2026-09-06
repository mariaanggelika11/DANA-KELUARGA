import { splitAmount } from './money';

export function generateInstallments(principal: bigint, tenorMonths: number, firstDueDate: Date) {
  return splitAmount(principal, tenorMonths).map((amount, index) => {
    const dueDate = new Date(firstDueDate);
    dueDate.setMonth(dueDate.getMonth() + index);
    return { installmentNumber: index + 1, dueDate, principalAmount: amount, paidAmount: 0n, remainingAmount: amount };
  });
}
