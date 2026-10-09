import { prisma } from "../../config/prisma";
import { WorkflowError, type WorkflowActor } from "../approvals/approval.rules";
import { authorizeFamily } from "../cash/family-access.service";
import { postLedger } from "../cash/ledger.service";
import {
  enqueue,
  installmentLink,
  money,
} from "../notifications/notification.service";
import {
  assertTransferReviewer,
  financialInstallmentStatus,
} from "./payment.rules";

export async function reversePayment(
  actor: WorkflowActor,
  paymentId: string,
  reason: string,
) {
  reason = reason.trim();
  if (reason.length < 5 || reason.length > 500)
    throw new WorkflowError(
      "CORRECTION_REASON_REQUIRED",
      "Isi alasan koreksi 5–500 karakter.",
      400,
    );
  return prisma.$transaction(async (tx) => {
    const current = await authorizeFamily(tx, actor, ["TREASURER"]);
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, familyId: current.familyId },
      include: { installment: true, loan: { include: { borrower: true } } },
    });
    if (!payment)
      throw new WorkflowError(
        "PAYMENT_NOT_FOUND",
        "Pembayaran tidak ditemukan.",
        404,
      );
    if (
      payment.payerId !== payment.loan.borrowerId ||
      payment.loan.familyId !== payment.familyId ||
      payment.installment.loanId !== payment.loanId
    )
      throw new WorkflowError(
        "INVALID_MANUAL_PAYMENT",
        "Hubungan keluarga, peminjam, dan cicilan pembayaran tidak sesuai.",
      );
    assertTransferReviewer(current, payment);
    if (payment.reversedAt) {
      if (payment.reversalReason !== reason)
        throw new WorkflowError(
          "PAYMENT_ALREADY_REVERSED",
          "Pembayaran ini sudah dikoreksi. Muat ulang riwayat.",
        );
      return payment;
    }
    if (
      payment.status !== "SUCCESS" ||
      payment.provider !== "MANUAL" ||
      !payment.bankAccountId ||
      !["ACTIVE", "PAID_OFF"].includes(payment.loan.status)
    )
      throw new WorkflowError(
        "PAYMENT_NOT_REVERSIBLE",
        "Hanya pembayaran transfer manual yang sudah dikonfirmasi dapat dikoreksi.",
      );
    const original = await tx.ledgerEntry.findFirst({
      where: {
        familyId: payment.familyId,
        type: "LOAN_REPAYMENT",
        direction: "IN",
        referenceType: "PAYMENT",
        referenceId: payment.id,
      },
    });
    if (
      !original ||
      !original.amount.equals(payment.amount) ||
      payment.installment.paidAmount.lt(payment.amount)
    )
      throw new WorkflowError(
        "PAYMENT_RECONCILIATION_REQUIRED",
        "Catatan pembayaran dan kas tidak cocok. Rekonsiliasi diperlukan sebelum koreksi.",
      );
    const now = new Date();
    const paidAmount = payment.installment.paidAmount.sub(payment.amount);
    const remainingAmount = payment.installment.remainingAmount.add(
      payment.amount,
    );
    if (remainingAmount.gt(payment.installment.principalAmount))
      throw new WorkflowError(
        "PAYMENT_RECONCILIATION_REQUIRED",
        "Sisa cicilan setelah koreksi melebihi tagihan awal.",
      );
    await postLedger(tx, {
      familyId: payment.familyId,
      type: "REVERSAL",
      direction: "OUT",
      amount: payment.amount,
      description: `Koreksi pembayaran cicilan ke-${payment.installment.installmentNumber} oleh ${payment.loan.borrower.name}: ${reason}`,
      referenceType: "PAYMENT_REVERSAL",
      referenceId: payment.id,
      createdById: actor.sub,
    });
    await tx.loanInstallment.update({
      where: { id: payment.installmentId },
      data: {
        paidAmount,
        remainingAmount,
        paidAt: null,
        status: financialInstallmentStatus(
          { paidAmount, remainingAmount, dueDate: payment.installment.dueDate },
          now,
        ),
      },
    });
    await tx.loan.update({
      where: { id: payment.loanId },
      data: { status: "ACTIVE", paidOffAt: null },
    });
    await tx.fundRequest.updateMany({
      where: { loanId: payment.loanId },
      data: { status: "ACTIVE" },
    });
    const result = await tx.payment.update({
      where: { id: payment.id, status: "SUCCESS" },
      data: {
        status: "CANCELLED",
        reversedAt: now,
        reversedById: actor.sub,
        reversalReason: reason,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        familyId: payment.familyId,
        action: "MANUAL_PAYMENT_REVERSED",
        entityType: "Payment",
        entityId: payment.id,
        before: {
          status: payment.status,
          paidAmount: payment.installment.paidAmount.toString(),
          remainingAmount: payment.installment.remainingAmount.toString(),
          loanStatus: payment.loan.status,
        },
        after: {
          status: "CANCELLED",
          paidAmount: paidAmount.toString(),
          remainingAmount: remainingAmount.toString(),
          reason,
        },
      },
    });
    await tx.emailMessage.updateMany({
      where: {
        eventKey: `PAYMENT_SUCCESS:${payment.id}`,
        status: { in: ["QUEUED", "FAILED"] },
      },
      data: {
        status: "CANCELLED",
        completedAt: now,
        lastError: "Pembayaran dikoreksi pengelola dana.",
      },
    });
    await enqueue(tx, {
      eventKey: `PAYMENT_REVERSED:${payment.id}`,
      userId: payment.payerId,
      familyId: payment.familyId,
      installmentId: payment.installmentId,
      kind: "PAYMENT_REVERSED",
      body: `Pencatatan pembayaran ${money(payment.amount)} untuk cicilan ke-${payment.installment.installmentNumber} dikoreksi pengelola dana. Alasan: ${reason}. Sisa cicilan sekarang ${money(remainingAmount)}. Koreksi ini tidak memindahkan uang di bank. Periksa rincian: ${installmentLink(payment.installmentId)}`,
    });
    return result;
  });
}
