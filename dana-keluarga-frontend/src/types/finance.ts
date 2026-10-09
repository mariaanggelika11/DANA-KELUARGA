export type Summary = {
  balance: string;
  loans: string;
  installments: string;
  members: number;
};
export type Installment = {
  id: string;
  installmentNumber: number;
  dueDate: string;
  principalAmount: string | number;
  paidAmount: string | number;
  remainingAmount: string | number;
  status: string;
  paymentStatus?: string;
};
export type Loan = {
  id: string;
  principalAmount: string | number;
  tenorMonths: number;
  purpose: string;
  status: string;
  requestedAt: string;
  rejectionReason?: string | null;
  approvedAt?: string | null;
  approvedBy?: { id: string; name: string } | null;
  rejectedBy?: { id: string; name: string } | null;
  borrower: { id: string; name: string; phone: string };
  installments: Installment[];
  approvalRequest?: { id: string; currentStep: number; status: string } | null;
};
export type LedgerEntry = {
  id: string;
  amount: string | number;
  direction: "IN" | "OUT";
  occurredAt: string;
  description: string;
  type: string;
  referenceId?: string;
  balanceBefore?: string | null;
  balanceAfter?: string | null;
  createdBy?: { name: string };
};
