import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
const mocks = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    approvalPolicy: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    approvalRequest: {
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    approvalStep: { update: vi.fn() },
    approvalAction: { findFirst: vi.fn(), create: vi.fn() },
    familyMember: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    loan: { update: vi.fn() },
    loanInstallment: { createMany: vi.fn() },
    ledgerEntry: { groupBy: vi.fn(), create: vi.fn() },
    notification: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  queue: vi.fn(),
}));
vi.mock('../src/config/prisma', () => ({ prisma: mocks.db }));
vi.mock('../src/modules/notifications/notification.service', () => ({
  queueLoanEvent: mocks.queue,
}));
import {
  actOnRequest,
  createLoanApproval,
} from '../src/modules/approvals/approval.service';
import { saveFamilyPolicy } from '../src/modules/approvals/approval-policy.service';
import {
  policySchema,
  assertAssignedActor,
  requireOperationalActor,
} from '../src/modules/approvals/approval.rules';

const db = mocks.db;
const tx = db as unknown as Prisma.TransactionClient;
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const familyId = uid(1),
  makerId = uid(2),
  dani = uid(3),
  danang = uid(4),
  releaser = uid(5),
  requestId = uid(6);
const actor = (sub = dani) => ({
  sub,
  familyId,
  systemRole: 'USER',
  familyRole: 'MEMBER',
});
const input = {
  expectedVersion: 0,
  makerIds: [makerId],
  approverIds: [dani, danang],
  releaserId: releaser,
  reason: 'Kesepakatan keluarga',
};
const loan = {
  id: uid(7),
  familyId,
  borrowerId: makerId,
  principalAmount: new Prisma.Decimal(3000000),
  status: 'PENDING',
  tenorMonths: 6,
};
const assignments = [
  { permission: 'MAKER', userId: makerId, sequence: 1 },
  { permission: 'APPROVER', userId: dani, sequence: 1 },
  { permission: 'APPROVER', userId: danang, sequence: 2 },
  { permission: 'RELEASER', userId: releaser, sequence: 3 },
];
function snapshot(stage = 1) {
  return {
    id: requestId,
    familyId,
    policyId: uid(8),
    makerId,
    amount: loan.principalAmount,
    currentStep: stage,
    status: stage === 3 ? 'PENDING_RELEASE' : 'PENDING_APPROVAL',
    loan: { ...loan, status: stage === 3 ? 'APPROVED' : 'PENDING' },
    steps: assignments
      .slice(1)
      .map((item) => ({
        id: uid(10 + item.sequence),
        requestId,
        sequence: item.sequence,
        assignedUserId: item.userId,
        permission: item.permission,
        status: item.sequence < stage ? 'APPROVED' : 'WAITING',
      })),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation((callback) => callback(db));
  db.$queryRaw.mockResolvedValue([{ id: requestId }]);
  db.approvalPolicy.findFirst.mockResolvedValue({
    id: uid(8),
    version: 1,
    assignments,
  });
  db.approvalPolicy.create.mockResolvedValue({ id: uid(8), version: 1 });
  db.approvalRequest.create.mockResolvedValue({ id: requestId });
  db.approvalRequest.findUniqueOrThrow.mockResolvedValue(snapshot());
  db.familyMember.count.mockResolvedValue(3);
  db.familyMember.findUnique.mockResolvedValue({
    status: 'ACTIVE',
    role: 'ADMIN',
    user: { isActive: true, systemRole: 'USER' },
  });
  db.familyMember.findMany.mockResolvedValue(
    [makerId, dani, danang, releaser].map((userId) => ({ userId })),
  );
  db.ledgerEntry.groupBy.mockResolvedValue([
    { direction: 'IN', _sum: { amount: new Prisma.Decimal(4000000) } },
  ]);
});

