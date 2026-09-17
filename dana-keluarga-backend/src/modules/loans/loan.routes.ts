import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import {
  createLoanApproval,
  actOnRequest,
} from '../approvals/approval.service';
import {
  WorkflowError,
  requireOperationalActor,
} from '../approvals/approval.rules';
import { requireAuth, type AuthRequest } from '../../middleware/auth';

const createLoanSchema = z.object({
  amount: z.coerce.number().int().positive(),
  tenorMonths: z.coerce.number().int().min(1).max(60),
  purpose: z.string().trim().min(3).max(240),
  borrowerId: z.string().uuid().optional(),
});

export const loanRouter = Router();
loanRouter.use(requireAuth, (req: AuthRequest, res, next) => {
  requireOperationalActor(req.auth!, req.auth!.familyId ?? '');
  if (!req.auth!.familyId)
    throw new WorkflowError(
      'FAMILY_REQUIRED',
      'Pilih keluarga aktif terlebih dahulu.',
      403,
    );
  next();
});

loanRouter.get('/', async (req: AuthRequest, res) => {
  const canViewAll = req.auth!.familyRole === 'ADMIN';
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
            orderBy: { sequence: 'asc' },
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
      installments: { orderBy: { installmentNumber: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return res.json({ success: true, data: loans });
});

loanRouter.post('/', async (req: AuthRequest, res) => {
  const parsed = createLoanSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({
        success: false,
        error: {
          code: 'INVALID_LOAN',
          message: 'Jumlah, tenor, dan tujuan pinjaman harus valid',
        },
      });
  const family = req.auth?.familyId
    ? await prisma.family.findUnique({ where: { id: req.auth.familyId } })
    : null;
  if (!family)
    return res
      .status(400)
      .json({
        success: false,
        error: { code: 'FAMILY_NOT_FOUND', message: 'Keluarga belum tersedia' },
      });
  const canSelectBorrower = req.auth!.familyRole === 'ADMIN';
  const borrowerId =
    canSelectBorrower && parsed.data.borrowerId
      ? parsed.data.borrowerId
      : req.auth!.sub;
  const member = borrowerId
    ? await prisma.familyMember.findFirst({
        where: { familyId: family.id, userId: borrowerId, status: 'ACTIVE' },
      })
    : null;
  if (!member)
    return res
      .status(400)
      .json({
        success: false,
        error: {
          code: 'MEMBER_NOT_FOUND',
          message: 'Anggota aktif belum tersedia',
        },
      });
  const loan = await prisma.$transaction(async (tx) => {
    // Serialize concurrent applications by the same member in the same family.
    await tx.$queryRaw`SELECT id FROM "FamilyMember" WHERE id = ${member.id}::uuid FOR UPDATE`;
    const duplicate = await tx.loan.findFirst({
      where: {
        familyId: family.id,
        borrowerId: member.userId,
        status: { in: ['PENDING', 'APPROVED', 'ACTIVE'] },
      },
    });
    if (duplicate) throw new Error('LOAN_ALREADY_EXISTS');
    const created = await tx.loan.create({
      data: {
        familyId: family.id,
        borrowerId: member.userId,
        principalAmount: new Prisma.Decimal(parsed.data.amount),
        tenorMonths: parsed.data.tenorMonths,
        purpose: parsed.data.purpose,
      },
      include: { borrower: { select: { id: true, name: true, phone: true } } },
    });
    await createLoanApproval(tx, req.auth!, created);
    return created;
  });
  return res
    .status(201)
    .json({
      success: true,
      data: loan,
      message: 'Pengajuan pinjaman berhasil dibuat',
    });
});

// Keep old URLs safe: all financial decisions now go through the workflow engine.
for (const [path, action] of [
  ['approve', 'APPROVE'],
  ['reject', 'REJECT'],
  ['disburse', 'RELEASE'],
] as const) {
  loanRouter.post(`/:id/${path}`, async (req: AuthRequest, res) => {
    const loan = await prisma.loan.findFirst({
      where: { id: String(req.params.id), familyId: req.auth!.familyId },
    });
    if (!loan)
      throw new WorkflowError(
        'LOAN_NOT_FOUND',
        'Pinjaman tidak ditemukan.',
        404,
      );
    if (!loan.approvalRequestId)
      throw new WorkflowError(
        'LEGACY_WORKFLOW_REQUIRED',
        'Pinjaman lama belum memiliki snapshot hirarki. Perlu ditinjau melalui rekonsiliasi sebelum dapat diproses.',
      );
    const notes =
      typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    if (action === 'REJECT' && (!notes || notes.trim().length < 3))
      throw new WorkflowError(
        'NOTE_REQUIRED',
        'Alasan penolakan wajib diisi.',
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
