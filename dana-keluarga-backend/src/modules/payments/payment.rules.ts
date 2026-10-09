import { z } from "zod";
import { amountSchema } from "../../utils/money";
import { WorkflowError, type WorkflowActor } from "../approvals/approval.rules";
import { Prisma } from "@prisma/client";
import { wibDay } from "../../utils/calendar";

export const isFundManager = (
  actor: Pick<WorkflowActor, "familyRole" | "systemRole">,
) => actor.systemRole !== "SUPER_ADMIN" && actor.familyRole === "TREASURER";
export const bankAccountSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    bankName: z.string().trim().min(2).max(80),
    accountNumber: z
      .string()
      .trim()
      .regex(/^[0-9]{6,34}$/, "Nomor rekening harus berisi 6–34 digit."),
    accountHolder: z.string().trim().min(2).max(120),
  })
  .strict();
const transferBase = {
  idempotencyKey: z.string().uuid(),
  bankAccountId: z.string().uuid(),
};
const detailedTransferSchema = z
  .object({
    ...transferBase,
    amount: amountSchema,
    transferredAt: z.coerce
      .date()
      .refine(
        (date) => date.getTime() <= Date.now() + 60000,
        "Waktu transfer tidak boleh di masa depan.",
      ),
    transferReference: z
      .string()
      .trim()
      .min(3)
      .max(120)
      .transform((value) => value.toUpperCase()),
    transferNotes: z.string().trim().max(500).default(""),
  })
  .strict();
export const transferSchema = z.union([
  z
    .object({
      ...transferBase,
      expectedRemainingAmount: amountSchema.optional(),
    })
    .strict(),
  detailedTransferSchema,
]);
export const reviewSchema = z
  .object({
    notes: z.string().trim().max(500).default(""),
  })
  .strict();

type InstallmentAmounts = {
  remainingAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  dueDate: Date;
};
export function financialInstallmentStatus(
  installment: InstallmentAmounts,
  now = new Date(),
) {
  if (installment.remainingAmount.lte(0)) return "PAID";
  if (wibDay(installment.dueDate) < wibDay(now)) return "OVERDUE";
  return installment.paidAmount.gt(0) ? "PARTIAL" : "UNPAID";
}
export function installmentPaymentStatus(
  installment: InstallmentAmounts & {
    payments: {
      provider: string;
      status: string;
      bankAccountId?: string | null;
      bankAccount?: unknown;
    }[];
  },
  now = new Date(),
) {
  const financial = financialInstallmentStatus(installment, now);
  if (financial === "PAID") return financial;
  const pending = installment.payments.some(
    (payment) =>
      payment.provider === "MANUAL" &&
      payment.status === "PENDING" &&
      Boolean(payment.bankAccountId || payment.bankAccount),
  );
  return pending ? "PENDING_REVIEW" : financial;
}
export function assertTransferReviewer(
  actor: WorkflowActor,
  payment: { familyId: string; payerId: string; loan: { borrowerId: string } },
) {
  if (!isFundManager(actor) || actor.familyId !== payment.familyId)
    throw new WorkflowError(
      "FORBIDDEN",
      "Hanya pengelola dana keluarga ini dapat memeriksa pembayaran.",
      403,
    );
  if (actor.sub === payment.payerId || actor.sub === payment.loan.borrowerId)
    throw new WorkflowError(
      "SELF_CONFIRMATION_NOT_ALLOWED",
      "Anda tidak boleh memeriksa pembayaran pinjaman sendiri. Minta pengelola dana lain.",
      403,
    );
}