describe('policy validation and authorization', () => {
  it('accepts Dani then Danang with an independent releaser', () =>
    expect(policySchema.parse(input).approverIds).toEqual([dani, danang]));
  it.each([
    { approverIds: [] },
    { approverIds: [dani, dani] },
    { releaserId: dani },
    { makerIds: [] },
    { reason: ' ' },
    { expectedVersion: -1 },
  ])('rejects invalid configuration %j', (override) =>
    expect(policySchema.safeParse({ ...input, ...override }).success).toBe(
      false,
    ),
  );
  it('rejects cross-family admin configuration', async () => {
    await expect(
      saveFamilyPolicy(actor(), uid(90), input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects actors absent from the active family', async () => {
    db.approvalPolicy.findFirst.mockResolvedValue(null);
    db.familyMember.findMany.mockResolvedValue([{ userId: makerId }]);
    await expect(
      saveFamilyPolicy(
        { ...actor(), systemRole: 'SUPER_ADMIN' },
        familyId,
        input,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ASSIGNMENT' });
    expect(db.approvalPolicy.create).not.toHaveBeenCalled();
  });
  it('rejects a stale editor version before replacing the policy', async () => {
    await expect(
      saveFamilyPolicy(
        { ...actor(), systemRole: 'SUPER_ADMIN' },
        familyId,
        input,
      ),
    ).rejects.toMatchObject({ code: 'POLICY_VERSION_CONFLICT' });
    expect(db.approvalPolicy.update).not.toHaveBeenCalled();
  });
  it('creates a new audited version without editing existing request snapshots', async () => {
    await saveFamilyPolicy(
      { ...actor(), systemRole: 'SUPER_ADMIN' },
      familyId,
      { ...input, expectedVersion: 1 },
    );
    expect(db.approvalPolicy.update).toHaveBeenCalledWith({
      where: { id: uid(8) },
      data: { active: false },
    });
    expect(db.approvalPolicy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 2,
          assignments: { create: assignments },
        }),
      }),
    );
    expect(db.approvalRequest.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('never gives Super Admin financial bypass', () => {
    expect(() =>
      requireOperationalActor(
        { ...actor(), systemRole: 'SUPER_ADMIN' },
        familyId,
      ),
    ).toThrow('Super Admin');
  });
});

describe('submission snapshots', () => {
  it('snapshots ordered actors and notifies only the first approver', async () => {
    await createLoanApproval(tx, actor(makerId), loan);
    const data = db.approvalRequest.create.mock.calls[0][0].data;
    expect(
      data.steps.create.map(
        (item: { assignedUserId: string }) => item.assignedUserId,
      ),
    ).toEqual([dani, danang, releaser]);
    expect(data.actions.create).toMatchObject({
      actorId: makerId,
      action: 'SUBMIT',
    });
    expect(
      db.notification.create.mock.calls.map(([args]) => args.data.userId),
    ).toEqual([dani]);
    expect(mocks.queue).toHaveBeenCalledWith(
      tx,
      loan.id,
      'LOAN_REQUESTED',
      false,
    );
  });
  it('rejects makers not assigned in the policy', async () => {
    await expect(
      createLoanApproval(tx, actor(uid(90)), loan),
    ).rejects.toMatchObject({ code: 'NOT_ASSIGNED_AS_MAKER' });
  });
  it('rejects a borrower appearing as an approver', async () => {
    await expect(
      createLoanApproval(tx, actor(makerId), { ...loan, borrowerId: dani }),
    ).rejects.toMatchObject({ code: 'SELF_APPROVAL_NOT_ALLOWED' });
  });
  it('rejects inactive actors before creating a snapshot', async () => {
    db.familyMember.count.mockResolvedValue(2);
    await expect(
      createLoanApproval(tx, actor(makerId), loan),
    ).rejects.toMatchObject({ code: 'INACTIVE_WORKFLOW_ACTOR' });
    expect(db.approvalRequest.create).not.toHaveBeenCalled();
  });
  it('rejects malformed policies without a releaser', async () => {
    db.approvalPolicy.findFirst.mockResolvedValue({
      id: uid(8),
      assignments: assignments.slice(0, 3),
    });
    await expect(
      createLoanApproval(tx, actor(makerId), loan),
    ).rejects.toMatchObject({ code: 'WORKFLOW_INVALID' });
  });
});

describe('sequential approval and disbursement', () => {
  it('cannot skip Dani and approve as Danang', async () => {
    await expect(
      actOnRequest(actor(danang), requestId, 'APPROVE'),
    ).rejects.toMatchObject({ code: 'NOT_ASSIGNED_AS_APPROVER' });
    expect(db.approvalStep.update).not.toHaveBeenCalled();
  });
  it('advances Dani to Danang without changing the loan to approved or posting money', async () => {
    await actOnRequest(actor(dani), requestId, 'APPROVE');
    expect(db.approvalRequest.update).toHaveBeenCalledWith({
      where: { id: requestId },
      data: { currentStep: 2, status: 'PENDING_APPROVAL' },
    });
    expect(db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: danang }),
      }),
    );
    expect(db.loan.update).not.toHaveBeenCalled();
    expect(db.ledgerEntry.create).not.toHaveBeenCalled();
    expect(db.loanInstallment.createMany).not.toHaveBeenCalled();
  });
  it('final approval waits for an independent releaser', async () => {
    db.approvalRequest.findUniqueOrThrow.mockResolvedValue(snapshot(2));
    await actOnRequest(actor(danang), requestId, 'APPROVE');
    expect(db.loan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'APPROVED' }),
      }),
    );
    expect(db.approvalRequest.update).toHaveBeenCalledWith({
      where: { id: requestId },
      data: { currentStep: 3, status: 'PENDING_RELEASE' },
    });
    expect(db.ledgerEntry.create).not.toHaveBeenCalled();
    expect(db.loanInstallment.createMany).not.toHaveBeenCalled();
  });
  it('prevents releasing before all approvals', async () => {
    await expect(
      actOnRequest(actor(releaser), requestId, 'RELEASE'),
    ).rejects.toMatchObject({ code: 'INVALID_WORKFLOW_ACTION' });
  });
  it('posts exactly one ledger entry and six installments when the releaser acts', async () => {
    db.approvalRequest.findUniqueOrThrow.mockResolvedValue(snapshot(3));
    await actOnRequest(actor(releaser), requestId, 'RELEASE');
    expect(db.ledgerEntry.create).toHaveBeenCalledTimes(1);
    expect(db.loanInstallment.createMany.mock.calls[0][0].data).toHaveLength(6);
    expect(db.approvalAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'RELEASE', actorId: releaser }),
      }),
    );
    expect(mocks.queue).toHaveBeenCalledWith(tx, loan.id, 'LOAN_DISBURSED');
  });
  it('rejects insufficient cash without posting a disbursement', async () => {
    db.approvalRequest.findUniqueOrThrow.mockResolvedValue(snapshot(3));
    db.ledgerEntry.groupBy.mockResolvedValue([]);
    await expect(
      actOnRequest(actor(releaser), requestId, 'RELEASE'),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FAMILY_CASH' });
    expect(db.ledgerEntry.create).not.toHaveBeenCalled();
    expect(db.loan.update).not.toHaveBeenCalled();
  });
  it.each(['APPROVE', 'RELEASE'] as const)(
    'repeated %s is idempotent',
    async (action) => {
      db.approvalAction.findFirst.mockResolvedValue({ id: uid(100) });
      await actOnRequest(
        actor(action === 'RELEASE' ? releaser : dani),
        requestId,
        action,
      );
      expect(db.approvalAction.create).not.toHaveBeenCalled();
      expect(db.loanInstallment.createMany).not.toHaveBeenCalled();
      expect(db.ledgerEntry.create).not.toHaveBeenCalled();
    },
  );
  it('does not reveal cross-family request data', async () => {
    db.$queryRaw.mockResolvedValue([]);
    await expect(
      actOnRequest(actor(), requestId, 'APPROVE'),
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_FOUND' });
    expect(db.approvalRequest.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it('rejects an actor whose membership is no longer active', async () => {
    db.familyMember.findUnique.mockResolvedValue({ status: 'INACTIVE' });
    await expect(
      actOnRequest(actor(), requestId, 'APPROVE'),
    ).rejects.toMatchObject({ code: 'NOT_ACTIVE_MEMBER' });
  });
  it('detects changed loan amounts', async () => {
    const data = snapshot();
    data.loan.principalAmount = new Prisma.Decimal(4000000);
    db.approvalRequest.findUniqueOrThrow.mockResolvedValue(data);
    await expect(
      actOnRequest(actor(), requestId, 'APPROVE'),
    ).rejects.toMatchObject({ code: 'REQUEST_DATA_CHANGED' });
  });
  it.each(['REJECT', 'RETURN'] as const)(
    'requires notes for %s',
    async (action) => {
      await expect(
        actOnRequest(actor(), requestId, action),
      ).rejects.toMatchObject({ code: 'NOTE_REQUIRED' });
      expect(db.approvalAction.create).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['REJECT', 'REJECTED'],
    ['RETURN', 'CANCELLED'],
  ] as const)(
    'records %s with its reason and closes the loan as %s',
    async (action, status) => {
      await actOnRequest(actor(), requestId, action, 'Mohon perbaiki nominal');
      expect(db.loan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status,
            rejectionReason: 'Mohon perbaiki nominal',
          }),
        }),
      );
      expect(db.approvalAction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action,
            notes: 'Mohon perbaiki nominal',
          }),
        }),
      );
      expect(db.ledgerEntry.create).not.toHaveBeenCalled();
    },
  );
  it('blocks makers approving and approvers releasing even with tampered assignments', () => {
    expect(() =>
      assertAssignedActor(makerId, makerId, makerId, 'APPROVER', []),
    ).toThrow();
    expect(() =>
      assertAssignedActor(dani, makerId, dani, 'RELEASER', [dani]),
    ).toThrow();
  });
});
