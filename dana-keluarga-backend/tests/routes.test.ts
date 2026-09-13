import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
const mocks = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    loanInstallment: { findFirst: vi.fn(), createMany: vi.fn() }, payment: { findFirst: vi.fn() },
    whatsAppMessage: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() },
    notification: { create: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    family: { findUnique: vi.fn() }, familyMember: { findFirst: vi.fn(), findMany: vi.fn() },
    loan: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    ledgerEntry: { groupBy: vi.fn(), create: vi.fn() },
  }, settle: vi.fn(),
}));
vi.mock('../src/config/prisma', () => ({ prisma: mocks.db }));
vi.mock('../src/modules/payments/payment.service', () => ({ settleSandboxPayment: mocks.settle }));
import { app } from '../src/app';
import { env } from '../src/config/env';
const userId = '00000000-0000-4000-8000-000000000001';
const familyId = '00000000-0000-4000-8000-000000000002';
const installmentId = '00000000-0000-4000-8000-000000000003';
let server: Server;
let base: string;
let role = 'MEMBER';
let memberships = true;
let active = true;
const token = () => jwt.sign({ sub: userId, familyId, familyRole: 'ADMIN', systemRole: 'SUPER_ADMIN' }, env.JWT_ACCESS_SECRET, { expiresIn: '1h' });
async function request(path: string, method = 'GET', body?: unknown, authenticated = true) {
  return fetch(`${base}/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${token()}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
beforeAll(async () => {
  server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.on('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server unavailable');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { if (server) await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => {
  vi.resetAllMocks(); role = 'MEMBER'; memberships = true; active = true;
  env.NODE_ENV = 'test'; env.PAYMENT_PROVIDER = 'sandbox';
  mocks.db.user.findUnique.mockImplementation(async () => ({ id: userId, isActive: active, systemRole: 'USER', memberships: memberships ? [{ familyId, role }] : [] }));
  mocks.db.$transaction.mockImplementation(async (input) => typeof input === 'function' ? input(mocks.db) : Promise.all(input));
  mocks.db.whatsAppMessage.createMany.mockResolvedValue({ count: 1 });
  mocks.db.notification.findMany.mockResolvedValue([]);
  mocks.db.notification.count.mockResolvedValue(2);
  mocks.db.notification.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.whatsAppMessage.findMany.mockResolvedValue([]); mocks.db.whatsAppMessage.count.mockResolvedValue(0);
});

describe('HTTP authorization and simulation boundaries', () => {
  it('requires login to open an installment link', async () => {
    expect((await request(`/payments/installments/${installmentId}`, 'GET', undefined, false)).status).toBe(401);
    expect(mocks.db.loanInstallment.findFirst).not.toHaveBeenCalled();
  });
  it('limits members to their own installments even with stale admin claims', async () => {
    mocks.db.loanInstallment.findFirst.mockResolvedValue(null);
    expect((await request(`/payments/installments/${installmentId}`)).status).toBe(404);
    expect(mocks.db.loanInstallment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: installmentId, loan: { familyId, borrowerId: userId } } }));
  });
  it('limits family administrators to their family', async () => {
    role = 'ADMIN'; mocks.db.loanInstallment.findFirst.mockResolvedValue(null);
    await request(`/payments/installments/${installmentId}`);
    expect(mocks.db.loanInstallment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: installmentId, loan: { familyId } } }));
  });
  it('rejects inactive accounts', async () => {
    active = false;
    expect((await request('/notifications')).status).toBe(401);
  });
  it('rejects loan access after membership is removed', async () => {
    memberships = false;
    expect((await request('/loans')).status).toBe(403);
  });
  it('does not allow a member to simulate successful payment', async () => {
    expect((await request(`/payments/${installmentId}/simulate-success`, 'POST')).status).toBe(403);
    expect(mocks.settle).not.toHaveBeenCalled();
  });
  it('disables simulated settlements and payment creation in production', async () => {
    role = 'ADMIN'; env.NODE_ENV = 'production';
    expect((await request(`/payments/${installmentId}/simulate-success`, 'POST')).status).toBe(404);
    expect((await request(`/payments/loans/${familyId}/installments/${installmentId}`, 'POST')).status).toBe(503);
    expect(mocks.settle).not.toHaveBeenCalled();
  });
  it('does not produce fake Midtrans payments', async () => {
    env.PAYMENT_PROVIDER = 'midtrans';
    expect((await request(`/payments/loans/${familyId}/installments/${installmentId}`, 'POST')).status).toBe(503);
  });
  it('blocks the old unsigned public webhook', async () => {
    expect((await request('/payments/webhooks/sandbox', 'POST', { externalId: 'anything', status: 'SUCCESS' }, false)).status).toBe(503);
    expect(mocks.settle).not.toHaveBeenCalled();
  });
  it('scopes notification previews to the member or managing family', async () => {
    await request('/notifications');
    expect(mocks.db.whatsAppMessage.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { userId } }));
    role = 'ADMIN'; await request('/notifications');
    expect(mocks.db.whatsAppMessage.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { familyId } }));
  });
  it('updates only the current user preference and cancels queued messages on opt-out', async () => {
    mocks.db.user.update.mockResolvedValue({ phone: '6281234567890', whatsappOptInAt: null });
    const response = await request('/notifications/preferences', 'PATCH', { enabled: false, userId: 'other-user' });
    expect(response.status).toBe(200);
    expect(mocks.db.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: userId }, data: { whatsappOptInAt: null } }));
    expect(mocks.db.whatsAppMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId }), data: expect.objectContaining({ status: 'CANCELLED' }) }));
  });
  it('returns expired intents as expired when opening a stale link', async () => {
    mocks.db.loanInstallment.findFirst.mockResolvedValue({ id: installmentId, status: 'UNPAID', payments: [{ id: 'payment', status: 'PENDING', expiresAt: new Date('2000-01-01') }] });
    const response = await request(`/payments/installments/${installmentId}`);
    expect((await response.json()).data.payments[0].status).toBe('EXPIRED');
  });
});


describe('loan journey through HTTP routes', () => {
  const loanId = '00000000-0000-4000-8000-000000000004';
  const fixture = { id: loanId, familyId, borrowerId: userId, principalAmount: new Prisma.Decimal(3000000), tenorMonths: 6, purpose: 'Renovasi rumah', borrower: { id: userId, name: 'Rani', phone: '6281234567890' }, family: { name: 'Keluarga A' }, installments: [{ id: installmentId, principalAmount: new Prisma.Decimal(500000), dueDate: new Date('2026-10-12T09:00:00+07:00') }] };
  beforeEach(() => {
    mocks.db.family.findUnique.mockResolvedValue({ id: familyId });
    mocks.db.familyMember.findFirst.mockResolvedValue({ id: userId, userId });
    mocks.db.familyMember.findMany.mockResolvedValue([]);
    mocks.db.loan.findUniqueOrThrow.mockResolvedValue(fixture);
    mocks.db.loan.create.mockResolvedValue({ ...fixture, status: 'PENDING' });
    mocks.db.loan.update.mockResolvedValue(fixture);
    mocks.db.loan.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.ledgerEntry.groupBy.mockResolvedValue([{ direction: 'IN', _sum: { amount: new Prisma.Decimal(5000000) } }]);
  });
  it('creates an application and its outbox in one transaction without requesting password fields', async () => {
    mocks.db.loan.findFirst.mockResolvedValue(null);
    const response = await request('/loans', 'POST', { amount: 3000000, tenorMonths: 6, purpose: 'Renovasi rumah' });
    expect(response.status).toBe(201);
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.db.loan.create).toHaveBeenCalledWith(expect.objectContaining({ include: { borrower: { select: { id: true, name: true, phone: true } } } }));
    expect(mocks.db.whatsAppMessage.createMany).toHaveBeenCalled();
  });
  it('rejects a second application after acquiring the member lock', async () => {
    mocks.db.loan.findFirst.mockResolvedValue({ id: loanId });
    const response = await request('/loans', 'POST', { amount: 3000000, tenorMonths: 6, purpose: 'Renovasi rumah' });
    expect(response.status).toBe(409);
    expect(mocks.db.$queryRaw).toHaveBeenCalled();
    expect(mocks.db.loan.create).not.toHaveBeenCalled();
  });
  it('queues approval while leaving installment creation until disbursement', async () => {
    role = 'ADMIN'; mocks.db.loan.findFirst.mockResolvedValue({ ...fixture, status: 'PENDING' });
    const response = await request(`/loans/${loanId}/approve`, 'POST');
    expect(response.status).toBe(200);
    expect((await response.json()).message).toContain('menunggu pencairan');
    expect(mocks.db.loanInstallment.createMany).not.toHaveBeenCalled();
    expect(mocks.db.whatsAppMessage.createMany.mock.calls[0][0].data[0].kind).toBe('LOAN_APPROVED');
  });
  it('queues a rejection in the same transaction as the decision', async () => {
    role = 'ADMIN'; mocks.db.loan.findUniqueOrThrow.mockResolvedValue({ ...fixture, rejectionReason: 'Saldo belum cukup' });
    const response = await request(`/loans/${loanId}/reject`, 'POST', { reason: 'Saldo belum cukup' });
    expect(response.status).toBe(200);
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.db.whatsAppMessage.createMany.mock.calls[0][0].data[0].body).toContain('Saldo belum cukup');
  });
  it('creates six installments and one ledger entry only at disbursement', async () => {
    role = 'TREASURER'; mocks.db.loan.findFirst.mockResolvedValue({ ...fixture, status: 'APPROVED' });
    const response = await request(`/loans/${loanId}/disburse`, 'POST');
    expect(response.status).toBe(200);
    expect(mocks.db.loanInstallment.createMany.mock.calls[0][0].data).toHaveLength(6);
    expect(mocks.db.ledgerEntry.create).toHaveBeenCalledTimes(1);
    expect(mocks.db.whatsAppMessage.createMany.mock.calls[0][0].data[0].kind).toBe('LOAN_DISBURSED');
  });
  it('does not disburse when the locked balance is insufficient', async () => {
    role = 'ADMIN'; mocks.db.loan.findFirst.mockResolvedValue({ ...fixture, status: 'APPROVED' });
    mocks.db.ledgerEntry.groupBy.mockResolvedValue([]);
    expect((await request(`/loans/${loanId}/disburse`, 'POST')).status).toBe(409);
    expect(mocks.db.ledgerEntry.create).not.toHaveBeenCalled();
    expect(mocks.db.whatsAppMessage.createMany).not.toHaveBeenCalled();
  });
});


describe('personal notification inbox API', () => {
  it('limits inbox and unread count to the current account, including admins', async () => {
    role = 'ADMIN';
    const response = await request('/notifications/inbox?unread=true&page=2');
    expect(response.status).toBe(200);
    expect(mocks.db.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId, isRead: false }, skip: 20, take: 20 }));
    expect((await response.json()).data.unreadCount).toBe(2);
    await request('/notifications/inbox/unread-count');
    expect(mocks.db.notification.count).toHaveBeenLastCalledWith({ where: { userId, isRead: false } });
  });
  it('marks only the current account notifications as read', async () => {
    expect((await request('/notifications/inbox/read-all', 'PATCH')).status).toBe(200);
    expect(mocks.db.notification.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { userId, isRead: false }, data: expect.objectContaining({ isRead: true }) }));
    expect((await request(`/notifications/inbox/${installmentId}/read`, 'PATCH')).status).toBe(200);
    expect(mocks.db.notification.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: installmentId, userId } }));
  });
  it('does not permit marking another account notification as read', async () => {
    mocks.db.notification.updateMany.mockResolvedValue({ count: 0 });
    expect((await request(`/notifications/inbox/${installmentId}/read`, 'PATCH')).status).toBe(404);
  });
  it('rejects malformed filters and notification IDs', async () => {
    expect((await request('/notifications/inbox?page=-1')).status).toBe(400);
    expect((await request('/notifications/inbox?unread=maybe')).status).toBe(400);
    expect((await request('/notifications/inbox/not-an-id/read', 'PATCH')).status).toBe(400);
    expect(mocks.db.notification.updateMany).not.toHaveBeenCalled();
  });
});
