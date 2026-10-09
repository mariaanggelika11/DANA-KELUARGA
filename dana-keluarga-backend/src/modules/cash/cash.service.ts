import { formatMoney } from "../../utils/money";
import { enqueue } from "../notifications/notification.service";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { WorkflowError, type WorkflowActor } from "../approvals/approval.rules";
import { createLoanApproval } from "../approvals/approval.service";
import { authorizeFamily } from "./family-access.service";
import { calculateFundRequest, validateRequestIntent } from "./cash.rules";
import {
  cashBalance,
  memberContribution,
  postLedger,
  reservedCash,
} from "./ledger.service";

const conflict = () =>
  new WorkflowError(
    "IDEMPOTENCY_CONFLICT",
    "Kode transaksi sudah digunakan untuk isian berbeda. Buka formulir baru.",
  );
export { contribute } from "./contribution.service";
export async function requestFunds(
  actor: WorkflowActor,
  input: {
    amount: string;
    purpose: string;
    tenorMonths: number;
    idempotencyKey: string;
  },
  intent: "MIXED" | "WITHDRAWAL" | "LOAN" = "MIXED",
  expectedWithdrawal?: string,
) {
  return prisma.$transaction(async (tx) => {
    const current = await authorizeFamily(tx, actor);
    const familyId = current.familyId;
    const previous = await tx.fundRequest.findUnique({
      where: {
        familyId_userId_idempotencyKey: {
          familyId,
          userId: actor.sub,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (previous) {
      validateRequestIntent(intent, BigInt(previous.loanAmount.toFixed(0)));
      if (
        !previous.amount.equals(input.amount) ||
        previous.purpose !== input.purpose ||
        previous.tenorMonths !== input.tenorMonths
      )
        throw conflict();
      return previous;
    }
    const contribution = await memberContribution(tx, familyId, actor.sub);
    const split = calculateFundRequest(
      BigInt(input.amount),
      BigInt(contribution.available.toFixed(0)),
    );
    validateRequestIntent(intent, split.loanAmount);
    if (
      expectedWithdrawal !== undefined &&
      split.withdrawalAmount !== BigInt(expectedWithdrawal)
    )
      throw new WorkflowError(
        "CONTRIBUTION_CHANGED",
        "Kontribusi tersedia telah berubah. Tutup formulir dan buka kembali untuk memeriksa rincian terbaru.",
        409,
      );
    const availableCash = (await cashBalance(tx, familyId)).sub(
      await reservedCash(tx, familyId),
    );
    if (availableCash.lt(input.amount))
      throw new WorkflowError(
        "INSUFFICIENT_FAMILY_CASH",
        "Saldo Kas Keluarga tidak mencukupi untuk transaksi ini.",
      );
    if (split.requiresApproval && split.loanAmount < BigInt(input.tenorMonths))
      throw new WorkflowError(
        "INVALID_TENOR",
        "Jumlah bulan tidak boleh melebihi nominal pinjaman dalam Rupiah.",
        400,
      );
    const request = await tx.fundRequest.create({
      data: {
        familyId,
        userId: actor.sub,
        ...input,
        withdrawalAmount: split.withdrawalAmount.toString(),
        loanAmount: split.loanAmount.toString(),
        status: split.requiresApproval ? "PENDING" : "ACTIVE",
      },
    });
    if (!split.requiresApproval) {
      await postLedger(tx, {
        familyId,
        createdById: actor.sub,
        ownerUserId: actor.sub,
        type: "WITHDRAWAL",
        direction: "OUT",
        amount: input.amount,
        description: input.purpose,
        referenceType: "FUND_REQUEST",
        referenceId: request.id,
      });
      await enqueue(tx, {
        eventKey: `WITHDRAWAL:${request.id}`,
        familyId,
        userId: actor.sub,
        kind: "WITHDRAWAL",
        view: "cash",
        body: `Tarikan ${formatMoney(input.amount)} berhasil dicatat dari kontribusi Anda. Tidak ada utang baru.`,
      });
      return request;
    }
    const existing = await tx.loan.findFirst({
      where: {
        familyId,
        borrowerId: actor.sub,
        status: { in: ["PENDING", "APPROVED", "ACTIVE"] },
      },
    });
    if (existing)
      throw new WorkflowError(
        "LOAN_ALREADY_EXISTS",
        "Selesaikan pengajuan atau pinjaman aktif Anda terlebih dahulu.",
      );
    const loan = await tx.loan.create({
      data: {
        familyId,
        borrowerId: actor.sub,
        principalAmount: split.loanAmount.toString(),
        tenorMonths: input.tenorMonths,
        purpose: input.purpose,
      },
    });
    const result = await tx.fundRequest.update({
      where: { id: request.id },
      data: { loanId: loan.id },
    });
    await createLoanApproval(tx, actor, loan);
    return result;
  });
}
export async function cashSummary(actor: WorkflowActor, page = 1) {
  return prisma.$transaction(async (tx) => {
    const current = await authorizeFamily(tx, actor);
    const familyId = current.familyId;
    const balance = await cashBalance(tx, familyId);
    const reserved = await reservedCash(tx, familyId);
    const contribution = await memberContribution(tx, familyId, actor.sub);
    const familyLoans = await tx.loan.findMany({
      where: { familyId, disbursedAt: { not: null } },
      include: { installments: true },
    });
    const sum = (values: Prisma.Decimal[]) =>
      values.reduce((a, b) => a.add(b), new Prisma.Decimal(0));
    const loanTotals = (loans: typeof familyLoans) => ({
      loanTotal: sum(loans.map((loan) => loan.principalAmount)),
      repaid: sum(
        loans.flatMap((loan) =>
          loan.installments.map((item) => item.paidAmount),
        ),
      ),
      outstanding: sum(
        loans.flatMap((loan) =>
          loan.installments.map((item) => item.remainingAmount),
        ),
      ),
    });
    const familyLoanTotals = loanTotals(familyLoans);
    const ownLoanTotals = loanTotals(
      familyLoans.filter((loan) => loan.borrowerId === actor.sub),
    );
    const availableCash = balance.sub(reserved);
    const withdrawable = (available: Prisma.Decimal) =>
      Prisma.Decimal.max(0, Prisma.Decimal.min(available, availableCash));
    const canManage = ["ADMIN", "TREASURER"].includes(current.familyRole ?? "");
    const members = await tx.familyMember.findMany({
      where: { familyId, ...(canManage ? {} : { userId: actor.sub }) },
      select: { userId: true, user: { select: { name: true } } },
    });
    const contributions = await Promise.all(
      members.map(async (member) => {
        const contribution = await memberContribution(
          tx,
          familyId,
          member.userId,
        );
        return {
          userId: member.userId,
          name: member.user.name,
          ...contribution,
          withdrawable: withdrawable(contribution.available),
          ...loanTotals(
            familyLoans.filter((loan) => loan.borrowerId === member.userId),
          ),
        };
      }),
    );
    const requests = await tx.fundRequest.findMany({
      where: { familyId, ...(canManage ? {} : { userId: actor.sub }) },
      include: {
        user: { select: { name: true } },
        loan: {
          select: {
            disbursedAt: true,
            paidOffAt: true,
            installments: {
              select: { paidAmount: true, remainingAmount: true },
            },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      skip: (page - 1) * 20,
    });
    const requestsTotal = await tx.fundRequest.count({
      where: { familyId, ...(canManage ? {} : { userId: actor.sub }) },
    });
    return {
      requestsTotal,
      balance,
      reserved,
      availableCash,
      contribution: {
        ...contribution,
        withdrawable: withdrawable(contribution.available),
      },
      ...ownLoanTotals,
      familyLoanTotals,
      contributions,
      requests: requests.map(({ loan, ...request }) => ({
        ...request,
        disbursedAt: loan?.disbursedAt ?? null,
        paidOffAt: loan?.paidOffAt ?? null,
        loanProgress: loan?.disbursedAt
          ? {
              repaid: sum(loan.installments.map((item) => item.paidAmount)),
              outstanding: sum(
                loan.installments.map((item) => item.remainingAmount),
              ),
              paidInstallments: loan.installments.filter((item) =>
                item.remainingAmount.isZero(),
              ).length,
              totalInstallments: loan.installments.length,
            }
          : null,
      })),
    };
  });
}
