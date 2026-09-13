import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
const mocks = vi.hoisted(() => {
  const db = {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    user: { findUnique: vi.fn() }, familyMember: { findMany: vi.fn() },
    loan: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    loanInstallment: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), aggregate: vi.fn(), findFirst: vi.fn() },
    payment: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    ledgerEntry: { create: vi.fn() }, notification: { create: vi.fn() },
    whatsAppMessage: { createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  };
  return { db };
});
vi.mock('../src/config/prisma', () => ({ prisma: mocks.db }));
import { env } from '../src/config/env';
import { enqueue, queueLoanEvent } from '../src/modules/notifications/notification.service';
import { processMessages, reminderStage, scheduleReminders } from '../src/modules/notifications/notification.worker';
import { settleSandboxPayment } from '../src/modules/payments/payment.service';
const db = mocks.db;
const tx = db as unknown as Prisma.TransactionClient;
const now = new Date('2026-09-12T09:00:00+07:00');
const loan = { id: 'loan', familyId: 'family-a', borrowerId: 'member', principalAmount: new Prisma.Decimal(3000000), tenorMonths: 6, borrower: { name: 'Rani' }, family: { name: 'Keluarga A' }, installments: [{ id: 'installment', principalAmount: new Prisma.Decimal(500000), dueDate: new Date('2026-10-12T09:00:00+07:00') }] };
const payment = { id: 'payment', loanId: 'loan', familyId: 'family-a', payerId: 'member', installmentId: 'installment', provider: 'SANDBOX', status: 'PENDING', amount: new Prisma.Decimal(500000), expiresAt: new Date('2099-01-01'), installment: { status: 'UNPAID', remainingAmount: new Prisma.Decimal(500000), installmentNumber: 1 }, loan: { ...loan, status: 'ACTIVE' } };

beforeEach(() => {
  vi.resetAllMocks();
  env.WHATSAPP_MODE = 'simulation';
  db.$transaction.mockImplementation(async (callback: (client: typeof db) => Promise<unknown>) => callback(db));
  db.user.findUnique.mockResolvedValue({ isActive: true, phone: '6281234567890', whatsappOptInAt: now, memberships: [{ familyId: 'family-a' }] });
  db.loan.findUniqueOrThrow.mockResolvedValue(loan);
  db.familyMember.findMany.mockResolvedValue([{ userId: 'admin-a' }, { userId: 'treasurer-a' }]);
  db.whatsAppMessage.updateMany.mockResolvedValue({ count: 1 });
  db.whatsAppMessage.createMany.mockResolvedValue({ count: 1 });
  db.whatsAppMessage.findMany.mockResolvedValue([]);
  db.loanInstallment.findMany.mockResolvedValue([]);
  db.payment.findUniqueOrThrow.mockImplementation(async () => payment);
  db.payment.update.mockResolvedValue({ ...payment, status: 'SUCCESS' });
  db.loanInstallment.aggregate.mockResolvedValue({ _sum: { remainingAmount: new Prisma.Decimal(2500000) } });
  db.loanInstallment.findFirst.mockResolvedValue({ installmentNumber: 2, remainingAmount: new Prisma.Decimal(500000), dueDate: new Date('2026-11-12T09:00:00+07:00') });
});

describe('event routing and consent', () => {
  it('queues borrower and only active managers of the correct family', async () => {
    await queueLoanEvent(tx, 'loan', 'LOAN_REQUESTED');
    expect(db.familyMember.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ familyId: 'family-a', status: 'ACTIVE', role: { in: ['ADMIN', 'TREASURER'] } }) }));
    expect(db.whatsAppMessage.createMany.mock.calls.map(([args]) => args.data[0].userId)).toEqual(['member', 'admin-a', 'treasurer-a']);
    expect(db.whatsAppMessage.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });
  it('does not retroactively queue messages for people without consent', async () => {
    db.user.findUnique.mockResolvedValue({ whatsappOptInAt: null });
    await enqueue(tx, { eventKey: 'event', userId: 'member', familyId: 'family-a', kind: 'GENERAL', body: 'hello' });
    expect(db.whatsAppMessage.createMany.mock.calls[0][0].data[0].status).toBe('CANCELLED');
  });
  it('does not claim the funds have been disbursed at approval', async () => {
    await queueLoanEvent(tx, 'loan', 'LOAN_APPROVED');
    expect(db.whatsAppMessage.createMany.mock.calls[0][0].data[0].body).toContain('menunggu pencairan');
  });
});

describe('WIB reminder scheduling', () => {
  it('runs H-3 and day H from 09:00 WIB only', () => {
    expect(reminderStage(new Date('2026-09-15T00:00:00+07:00'), now)).toBe('H-3');
    expect(reminderStage(now, now)).toBe('H');
    expect(reminderStage(now, new Date('2026-09-12T08:59:59+07:00'))).toBeNull();
    expect(reminderStage(new Date('2026-09-13T00:00:00+07:00'), now)).toBeNull();
  });
  it('uses a stable event key to deduplicate scheduler runs', async () => {
    db.loanInstallment.findMany.mockResolvedValue([{ id: 'installment', installmentNumber: 1, dueDate: new Date('2026-09-15T00:00:00+07:00'), remainingAmount: new Prisma.Decimal(500000), loan }]);
    await scheduleReminders(now); await scheduleReminders(now);
    const writes = db.whatsAppMessage.createMany.mock.calls.map(([args]) => args.data[0].eventKey);
    expect(writes).toEqual(['INSTALLMENT_DUE:installment:2026-09-15:H-3', 'INSTALLMENT_DUE:installment:2026-09-15:H-3']);
    expect(db.loanInstallment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'OVERDUE' } }));
  });
});

