import crypto from 'node:crypto';
import { Router } from 'express';
import { PaymentStatus, Prisma, InstallmentStatus, LoanStatus, LedgerDirection, LedgerType } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { requireAuth, type AuthRequest } from '../../middleware/auth';

export const paymentRouter = Router();

function canManage(req: AuthRequest) {
  return req.auth?.systemRole === 'SUPER_ADMIN' || req.auth?.familyRole === 'ADMIN' || req.auth?.familyRole === 'TREASURER';
}

paymentRouter.post('/loans/:loanId/installments/:installmentId', requireAuth, async (req: AuthRequest, res) => {
  const loanId = String(req.params.loanId);
  const installmentId = String(req.params.installmentId);
  const installment = await prisma.loanInstallment.findFirst({ where: { id: installmentId, loanId, loan: { familyId: req.auth!.familyId } }, include: { loan: true } });
  if (!installment) return res.status(404).json({ success: false, error: { code: 'INSTALLMENT_NOT_FOUND', message: 'Cicilan tidak ditemukan' } });
  if (!canManage(req) && installment.loan.borrowerId !== req.auth!.sub) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cicilan bukan milik akun ini' } });
  if (installment.loan.status !== LoanStatus.ACTIVE) return res.status(409).json({ success: false, error: { code: 'LOAN_NOT_ACTIVE', message: 'Pinjaman belum aktif' } });
  if (installment.status === InstallmentStatus.PAID) return res.status(409).json({ success: false, error: { code: 'INSTALLMENT_ALREADY_PAID', message: 'Cicilan sudah lunas' } });
  const existing = await prisma.payment.findFirst({ where: { installmentId, status: PaymentStatus.PENDING } });
  if (existing) return res.json({ success: true, data: existing, message: 'Pembayaran yang sama masih menunggu' });
  const externalId = `sandbox-${crypto.randomUUID()}`;
  const payment = await prisma.payment.create({ data: { familyId: installment.loan.familyId, loanId, installmentId, payerId: installment.loan.borrowerId, amount: installment.remainingAmount, provider: env.PAYMENT_PROVIDER === 'midtrans' ? 'MIDTRANS' : 'SANDBOX', externalId, qrisPayload: `DANA-KELUARGA|${externalId}|${installment.remainingAmount.toFixed(0)}`, qrisUrl: null, expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
  return res.status(201).json({ success: true, data: payment, message: env.PAYMENT_PROVIDER === 'midtrans' ? 'QRIS payment intent dibuat' : 'Payment intent sandbox dibuat' });
});

paymentRouter.post('/webhooks/:provider', async (req, res) => {
  const externalId = zString(req.body?.externalId);
  const status = zString(req.body?.status)?.toUpperCase();
  if (!externalId || !status) return res.status(400).json({ success: false, error: { code: 'INVALID_WEBHOOK', message: 'externalId dan status wajib diisi' } });
  const payment = await prisma.payment.findUnique({ where: { externalId }, include: { installment: true, loan: true } });
  if (!payment) return res.status(404).json({ success: false, error: { code: 'PAYMENT_NOT_FOUND', message: 'Pembayaran tidak ditemukan' } });
  if (payment.status === PaymentStatus.SUCCESS) return res.json({ success: true, message: 'Webhook sudah diproses' });
  if (!['SUCCESS', 'SETTLEMENT', 'PAID'].includes(status)) return res.json({ success: true, message: 'Status webhook diabaikan' });
  await prisma.$transaction(async (tx) => {
    const updatedPayment = await tx.payment.updateMany({ where: { id: payment.id, status: PaymentStatus.PENDING }, data: { status: PaymentStatus.SUCCESS, paidAt: new Date(), providerReference: String(req.body?.providerReference ?? '') || null, rawCallback: req.body as Prisma.InputJsonValue } });
    if (!updatedPayment.count) return;
    await tx.loanInstallment.update({ where: { id: payment.installmentId }, data: { status: InstallmentStatus.PAID, paidAmount: payment.amount, remainingAmount: 0, paidAt: new Date() } });
    const unpaid = await tx.loanInstallment.count({ where: { loanId: payment.loanId, status: { not: InstallmentStatus.PAID } } });
    if (!unpaid) await tx.loan.update({ where: { id: payment.loanId }, data: { status: LoanStatus.PAID_OFF, paidOffAt: new Date() } });
    await tx.ledgerEntry.create({ data: { familyId: payment.familyId, type: LedgerType.LOAN_REPAYMENT, direction: LedgerDirection.IN, amount: payment.amount, description: `Pembayaran cicilan ${payment.installment.installmentNumber}`, referenceType: 'PAYMENT', referenceId: payment.id, createdById: payment.payerId } });
    await tx.notification.create({ data: { userId: payment.payerId, familyId: payment.familyId, type: 'PAYMENT_SUCCESS', title: 'Cicilan berhasil dibayar', message: `Cicilan ke-${payment.installment.installmentNumber} telah tercatat lunas.` } });
  });
  return res.json({ success: true, message: 'Pembayaran berhasil diproses' });
});

function zString(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : null; }