import crypto from 'node:crypto';
import { Router } from 'express';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { requireAuth, requireRole, type AuthRequest } from '../../middleware/auth';
import { settleSandboxPayment } from './payment.service';

export const paymentRouter = Router();
const canManage = (req: AuthRequest) => req.auth?.systemRole === 'SUPER_ADMIN' || ['ADMIN', 'TREASURER'].includes(req.auth?.familyRole ?? '');
const scope = (req: AuthRequest) => req.auth!.systemRole === 'SUPER_ADMIN' ? {} : { familyId: req.auth!.familyId ?? '00000000-0000-0000-0000-000000000000', ...(canManage(req) ? {} : { borrowerId: req.auth!.sub }) };
const simulationAvailable = () => env.NODE_ENV !== 'production' && env.PAYMENT_PROVIDER === 'sandbox';

// No unauthenticated callback may mark a payment as paid in this simulation release.
paymentRouter.post('/webhooks/:provider', (_req, res) => res.status(503).json({ success: false, error: { code: 'PROVIDER_NOT_CONFIGURED', message: 'Integrasi dan verifikasi callback payment gateway belum diaktifkan' } }));
paymentRouter.use(requireAuth);

paymentRouter.get('/installments/:id', async (req: AuthRequest, res) => {
  const installment = await prisma.loanInstallment.findFirst({ where: { id: String(req.params.id), loan: scope(req) }, include: { loan: { select: { id: true, purpose: true, status: true, borrower: { select: { name: true } } } }, payments: { orderBy: { createdAt: 'desc' }, select: { id: true, amount: true, status: true, provider: true, expiresAt: true, paidAt: true, createdAt: true } } } });
  if (!installment) return res.status(404).json({ error: { message: 'Cicilan tidak ditemukan atau tidak dapat diakses' } });
  // Expiry is derived on reads; create/settlement also enforce it in the database.
  const payments = installment.payments.map((payment) => ({ ...payment, status: payment.status === 'PENDING' && payment.expiresAt && payment.expiresAt <= new Date() ? 'EXPIRED' : payment.status }));
  res.json({ success: true, data: { ...installment, payments, simulationAvailable: simulationAvailable(), canSimulate: simulationAvailable() && canManage(req) } });
});

paymentRouter.post('/loans/:loanId/installments/:installmentId', async (req: AuthRequest, res) => {
  if (!simulationAvailable()) return res.status(503).json({ error: { message: 'Pembayaran nyata belum tersedia. Simulasi hanya tersedia di lingkungan pengembangan dengan provider sandbox.' } });
  const loanId = String(req.params.loanId);
  const installmentId = String(req.params.installmentId);
  const item = await prisma.loanInstallment.findFirst({ where: { id: installmentId, loanId, loan: scope(req) } });
  if (!item) return res.status(404).json({ error: { message: 'Cicilan tidak ditemukan' } });
  const payment = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Loan" WHERE id = ${loanId}::uuid FOR UPDATE`;
    const installment = await tx.loanInstallment.findUniqueOrThrow({ where: { id: installmentId }, include: { loan: true } });
    if (installment.loan.status !== 'ACTIVE' || installment.status === 'PAID' || installment.remainingAmount.lte(0)) throw new Error('PAYMENT_CONFLICT');
    await tx.payment.updateMany({ where: { installmentId, status: 'PENDING', expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED' } });
    const existing = await tx.payment.findFirst({ where: { installmentId, status: 'PENDING' } });
    if (existing) return existing;
    return tx.payment.create({ data: { familyId: installment.loan.familyId, loanId, installmentId, payerId: installment.loan.borrowerId, amount: installment.remainingAmount, provider: 'SANDBOX', externalId: `sandbox-${crypto.randomUUID()}`, expiresAt: new Date(Date.now() + 30 * 60000) } });
  });
  res.json({ success: true, data: payment, message: 'Pembayaran simulasi dibuat. Tidak ada QRIS atau uang nyata.' });
});

paymentRouter.post('/:id/simulate-success', requireRole('ADMIN', 'TREASURER'), async (req: AuthRequest, res) => {
  if (!simulationAvailable()) return res.status(404).json({ error: { message: 'Simulasi pembayaran tidak tersedia' } });
  const payment = await prisma.payment.findFirst({ where: { id: String(req.params.id), loan: scope(req), provider: 'SANDBOX' } });
  if (!payment) return res.status(404).json({ error: { message: 'Pembayaran tidak ditemukan' } });
  const result = await settleSandboxPayment(payment.id);
  res.json({ success: true, data: result, message: 'Pembayaran simulasi berhasil dicatat' });
});
