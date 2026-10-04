import { lockFamily, postLedger } from "../cash/ledger.service";
import { Prisma } from "@prisma/client";
import { wibDay } from "../../utils/calendar";
import { prisma } from "../../config/prisma";
import {
  cancelReminders,
  enqueue,
  installmentLink,
  money,
} from "../notifications/notification.service";

// Sandbox-only settlement. Production must call a verified provider adapter instead.
export async function settleSandboxPayment(
  paymentId: string,
  actorId?: string,
) {
  return prisma.$transaction(async (tx) => {
    const initial = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    await lockFamily(tx, initial.familyId);
    // Serialize all settlements for one loan, including its final two installments.
    await tx.$queryRaw`SELECT id FROM "Loan" WHERE id = ${initial.loanId}::uuid FOR UPDATE`;
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: {
        installment: true,
        loan: { include: { borrower: true, family: true } },
      },
    });
    if (payment.provider !== "SANDBOX")
      throw new Error("INVALID_PAYMENT_PROVIDER");
    if (payment.status === "SUCCESS") return payment;
    if (
      payment.status !== "PENDING" ||
      !payment.expiresAt ||
      payment.expiresAt <= new Date()
    )
      throw new Error("PAYMENT_EXPIRED");
    if (
      payment.loan.status !== "ACTIVE" ||
      payment.installment.status === "PAID" ||
      payment.amount.lte(0) ||
      payment.amount.gt(payment.installment.remainingAmount)
    )
      throw new Error("PAYMENT_CONFLICT");
    const paidAt = new Date();
    const result = await tx.payment.update({
      where: { id: paymentId, status: "PENDING" },
      data: { status: "SUCCESS", paidAt },
    });
    await tx.loanInstallment.update({
      where: { id: payment.installmentId },
      data: {
        status: payment.amount.equals(payment.installment.remainingAmount)
          ? "PAID"
          : "PARTIAL",
        paidAmount: { increment: payment.amount },
        remainingAmount: { decrement: payment.amount },
        paidAt: payment.amount.equals(payment.installment.remainingAmount)
          ? paidAt
          : null,
      },
    });
    const remaining = await tx.loanInstallment.aggregate({
      where: { loanId: payment.loanId },
      _sum: { remainingAmount: true },
    });
    const balance = remaining._sum.remainingAmount ?? new Prisma.Decimal(0);
    const paidOff = balance.isZero();
    if (paidOff)
      await tx.fundRequest.updateMany({
        where: { loanId: payment.loanId },
        data: { status: "PAID_OFF" },
      });
    if (paidOff)
      await tx.loan.update({
        where: { id: payment.loanId },
        data: { status: "PAID_OFF", paidOffAt: paidAt },
      });
    await postLedger(tx, {
      familyId: payment.familyId,
      type: "LOAN_REPAYMENT",
      direction: "IN",
      amount: payment.amount,
      description: `Pembayaran simulasi cicilan ${payment.installment.installmentNumber}`,
      referenceType: "PAYMENT",
      referenceId: payment.id,
      createdById: actorId ?? payment.payerId,
    });
    if (actorId)
      await tx.auditLog.create({
        data: {
          actorId,
          familyId: payment.familyId,
          action: "SANDBOX_PAYMENT_SETTLED",
          entityType: "Payment",
          entityId: payment.id,
          after: { amount: payment.amount.toString(), status: "SUCCESS" },
        },
      });
    const next = paidOff
      ? null
      : await tx.loanInstallment.findFirst({
          where: { loanId: payment.loanId, status: { not: "PAID" } },
          orderBy: { installmentNumber: "asc" },
        });
    const nextText = next
      ? ` Cicilan belum lunas berikutnya: ke-${next.installmentNumber}, ${money(next.remainingAmount)}, jatuh tempo ${wibDay(next.dueDate)}.`
      : "";
    const body = `[${payment.loan.family.name}] Halo ${payment.loan.borrower.name}, pembayaran ${money(payment.amount)} berhasil dicatat. ${paidOff ? "Seluruh pinjaman sudah LUNAS." : `Sisa pinjaman ${money(balance)}.${nextText}`} Lihat riwayat dan jadwal: ${installmentLink(payment.installmentId)}`;
    if (payment.amount.equals(payment.installment.remainingAmount))
      await cancelReminders(tx, payment.installmentId);
    await enqueue(tx, {
      eventKey: `PAYMENT_SUCCESS:${payment.id}`,
      familyId: payment.familyId,
      userId: payment.payerId,
      kind: paidOff ? "LOAN_PAID_OFF" : "PAYMENT_SUCCESS",
      body,
      installmentId: payment.installmentId,
    });
    return result;
  });
}
