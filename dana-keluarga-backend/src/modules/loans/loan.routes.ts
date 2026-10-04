import { requestFunds } from "../cash/cash.service";
import { fundRequestSchema } from "../cash/cash.routes";
import { Router } from "express";
import { prisma } from "../../config/prisma";
import { actOnRequest } from "../approvals/approval.service";
import {
  WorkflowError,
  requireOperationalActor,
} from "../approvals/approval.rules";
import { requireAuth, type AuthRequest } from "../../middleware/auth";

export const loanRouter = Router();
loanRouter.use(requireAuth, (req: AuthRequest, res, next) => {
  requireOperationalActor(req.auth!, req.auth!.familyId ?? "");
  if (!req.auth!.familyId)
    throw new WorkflowError(
      "FAMILY_REQUIRED",
      "Pilih keluarga aktif terlebih dahulu.",
      403,
    );
  next();
});

loanRouter.get("/", async (req: AuthRequest, res) => {
  const canViewAll = req.auth!.familyRole === "ADMIN";
  const loans = await prisma.loan.findMany({
    where: {
      familyId: req.auth!.familyId,
      ...(canViewAll ? {} : { borrowerId: req.auth!.sub }),
    },
    include: {
      borrower: { select: { id: true, name: true, phone: true } },
      approvalRequest: {
        select: {
          id: true,
          status: true,
          currentStep: true,
          steps: {
            orderBy: { sequence: "asc" },
            select: {
              sequence: true,
              permission: true,
              status: true,
              assignedUser: { select: { id: true, name: true } },
            },
          },
        },
      },
      approvedBy: { select: { id: true, name: true } },
      rejectedBy: { select: { id: true, name: true } },
      installments: { orderBy: { installmentNumber: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ success: true, data: loans });
});

loanRouter.post("/", async (req: AuthRequest, res) => {
  // The legacy URL uses the same split calculation; clients cannot bypass contribution ownership.
  if (req.body.borrowerId && req.body.borrowerId !== req.auth!.sub)
    throw new WorkflowError(
      "OWN_REQUEST_REQUIRED",
      "Pengambilan dana harus diajukan oleh pemilik kontribusi sendiri.",
      403,
    );
  const data = await requestFunds(req.auth!, fundRequestSchema.parse(req.body));
  res.status(201).json({ success: true, data });
});

// Keep old URLs safe: all financial decisions now go through the workflow engine.
for (const [path, action] of [
  ["approve", "APPROVE"],
  ["reject", "REJECT"],
  ["disburse", "RELEASE"],
] as const) {
  loanRouter.post(`/:id/${path}`, async (req: AuthRequest, res) => {
    const loan = await prisma.loan.findFirst({
      where: { id: String(req.params.id), familyId: req.auth!.familyId },
    });
    if (!loan)
      throw new WorkflowError(
        "LOAN_NOT_FOUND",
        "Pinjaman tidak ditemukan.",
        404,
      );
    if (!loan.approvalRequestId)
      throw new WorkflowError(
        "LEGACY_WORKFLOW_REQUIRED",
        "Pinjaman lama belum memiliki snapshot hirarki. Perlu ditinjau melalui rekonsiliasi sebelum dapat diproses.",
      );
    const notes =
      typeof req.body?.reason === "string" ? req.body.reason : undefined;
    if (action === "REJECT" && (!notes || notes.trim().length < 3))
      throw new WorkflowError(
        "NOTE_REQUIRED",
        "Alasan penolakan wajib diisi.",
        400,
      );
    const data = await actOnRequest(
      req.auth!,
      loan.approvalRequestId,
      action,
      notes,
    );
    res.json({ success: true, data });
  });
}
