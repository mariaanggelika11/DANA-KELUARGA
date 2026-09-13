import { addMonthsWib } from './calendar';
import { splitAmount } from './money';

export function generateInstallments(principal: bigint, tenorMonths: number, firstDueDate: Date, monthOffset = 0) {
  return splitAmount(principal, tenorMonths).map((amount, index) => {
    const dueDate = addMonthsWib(firstDueDate, index + monthOffset);
    return { installmentNumber: index + 1, dueDate, principalAmount: amount, paidAmount: 0n, remainingAmount: amount };
  });
}
