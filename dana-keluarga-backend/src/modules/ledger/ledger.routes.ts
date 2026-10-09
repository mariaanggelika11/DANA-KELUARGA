import { authorizeFamily } from "../cash/family-access.service";
import { amountSchema } from "../../utils/money";
import { postLedger } from "../cash/ledger.service";
import { Router } from "express";
import { z } from "zod";
import { WorkflowError } from "../approvals/approval.rules";
import { prisma } from "../../config/prisma";
import { requireAuth, type AuthRequest } from "../../middleware/auth";

const entrySchema = z.object({
  idempotencyKey: z.string().uuid(),
  direction: z.enum(["IN", "OUT"]),
  amount: amountSchema,
  description: z.string().trim().min(3).max(240),
  occurredAt: z.coerce.date().optional(),
});

export const ledgerRouter = Router();

function canManageLedger(req: AuthRequest) {
  return (
    req.auth?.systemRole !== "SUPER_ADMIN" &&
    (req.auth?.familyRole === "ADMIN" || req.auth?.familyRole === "TREASURER")
  );
}

ledgerRouter.get("/", requireAuth, async (req: AuthRequest, res) => {
  if (!req.auth?.familyId)
    return res.status(400).json({
      success: false,
      error: {
        code: "FAMILY_REQUIRED",
        message: "Akun belum memiliki keluarga",
      },
    });
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .default(1)
    .parse(req.query.page);
  const entries = await prisma.ledgerEntry.findMany({
    where: { familyId: req.auth.familyId },
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: 20,
    skip: (page - 1) * 20,
  });
  const loanIds = entries
    .filter(
      (entry) =>
        entry.type === "LOAN_DISBURSEMENT" && entry.referenceType === "LOAN",
    )
    .flatMap((entry) => (entry.referenceId ? [entry.referenceId] : []));
  const loans = loanIds.length
    ? await prisma.loan.findMany({
        where: { familyId: req.auth.familyId, id: { in: loanIds } },
        select: { id: true, borrower: { select: { name: true } } },
      })
    : [];
  const borrowerNames = new Map(
    loans.map((loan) => [loan.id, loan.borrower.name]),
  );
  const data = entries.map((entry) => {
    if (entry.type !== "LOAN_DISBURSEMENT" || entry.referenceType !== "LOAN")
      return entry;
    const name = entry.referenceId
      ? borrowerNames.get(entry.referenceId)
      : undefined;
    return {
      ...entry,
      description: name
        ? `Pencairan pinjaman untuk ${name}`
        : "Pencairan pinjaman",
    };
  });
  const total = await prisma.ledgerEntry.count({
    where: { familyId: req.auth.familyId },
  });
  return res.json({
    success: true,
    data,
    pagination: { page, pageSize: 20, total },
  });
});

ledgerRouter.post("/", requireAuth, async (req: AuthRequest, res) => {
  if (!canManageLedger(req))
    return res.status(403).json({
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "Hanya pengelola keluarga yang dapat mencatat kas",
      },
    });
  if (!req.auth?.familyId)
    return res.status(400).json({
      success: false,
      error: {
        code: "FAMILY_REQUIRED",
        message: "Akun belum memiliki keluarga",
      },
    });
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_LEDGER_ENTRY",
        message: "Arah, nominal, dan keterangan kas wajib valid",
      },
    });
  const entry = await prisma.$transaction(async (tx) => {
    await authorizeFamily(tx, req.auth!, ["ADMIN", "TREASURER"]);
    const existing = await tx.ledgerEntry.findUnique({
      where: {
        familyId_createdById_idempotencyKey: {
          familyId: req.auth!.familyId!,
          createdById: req.auth!.sub,
          idempotencyKey: parsed.data.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (
        !existing.amount.equals(parsed.data.amount) ||
        existing.direction !== parsed.data.direction ||
        existing.description !== parsed.data.description
      )
        throw new WorkflowError(
          "IDEMPOTENCY_CONFLICT",
          "Code transaksi sudah dipakai untuk isian berbeda.",
        );
      return existing;
    }
    const entry = await postLedger(tx, {
      familyId: req.auth!.familyId!,
      createdById: req.auth!.sub,
      ...parsed.data,
      type: parsed.data.direction === "IN" ? "OTHER_INCOME" : "EXPENSE",
    });
    return entry;
  });
  return res.status(201).json({
    success: true,
    data: entry,
    message: "Catatan kas berhasil disimpan",
  });
});
