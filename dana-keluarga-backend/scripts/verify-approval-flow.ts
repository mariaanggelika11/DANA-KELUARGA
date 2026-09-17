/** Run only against a separately provisioned, disposable approval_test_* schema. */
import assert from 'node:assert/strict';
import { prisma } from '../src/config/prisma';
import { saveFamilyPolicy } from '../src/modules/approvals/approval-policy.service';
import {
  createLoanApproval,
  actOnRequest,
} from '../src/modules/approvals/approval.service';

async function main() {
  const schema = new URL(process.env.DATABASE_URL!).searchParams.get('schema');
  assert.match(
    schema ?? '',
    /^approval_test_[a-f0-9]+$/,
    'Refusing to run fixtures in a non-test schema',
  );
  const people = await Promise.all(
    ['Maker', 'Dani', 'Danang', 'Releaser', 'Super Admin'].map((name, index) =>
      prisma.user.create({
        data: {
          name,
          phone: `62812345000${index}`,
          passwordHash: 'not-a-login-password',
          systemRole: index === 4 ? 'SUPER_ADMIN' : 'USER',
        },
      }),
    ),
  );
  const [maker, dani, danang, releaser, admin] = people;
  const family = await prisma.family.create({
    data: { name: 'Keluarga Pengujian', code: 'TEST', createdById: admin.id },
  });
  const otherFamily = await prisma.family.create({
    data: { name: 'Keluarga Lain', code: 'OTHER', createdById: admin.id },
  });
  await prisma.familyMember.createMany({
    data: people
      .slice(0, 4)
      .map((person) => ({
        userId: person.id,
        familyId: family.id,
        role: 'MEMBER',
      })),
  });
  await prisma.ledgerEntry.create({
    data: {
      familyId: family.id,
      amount: 10000000,
      direction: 'IN',
      type: 'INITIAL_BALANCE',
      createdById: maker.id,
      description: 'Kas fixture',
    },
  });
  const actor = (sub: string) => ({
    sub,
    familyId: family.id,
    systemRole: 'USER',
    familyRole: 'MEMBER',
  });
  const config = {
    expectedVersion: 0,
    makerIds: [maker.id],
    approverIds: [dani.id, danang.id],
    releaserId: releaser.id,
    reason: 'Konfigurasi pengujian',
  };
  const policy = await saveFamilyPolicy(
    { ...actor(admin.id), systemRole: 'SUPER_ADMIN' },
    family.id,
    config,
  );
  const create = () =>
    prisma.$transaction(async (tx) => {
      const loan = await tx.loan.create({
        data: {
          familyId: family.id,
          borrowerId: maker.id,
          principalAmount: 3000000,
          tenorMonths: 6,
          purpose: 'Pinjaman pengujian',
        },
      });
      return createLoanApproval(tx, actor(maker.id), loan);
    });
  const request = await create();
  await assert.rejects(actOnRequest(actor(danang.id), request.id, 'APPROVE'), {
    code: 'NOT_ASSIGNED_AS_APPROVER',
  });
  await assert.rejects(
    actOnRequest(
      { ...actor(dani.id), familyId: otherFamily.id },
      request.id,
      'APPROVE',
    ),
    { code: 'REQUEST_NOT_FOUND' },
  );
  await assert.rejects(
    actOnRequest(
      { ...actor(admin.id), systemRole: 'SUPER_ADMIN' },
      request.id,
      'APPROVE',
    ),
    { code: 'PLATFORM_ROLE_ONLY' },
  );
  await assert.rejects(
    actOnRequest(actor(releaser.id), request.id, 'RELEASE'),
    { code: 'INVALID_WORKFLOW_ACTION' },
  );
  // Editing configuration must never rewrite a running request.
  await saveFamilyPolicy(
    { ...actor(admin.id), systemRole: 'SUPER_ADMIN' },
    family.id,
    { ...config, expectedVersion: 1, approverIds: [danang.id, dani.id] },
  );
  assert.equal(
    (
      await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: request.id },
      })
    ).policyId,
    policy.id,
  );
  // Two simultaneous clicks must create one action, one transition and one notification.
  await Promise.all([
    actOnRequest(actor(dani.id), request.id, 'APPROVE'),
    actOnRequest(actor(dani.id), request.id, 'APPROVE'),
  ]);
  assert.equal(
    await prisma.approvalAction.count({
      where: { requestId: request.id, action: 'APPROVE' },
    }),
    1,
  );
  assert.equal(await prisma.loanInstallment.count(), 0);
  assert.equal(
    await prisma.ledgerEntry.count({ where: { type: 'LOAN_DISBURSEMENT' } }),
    0,
  );
  await actOnRequest(actor(danang.id), request.id, 'APPROVE');
  assert.equal(
    (
      await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: request.id },
      })
    ).status,
    'PENDING_RELEASE',
  );
  await Promise.all([
    actOnRequest(actor(releaser.id), request.id, 'RELEASE'),
    actOnRequest(actor(releaser.id), request.id, 'RELEASE'),
  ]);
  assert.equal(await prisma.loanInstallment.count(), 6);
  assert.equal(
    await prisma.ledgerEntry.count({ where: { type: 'LOAN_DISBURSEMENT' } }),
    1,
  );
  assert.equal(
    await prisma.approvalAction.count({
      where: { requestId: request.id, action: 'RELEASE' },
    }),
    1,
  );
  assert.equal(
    (
      await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: request.id },
      })
    ).status,
    'RELEASED',
  );
  const action = await prisma.approvalAction.findFirstOrThrow({
    where: { requestId: request.id },
  });
  await assert.rejects(
    prisma.approvalAction.update({
      where: { id: action.id },
      data: { notes: 'tamper' },
    }),
  );
  await assert.rejects(
    prisma.approvalAction.delete({ where: { id: action.id } }),
  );
  await assert.rejects(
    prisma.approvalPolicy.create({
      data: {
        familyId: family.id,
        version: 3,
        createdById: admin.id,
        reason: 'Duplicate active',
      },
    }),
  );
  // New applications use v2 and begin with Danang.
  const second = await create();
  assert.equal(
    (
      await prisma.approvalStep.findFirstOrThrow({
        where: { requestId: second.id, sequence: 1 },
      })
    ).assignedUserId,
    danang.id,
  );
  await actOnRequest(
    actor(danang.id),
    second.id,
    'RETURN',
    'Perbaiki pengajuan',
  );
  assert.equal(
    (
      await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: second.id },
      })
    ).status,
    'RETURNED',
  );
  assert.equal(
    await prisma.ledgerEntry.count({ where: { type: 'LOAN_DISBURSEMENT' } }),
    1,
  );
  console.log(
    'PASS: real PostgreSQL flow, tenant isolation, policy snapshots, concurrent approval/release, immutable history, and return.',
  );
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Verification failed',
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
