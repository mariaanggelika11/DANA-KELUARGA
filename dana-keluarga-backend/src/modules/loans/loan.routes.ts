import { Router } from 'express';
import { z } from 'zod';
import { Prisma, LoanStatus, LedgerDirection, LedgerType } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { queueLoanEvent } from '../notifications/notification.service';
import { generateInstallments } from '../../utils/installments';
import { requireAuth, requireRole, type AuthRequest } from '../../middleware/auth';

const createLoanSchema = z.object({
  amount: z.coerce.number().int().positive(),
  tenorMonths: z.coerce.number().int().min(1).max(60),
  purpose: z.string().trim().min(3).max(240),
  borrowerId: z.string().uuid().optional(),
});

export const loanRouter = Router();
loanRouter.use(requireAuth, (req: AuthRequest, res, next) => {
  if (!req.auth!.familyId && req.auth!.systemRole !== 'SUPER_ADMIN') return res.status(403).json({ error: { message: 'Keanggotaan keluarga aktif diperlukan' } });
  next();
});

loanRouter.get('/', async (req: AuthRequest, res) => {
  const canViewAll = req.auth!.systemRole === 'SUPER_ADMIN' || req.auth!.familyRole === 'ADMIN' || req.auth!.familyRole === 'TREASURER';
  const loans = await prisma.loan.findMany({ where: { familyId: req.auth!.familyId, ...(canViewAll ? {} : { borrowerId: req.auth!.sub }) }, include: { borrower: { select: { id: true, name: true, phone: true } }, approvedBy: { select: { id: true, name: true } }, rejectedBy: { select: { id: true, name: true } }, installments: { orderBy: { installmentNumber: 'asc' } } }, orderBy: { createdAt: 'desc' } });
  return res.json({ success: true, data: loans });
});

loanRouter.post('/', async (req: AuthRequest, res) => {
  const parsed = createLoanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: { code: 'INVALID_LOAN', message: 'Jumlah, tenor, dan tujuan pinjaman harus valid' } });
  const family = req.auth?.familyId ? await prisma.family.findUnique({ where: { id: req.auth.familyId } }) : null;
  if (!family) return res.status(400).json({ success: false, error: { code: 'FAMILY_NOT_FOUND', message: 'Keluarga belum tersedia' } });
  const canSelectBorrower = req.auth!.systemRole === 'SUPER_ADMIN' || req.auth!.familyRole === 'ADMIN' || req.auth!.familyRole === 'TREASURER';
  const borrowerId = canSelectBorrower && parsed.data.borrowerId ? parsed.data.borrowerId : req.auth!.sub;
  const member = borrowerId
    ? await prisma.familyMember.findFirst({ where: { familyId: family.id, userId: borrowerId, status: 'ACTIVE' } })
    : null;
  if (!member) return res.status(400).json({ success: false, error: { code: 'MEMBER_NOT_FOUND', message: 'Anggota aktif belum tersedia' } });
  const loan = await prisma.$transaction(async (tx) => {
    // Serialize concurrent applications by the same member in the same family.
    await tx.$queryRaw`SELECT id FROM "FamilyMember" WHERE id = ${member.id}::uuid FOR UPDATE`;
    const duplicate = await tx.loan.findFirst({ where: { familyId: family.id, borrowerId: member.userId, status: { in: ['PENDING', 'APPROVED', 'ACTIVE'] } } });
    if (duplicate) throw new Error('LOAN_ALREADY_EXISTS');
    const created = await tx.loan.create({ data: { familyId: family.id, borrowerId: member.userId, principalAmount: new Prisma.Decimal(parsed.data.amount), tenorMonths: parsed.data.tenorMonths, purpose: parsed.data.purpose }, include: { borrower: { select: { id: true, name: true, phone: true } } } });
    await queueLoanEvent(tx, created.id, 'LOAN_REQUESTED');
    return created;
  });
  return res.status(201).json({ success: true, data: loan, message: 'Pengajuan pinjaman berhasil dibuat' });
});

