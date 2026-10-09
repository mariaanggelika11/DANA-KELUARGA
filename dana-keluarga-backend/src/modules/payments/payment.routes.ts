import {
  authorizeFamily,
  availableReviewers,
} from "../cash/family-access.service";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAuth, type AuthRequest } from "../../middleware/auth";
import {
  WorkflowError,
  requireOperationalActor,
} from "../approvals/approval.rules";
import {
  bankAccountSchema,
  transferSchema,
  reviewSchema,
  isFundManager,
  installmentPaymentStatus,
} from "./payment.rules";
import {
  bankAccountSelect,
  saveBankAccount,
  reportTransfer,
  reviewTransfer,
  reversePayment,
} from "./payment.service";

export const paymentRouter = Router();
// Retired provider callbacks never mutate payments, even when old clients retry.
paymentRouter.post("/webhooks/:provider", (_req, res) =>
  res.status(410).json({
    success: false,
    error: {
      code: "MANUAL_TRANSFER_ONLY",
      message: "Pembayaran menggunakan transfer bank manual.",
    },
  }),
);
paymentRouter.use(requireAuth, (req: AuthRequest, _res, next) => {
  requireOperationalActor(req.auth!, req.auth!.familyId ?? "");
  next();
});
paymentRouter.get("/bank-account", async (req: AuthRequest, res) => {
  const account = await prisma.familyBankAccount.findFirst({
    where: { familyId: req.auth!.familyId! },
    orderBy: { version: "desc" },
    select: bankAccountSelect,
  });
  res.json({
    success: true,
    data: { account, canManage: isFundManager(req.auth!) },
  });
});
paymentRouter.put("/bank-account", async (req: AuthRequest, res) => {
  const account = await saveBankAccount(
    req.auth!,
    bankAccountSchema.parse(req.body),
  );
  res.json({
    success: true,
    data: account,
    message: "Rekening tujuan keluarga berhasil disimpan.",
  });
});
paymentRouter.get("/pending", async (req: AuthRequest, res) => {
  if (!isFundManager(req.auth!))
    throw new WorkflowError(
      "FORBIDDEN",
      "Hanya pengelola dana dapat membuka antrean pembayaran.",
      403,
    );
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .default(1)
    .parse(req.query.page);
  const where = {
    familyId: req.auth!.familyId!,
    provider: "MANUAL" as const,
    status: "PENDING" as const,
    bankAccountId: { not: null },
    payerId: { not: req.auth!.sub },
    loan: { borrowerId: { not: req.auth!.sub } },
  };
  const [items, total] = await prisma.$transaction(async (tx) => {
    await authorizeFamily(tx, req.auth!, ["TREASURER"]);
    return Promise.all([
      tx.payment.findMany({
        where,
        include: {
          bankAccount: { select: bankAccountSelect },
          loan: {
            select: { borrower: { select: { name: true } }, purpose: true },
          },
          installment: { select: { installmentNumber: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      tx.payment.count({ where }),
    ]);
  });
  res.json({ success: true, data: { items, total, page } });
});
paymentRouter.get("/installments/:id", async (req: AuthRequest, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const detail = await prisma.$transaction(async (tx) => {
    const current = await authorizeFamily(tx, req.auth!);
    const installment = await tx.loanInstallment.findFirst({
      where: {
        id,
        loan: {
          familyId: current.familyId,
          ...(["ADMIN", "TREASURER"].includes(current.familyRole)
            ? {}
            : { borrowerId: current.sub }),
        },
      },
      include: {
        loan: {
          select: {
            id: true,
            purpose: true,
            status: true,
            borrowerId: true,
            borrower: { select: { name: true } },
          },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            amount: true,
            status: true,
            provider: true,
            paidAt: true,
            createdAt: true,
            transferredAt: true,
            transferReference: true,
            transferNotes: true,
            reviewedAt: true,
            reviewNotes: true,
            reversedAt: true,
            reversalReason: true,
            reversedBy: { select: { name: true } },
            bankAccount: { select: bankAccountSelect },
            reviewedBy: { select: { name: true } },
          },
        },
      },
    });
    if (!installment)
      throw new WorkflowError(
        "INSTALLMENT_NOT_FOUND",
        "Cicilan tidak ditemukan atau tidak dapat diakses.",
        404,
      );
    const account = await tx.familyBankAccount.findFirst({
      where: { familyId: req.auth!.familyId! },
      orderBy: { version: "desc" },
      select: bankAccountSelect,
    });
    const own = installment.loan.borrowerId === req.auth!.sub;
    const paymentStatus = installmentPaymentStatus(installment);
    const reviewers = await availableReviewers(
      tx,
      current.familyId,
      installment.loan.borrowerId,
    );
    return {
      ...installment,
      paymentStatus,
      bankAccount: account,
      reviewerAvailable: reviewers.length > 0,
      canReverse: isFundManager(current) && !own,
      isBorrower: own,
      canReport:
        own &&
        Boolean(account) &&
        reviewers.length > 0 &&
        installment.loan.status === "ACTIVE" &&
        paymentStatus !== "PENDING_REVIEW" &&
        installment.remainingAmount.gt(0),
      canReview:
        isFundManager(current) && !own && paymentStatus === "PENDING_REVIEW",
      requiresIndependentReviewer:
        isFundManager(current) &&
        own &&
        installment.loan.status === "ACTIVE" &&
        installment.remainingAmount.gt(0),
    };
  });
  res.json({ success: true, data: detail });
});
paymentRouter.post(
  "/loans/:loanId/installments/:installmentId",
  async (req: AuthRequest, res) => {
    const loanId = z.string().uuid().parse(req.params.loanId);
    const installmentId = z.string().uuid().parse(req.params.installmentId);
    const payment = await reportTransfer(
      req.auth!,
      loanId,
      installmentId,
      transferSchema.parse(req.body),
    );
    res.json({
      success: true,
      data: payment,
      message:
        "Laporan transfer dikirim. Cicilan diperbarui setelah pengelola dana mengonfirmasi uang masuk.",
    });
  },
);
for (const action of ["confirm", "reject"] as const) {
  paymentRouter.post(`/:id/${action}`, async (req: AuthRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const { notes } = reviewSchema.parse(req.body);
    const payment = await reviewTransfer(req.auth!, id, action, notes);
    res.json({
      success: true,
      data: payment,
      message:
        action === "confirm"
          ? "Dana masuk dikonfirmasi. Kas dan cicilan sudah diperbarui."
          : "Laporan transfer ditolak. Alasan telah disampaikan kepada peminjam.",
    });
  });
}

paymentRouter.post("/:id/reverse", async (req: AuthRequest, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { reason } = z
    .object({ reason: z.string().trim().min(5).max(500) })
    .strict()
    .parse(req.body);
  res.json({
    success: true,
    data: await reversePayment(req.auth!, id, reason),
    message:
      "Pembayaran dikoreksi. Kas, cicilan, dan status pinjaman diperbarui; riwayat lama tetap tersimpan.",
  });
});