function queued(kind = 'LOAN_APPROVED', attempts = 0) {
  db.whatsAppMessage.findMany.mockResolvedValue([{ id: 'message', kind, userId: 'member', familyId: 'family-a', body: 'message', attempts, installmentId: 'installment', createdAt: now }]);
}

describe('simulation worker', () => {
  it('marks a valid message SIMULATED, never SENT', async () => {
    queued(); await processMessages(now);
    expect(db.whatsAppMessage.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SIMULATED' }) }));
  });
  it('cancels an already-paid reminder before processing', async () => {
    queued('INSTALLMENT_DUE');
    db.loanInstallment.findUnique.mockResolvedValue({ status: 'PAID', loan: { status: 'ACTIVE' } });
    await processMessages(now);
    expect(db.whatsAppMessage.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }));
  });
  it('rechecks consent after enqueue', async () => {
    queued(); db.user.findUnique.mockResolvedValue({ isActive: true, whatsappOptInAt: null, memberships: [{}] });
    await processMessages(now);
    expect(db.whatsAppMessage.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }));
  });
  it('does not process messages claimed by another worker', async () => {
    queued(); db.whatsAppMessage.updateMany.mockResolvedValue({ count: 0 });
    await processMessages(now);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
  it('retries invalid destinations with backoff and stops after three attempts', async () => {
    queued(); db.user.findUnique.mockResolvedValue({ isActive: true, phone: 'invalid', whatsappOptInAt: now, memberships: [{}] });
    await processMessages(now);
    expect(db.whatsAppMessage.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'QUEUED', nextAttemptAt: new Date(now.getTime() + 60000) }) }));
    queued('LOAN_APPROVED', 2); await processMessages(now);
    expect(db.whatsAppMessage.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
  });
  it('does nothing when message processing is disabled', async () => {
    env.WHATSAPP_MODE = 'disabled'; queued(); await processMessages(now);
    expect(db.whatsAppMessage.updateMany).not.toHaveBeenCalled();
  });
});

describe('sandbox settlement', () => {
  it('records payment, ledger and outbox in one transaction and cancels reminders', async () => {
    await settleSandboxPayment('payment');
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.ledgerEntry.create).toHaveBeenCalledTimes(1);
    expect(db.whatsAppMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ installmentId: 'installment', kind: 'INSTALLMENT_DUE' }), data: expect.objectContaining({ status: 'CANCELLED' }) }));
    const message = db.whatsAppMessage.createMany.mock.calls[0][0].data[0];
    expect(message.body).toContain('Rp2.500.000'); expect(message.body).toContain('2026-11-12');
  });
  it('makes repeated settlement of a successful payment a no-op', async () => {
    db.payment.findUniqueOrThrow.mockResolvedValue({ ...payment, status: 'SUCCESS' });
    await settleSandboxPayment('payment');
    expect(db.ledgerEntry.create).not.toHaveBeenCalled();
    expect(db.whatsAppMessage.createMany).not.toHaveBeenCalled();
  });
  it('rejects expired, non-sandbox and mismatched payments without ledger writes', async () => {
    for (const override of [{ expiresAt: new Date('2000-01-01') }, { provider: 'MIDTRANS' }, { amount: new Prisma.Decimal(1) }]) {
      db.payment.findUniqueOrThrow.mockResolvedValue({ ...payment, ...override });
      await expect(settleSandboxPayment('payment')).rejects.toThrow();
    }
    expect(db.ledgerEntry.create).not.toHaveBeenCalled();
  });
  it('closes the loan and creates one final paid-off confirmation', async () => {
    db.loanInstallment.aggregate.mockResolvedValue({ _sum: { remainingAmount: new Prisma.Decimal(0) } });
    await settleSandboxPayment('payment');
    expect(db.loan.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PAID_OFF' }) }));
    expect(db.whatsAppMessage.createMany.mock.calls[0][0].data[0].kind).toBe('LOAN_PAID_OFF');
    expect(db.whatsAppMessage.createMany.mock.calls[0][0].data[0].body).toContain('LUNAS');
  });
});


describe('personal inbox creation', () => {
  it('creates an in-app notice even if WhatsApp consent is absent', async () => {
    db.user.findUnique.mockResolvedValue({ whatsappOptInAt: null });
    await enqueue(tx, { eventKey: 'event', userId: 'member', familyId: 'family-a', kind: 'LOAN_APPROVED', body: 'Disetujui' });
    expect(db.whatsAppMessage.createMany.mock.calls[0][0].data[0].status).toBe('CANCELLED');
    expect(db.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'member', type: 'LOAN_APPROVED', title: 'Pinjaman disetujui' }) }));
  });
  it('does not duplicate inbox notices on repeated events', async () => {
    db.whatsAppMessage.createMany.mockResolvedValue({ count: 0 });
    await enqueue(tx, { eventKey: 'event', userId: 'member', familyId: 'family-a', kind: 'PAYMENT_SUCCESS', body: 'Lunas' });
    expect(db.notification.create).not.toHaveBeenCalled();
  });
});