loanRouter.post('/:id/approve', requireRole('ADMIN', 'TREASURER'), async (req: AuthRequest, res) => {
  const loanId = String(req.params.id);
  const loan = await prisma.loan.findFirst({ where: { id: loanId, familyId: req.auth!.familyId } });
  if (!loan) return res.status(404).json({ success: false, error: { code: 'LOAN_NOT_FOUND', message: 'Pinjaman tidak ditemukan' } });
  if (loan.status !== LoanStatus.PENDING) return res.status(409).json({ success: false, error: { code: 'LOAN_ALREADY_PROCESSED', message: 'Pinjaman sudah diproses' } });
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.loan.update({ where: { id: loanId, status: LoanStatus.PENDING }, data: { status: LoanStatus.APPROVED, approvedById: req.auth!.sub, approvedAt: new Date() } });
    await queueLoanEvent(tx, loanId, 'LOAN_APPROVED');
    return result;
  });
  return res.json({ success: true, data: updated, message: 'Pinjaman disetujui, menunggu pencairan' });
});

loanRouter.post('/:id/reject', requireRole('ADMIN', 'TREASURER'), async (req: AuthRequest, res) => {
  const loanId = String(req.params.id);
  const reason = z.object({ reason: z.string().trim().min(3).max(240) }).safeParse(req.body);
  if (!reason.success) return res.status(400).json({ success: false, error: { code: 'REJECTION_REASON_REQUIRED', message: 'Alasan penolakan wajib diisi' } });
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.loan.updateMany({ where: { id: loanId, familyId: req.auth!.familyId, status: LoanStatus.PENDING }, data: { status: LoanStatus.REJECTED, rejectedById: req.auth!.sub, rejectionReason: reason.data.reason, rejectedAt: new Date() } });
    if (result.count) await queueLoanEvent(tx, loanId, 'LOAN_REJECTED');
    return result;
  });
  if (!updated.count) return res.status(409).json({ success: false, error: { code: 'LOAN_ALREADY_PROCESSED', message: 'Pinjaman tidak dapat ditolak' } });
  return res.json({ success: true, message: 'Pinjaman ditolak' });
});

loanRouter.post('/:id/disburse', requireRole('ADMIN', 'TREASURER'), async (req: AuthRequest, res) => {
  const loanId = String(req.params.id);
  const loan = await prisma.loan.findFirst({ where: { id: loanId, familyId: req.auth!.familyId } });
  if (!loan || loan.status !== LoanStatus.APPROVED) return res.status(409).json({ success: false, error: { code: 'LOAN_NOT_APPROVED', message: 'Pinjaman belum disetujui atau sudah dicairkan' } });
  const disbursedAt = new Date();
  const installments = generateInstallments(BigInt(loan.principalAmount.toFixed(0)), loan.tenorMonths, disbursedAt, 1);
  const updated = await prisma.$transaction(async (tx) => {
    // Serialize withdrawals against the same family balance.
    await tx.$queryRaw`SELECT id FROM "Family" WHERE id = ${loan.familyId}::uuid FOR UPDATE`;
    const entries = await tx.ledgerEntry.groupBy({ by: ['direction'], where: { familyId: loan.familyId }, _sum: { amount: true } });
    const balance = entries.reduce((sum, row) => row.direction === 'IN' ? sum.add(row._sum.amount ?? 0) : sum.sub(row._sum.amount ?? 0), new Prisma.Decimal(0));
    if (balance.lt(loan.principalAmount)) throw new Error('INSUFFICIENT_FAMILY_BALANCE');
    const result = await tx.loan.update({ where: { id: loanId, status: LoanStatus.APPROVED }, data: { status: LoanStatus.ACTIVE, disbursedAt } });
    await tx.loanInstallment.createMany({ data: installments.map((item) => ({ loanId: loan.id, installmentNumber: item.installmentNumber, dueDate: item.dueDate, principalAmount: new Prisma.Decimal(item.principalAmount.toString()), paidAmount: 0, remainingAmount: new Prisma.Decimal(item.remainingAmount.toString()) })) });
    await tx.ledgerEntry.create({ data: { familyId: loan.familyId, type: LedgerType.LOAN_DISBURSEMENT, direction: LedgerDirection.OUT, amount: loan.principalAmount, description: `Pencairan pinjaman ${loan.id}`, referenceType: 'LOAN', referenceId: loan.id, createdById: req.auth!.sub } });
    await queueLoanEvent(tx, loanId, 'LOAN_DISBURSED');
    return result;
  });
  return res.json({ success: true, data: updated, message: 'Pinjaman berhasil dicairkan' });
});
