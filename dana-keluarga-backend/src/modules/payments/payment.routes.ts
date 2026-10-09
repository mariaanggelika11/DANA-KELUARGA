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
const canReadFamily = (req: AuthRequest) =>
  ["ADMIN", "TREASURER"].includes(req.auth!.familyRole ?? "");
const scope = (req: AuthRequest) => ({
  familyId: req.auth!.familyId!,
  ...(canReadFamily(req) ? {} : { borrowerId: req.auth!.sub }),
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
  const [items, total] = await prisma.$transaction([
    prisma.payment.findMany({
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
    prisma.payment.count({ where }),
  ]);
  res.json({ success: true, data: { items, total, page } });
});
paymentRouter.get("/installments/:id", async (req: AuthRequest, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const installment = await prisma.loanInstallment.findFirst({
    where: { id, loan: scope(req) },
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
  const account = await prisma.familyBankAccount.findFirst({
    where: { familyId: req.auth!.familyId! },
    orderBy: { version: "desc" },
    select: bankAccountSelect,
  });
  const own = installment.loan.borrowerId === req.auth!.sub;
  const paymentStatus = installmentPaymentStatus(installment);
  res.json({
    success: true,
    data: {
      ...installment,
      paymentStatus,
      bankAccount: account,
      isBorrower: own,
      canReport:
        own &&
        Boolean(account) &&
        installment.loan.status === "ACTIVE" &&
        paymentStatus !== "PENDING_REVIEW" &&
        installment.remainingAmount.gt(0),
      canReview:
        isFundManager(req.auth!) && !own && paymentStatus === "PENDING_REVIEW",
      requiresIndependentReviewer:
        isFundManager(req.auth!) &&
        own &&
        installment.loan.status === "ACTIVE" &&
        installment.remainingAmount.gt(0),
    },
  });
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
