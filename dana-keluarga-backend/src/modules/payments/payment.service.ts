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

import {
  WorkflowError,
  requireOperationalActor,
  type WorkflowActor,
} from "../approvals/approval.rules";
import {
  assertTransferReviewer,
  isFundManager,
  financialInstallmentStatus,
  type transferSchema,
  type bankAccountSchema,
} from "./payment.rules";
import type { z } from "zod";

export const bankAccountSelect = {
  id: true,
  version: true,
  bankName: true,
  accountNumber: true,
  accountHolder: true,
} as const;
async function authorize(
  tx: Prisma.TransactionClient,
  actor: WorkflowActor,
  manage = false,
) {
  requireOperationalActor(actor, actor.familyId ?? "");
  await lockFamily(tx, actor.familyId!);
  const member = await tx.familyMember.findUnique({
    where: {
      familyId_userId: { familyId: actor.familyId!, userId: actor.sub },
    },
    include: { user: { select: { isActive: true, systemRole: true } } },
  });
  if (
    member?.status !== "ACTIVE" ||
    !member.user.isActive ||
    member.user.systemRole === "SUPER_ADMIN"
  )
    throw new WorkflowError(
      "FORBIDDEN",
      "Keanggotaan keluarga tidak aktif.",
      403,
    );
  const current = {
    ...actor,
    familyRole: member.role,
    systemRole: member.user.systemRole,
  };
  if (manage && !isFundManager(current))
    throw new WorkflowError(
      "FORBIDDEN",
      "Hanya pengelola dana keluarga ini dapat memproses pembayaran.",
      403,
    );
  return current;
}
export async function saveBankAccount(
  actor: WorkflowActor,
  input: z.infer<typeof bankAccountSchema>,
) {
  return prisma.$transaction(async (tx) => {
    await authorize(tx, actor, true);
    const previous = await tx.familyBankAccount.findFirst({
      where: { familyId: actor.familyId! },
      orderBy: { version: "desc" },
      select: bankAccountSelect,
    });
    if ((previous?.version ?? 0) !== input.expectedVersion)
      throw new WorkflowError(
        "ACCOUNT_CHANGED",
        "Rekening sudah berubah. Muat ulang sebelum menyimpan.",
      );
    const account = await tx.familyBankAccount.create({
      data: {
        familyId: actor.familyId!,
        createdById: actor.sub,
        version: input.expectedVersion + 1,
        bankName: input.bankName,
        accountNumber: input.accountNumber,
        accountHolder: input.accountHolder,
      },
      select: bankAccountSelect,
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        familyId: actor.familyId!,
        action: "FAMILY_BANK_ACCOUNT_CHANGED",
        entityType: "FamilyBankAccount",
        entityId: account.id,
        before: previous ?? Prisma.JsonNull,
        after: account,
      },
    });
    return account;
  });
}
export async function reportTransfer(
  actor: WorkflowActor,
  loanId: string,
  installmentId: string,
  input: z.infer<typeof transferSchema>,
) {
  return prisma.$transaction(async (tx) => {
    await authorize(tx, actor);
    await tx.$queryRaw`SELECT id FROM "Loan" WHERE id = ${loanId}::uuid AND "familyId" = ${actor.familyId}::uuid FOR UPDATE`;
    const installment = await tx.loanInstallment.findFirst({
      where: {
        id: installmentId,
        loanId,
        loan: { familyId: actor.familyId, borrowerId: actor.sub },
      },
      include: { loan: { include: { borrower: { select: { name: true } } } } },
    });
    if (!installment)
      throw new WorkflowError(
        "OWN_PAYMENT_REQUIRED",
        "Anda hanya dapat melaporkan pembayaran pinjaman sendiri.",
        403,
      );
    const externalId = `manual-${input.idempotencyKey}`;
    const detailed = "amount" in input;
    const amount = detailed
      ? input.amount
      : installment.remainingAmount.toString();
    const transferredAt = detailed ? input.transferredAt : null;
    const transferReference = detailed ? input.transferReference : null;
    const transferNotes = detailed ? input.transferNotes : "";
    const previous = await tx.payment.findUnique({ where: { externalId } });
    if (previous) {
      if (
        previous.provider !== "MANUAL" ||
        previous.familyId !== actor.familyId ||
        previous.payerId !== actor.sub ||
        previous.installmentId !== installmentId ||
        (detailed && !previous.amount.equals(input.amount)) ||
        (!detailed &&
          input.expectedRemainingAmount !== undefined &&
          !previous.amount.equals(input.expectedRemainingAmount)) ||
        previous.bankAccountId !== input.bankAccountId ||
        previous.transferReference !== transferReference ||
        (previous.transferredAt?.getTime() ?? null) !==
          (transferredAt?.getTime() ?? null) ||
        (previous.transferNotes ?? "") !== transferNotes
      )
        throw new WorkflowError(
          "IDEMPOTENCY_CONFLICT",
          "Kode laporan sudah dipakai untuk data berbeda.",
        );
      return previous;
    }
    if (
      !detailed &&
      input.expectedRemainingAmount !== undefined &&
      !installment.remainingAmount.equals(input.expectedRemainingAmount)
    )
      throw new WorkflowError(
        "PAYMENT_CONFLICT",
        "Sisa cicilan telah berubah. Muat ulang sebelum melaporkan transfer.",
      );
    if (
      installment.loan.status !== "ACTIVE" ||
      installment.remainingAmount.lte(0) ||
      new Prisma.Decimal(amount).gt(installment.remainingAmount)
    )
      throw new WorkflowError(
        "PAYMENT_CONFLICT",
        "Nominal melebihi sisa cicilan atau pinjaman sudah tidak aktif.",
      );
    if (
      installment.loan.disbursedAt &&
      transferredAt &&
      transferredAt.getTime() + 60000 <= installment.loan.disbursedAt.getTime()
    )
      throw new WorkflowError(
        "INVALID_TRANSFER_DATE",
        "Waktu transfer tidak boleh sebelum pencairan.",
        400,
      );
    const account = await tx.familyBankAccount.findFirst({
      where: { id: input.bankAccountId, familyId: actor.familyId },
    });
    if (!account)
      throw new WorkflowError(
        "BANK_ACCOUNT_REQUIRED",
        "Rekening tujuan keluarga tidak ditemukan.",
        400,
      );
    const pending = await tx.payment.findFirst({
      where: {
        installmentId,
        provider: "MANUAL",
        status: "PENDING",
        bankAccountId: { not: null },
      },
    });
    if (pending)
      throw new WorkflowError(
        "PAYMENT_PENDING",
        "Masih ada laporan pembayaran yang menunggu pemeriksaan.",
      );
    const duplicate = transferReference
      ? await tx.payment.findFirst({
          where: {
            familyId: actor.familyId,
            provider: "MANUAL",
            transferReference,
            status: { in: ["PENDING", "SUCCESS"] },
          },
        })
      : null;
    if (duplicate)
      throw new WorkflowError(
        "DUPLICATE_TRANSFER",
        "Referensi transfer ini sudah dilaporkan pada keluarga ini.",
      );
    const payment = await tx.payment.create({
      data: {
        familyId: actor.familyId!,
        loanId,
        installmentId,
        payerId: actor.sub,
        provider: "MANUAL",
        externalId,
        status: "PENDING",
        amount,
        bankAccountId: account.id,
        transferReference,
        transferredAt,
        transferNotes,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        familyId: actor.familyId!,
        action: "MANUAL_TRANSFER_REPORTED",
        entityType: "Payment",
        entityId: payment.id,
        after: {
          amount,
          bankAccountId: account.id,
          transferReference,
        },
      },
    });
    await cancelReminders(
      tx,
      installmentId,
      "Pembayaran menunggu pemeriksaan pengelola dana.",
    );
    const managers = await tx.familyMember.findMany({
      where: {
        familyId: actor.familyId!,
        status: "ACTIVE",
        role: "TREASURER",
        userId: { not: actor.sub },
        user: { isActive: true, systemRole: { not: "SUPER_ADMIN" } },
      },
      select: { userId: true },
    });
    for (const manager of managers)
      await enqueue(tx, {
        eventKey: `PAYMENT_REPORTED:${payment.id}:${manager.userId}`,
        userId: manager.userId,
        familyId: actor.familyId!,
        kind: "PAYMENT_REPORTED",
        installmentId,
        body: `Laporan transfer ${money(payment.amount)} dari ${installment.loan.borrower?.name ?? "peminjam"}, cicilan ke-${installment.installmentNumber}, menunggu pemeriksaan mutasi rekening keluarga. Periksa uang masuk sebelum mengonfirmasi: ${installmentLink(installmentId)}`,
      });
    return payment;
  });
}
export async function reviewTransfer(
  actor: WorkflowActor,
  paymentId: string,
  decision: "confirm" | "reject",
  notes: string,
) {
  notes = notes.trim();
  if (decision === "reject" && notes.length < 5)
    throw new WorkflowError(
      "REJECTION_REASON_REQUIRED",
      "Isi alasan penolakan minimal 5 karakter.",
      400,
    );
  if (decision === "confirm" && !notes)
    notes = "Dana masuk sudah diperiksa pada rekening keluarga.";
  return prisma.$transaction(async (tx) => {
    const current = await authorize(tx, actor, true);
    const initial = await tx.payment.findFirst({
      where: {
        id: paymentId,
        familyId: actor.familyId,
        provider: "MANUAL",
        bankAccountId: { not: null },
      },
    });
    if (!initial)
      throw new WorkflowError(
        "PAYMENT_NOT_FOUND",
        "Laporan transfer tidak ditemukan.",
        404,
      );
    await tx.$queryRaw`SELECT id FROM "Loan" WHERE id = ${initial.loanId}::uuid FOR UPDATE`;
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: {
        installment: true,
        loan: { include: { borrower: true, family: true } },
      },
    });
    if (
      payment.provider !== "MANUAL" ||
      !payment.bankAccountId ||
      payment.payerId !== payment.loan.borrowerId ||
      payment.loan.familyId !== payment.familyId ||
      payment.installment.loanId !== payment.loanId
    )
      throw new WorkflowError(
        "INVALID_MANUAL_PAYMENT",
        "Laporan ini tidak dapat dikonfirmasi sebagai transfer manual.",
      );
    assertTransferReviewer(current, payment);
    const resultStatus = decision === "confirm" ? "SUCCESS" : "FAILED";
    if (payment.status === resultStatus) return payment;
    if (payment.status !== "PENDING")
      throw new WorkflowError(
        "PAYMENT_ALREADY_REVIEWED",
        "Laporan sudah diperiksa. Muat ulang rincian.",
      );
    const reviewedAt = new Date();
    if (decision === "reject") {
      const result = await tx.payment.update({
        where: { id: paymentId, status: "PENDING" },
        data: {
          status: "FAILED",
          reviewedById: actor.sub,
          reviewedAt,
          reviewNotes: notes,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          familyId: payment.familyId,
          action: "MANUAL_TRANSFER_REJECTED",
          entityType: "Payment",
          entityId: payment.id,
          after: { reason: notes },
        },
      });
      await enqueue(tx, {
        eventKey: `PAYMENT_REJECTED:${payment.id}`,
        userId: payment.payerId,
        familyId: payment.familyId,
        kind: "PAYMENT_REJECTED",
        installmentId: payment.installmentId,
        body: `Laporan transfer ${money(payment.amount)} untuk cicilan ke-${payment.installment.installmentNumber} belum dapat diterima. Alasan: ${notes}. Sisa cicilan belum berubah. Lihat rincian: ${installmentLink(payment.installmentId)}`,
      });
      return result;
    }
    if (
      payment.loan.status !== "ACTIVE" ||
      payment.installment.status === "PAID" ||
      payment.amount.lte(0) ||
      payment.amount.gt(payment.installment.remainingAmount)
    )
      throw new WorkflowError(
        "PAYMENT_CONFLICT",
        "Nominal laporan tidak sesuai dengan sisa cicilan.",
      );
    const paidAt = payment.transferredAt ?? reviewedAt;
    const result = await tx.payment.update({
      where: { id: paymentId, status: "PENDING" },
      data: {
        status: "SUCCESS",
        paidAt,
        reviewedById: actor.sub,
        reviewedAt,
        reviewNotes: notes,
      },
    });
    await tx.loanInstallment.update({
      where: { id: payment.installmentId },
      data: {
        status: financialInstallmentStatus(
          {
            remainingAmount: payment.installment.remainingAmount.sub(
              payment.amount,
            ),
            paidAmount: new Prisma.Decimal(
              payment.installment.paidAmount ?? 0,
            ).add(payment.amount),
            dueDate: payment.installment.dueDate,
          },
          reviewedAt,
        ),
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
      description: `Pembayaran transfer cicilan ke-${payment.installment.installmentNumber} oleh ${payment.loan.borrower.name}`,
      referenceType: "PAYMENT",
      referenceId: payment.id,
      createdById: actor.sub,
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        familyId: payment.familyId,
        action: "MANUAL_TRANSFER_CONFIRMED",
        entityType: "Payment",
        entityId: payment.id,
        after: {
          amount: payment.amount.toString(),
          status: "SUCCESS",
          notes,
          transferReference: payment.transferReference,
        },
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
