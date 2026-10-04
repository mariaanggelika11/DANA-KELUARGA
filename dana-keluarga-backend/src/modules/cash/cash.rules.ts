import { MAX_MONEY } from "../../utils/money";
import { WorkflowError } from "../approvals/approval.rules";

export function calculateFundRequest(
  amount: bigint,
  availableContribution: bigint,
) {
  if (amount <= 0n || amount > MAX_MONEY || availableContribution < 0n)
    throw new WorkflowError(
      "INVALID_AMOUNT",
      "Nominal atau saldo kontribusi tidak valid.",
      400,
    );
  const withdrawalAmount =
    amount < availableContribution ? amount : availableContribution;
  const loanAmount = amount - withdrawalAmount;
  return { withdrawalAmount, loanAmount, requiresApproval: loanAmount > 0n };
}

export function validateRequestIntent(
  intent: "MIXED" | "WITHDRAWAL" | "LOAN",
  loanAmount: bigint,
) {
  if (intent === "WITHDRAWAL" && loanAmount > 0n)
    throw new WorkflowError(
      "CONTRIBUTION_INSUFFICIENT",
      "Kontribusi tersedia tidak mencukupi. Gunakan menu Pinjaman untuk mengajukan kebutuhan dana.",
      409,
    );
  if (intent === "LOAN" && loanAmount === 0n)
    throw new WorkflowError(
      "LOAN_NOT_REQUIRED",
      "Kontribusi Anda mencukupi. Gunakan Tarik kontribusi tanpa membuat pinjaman.",
      409,
    );
}
