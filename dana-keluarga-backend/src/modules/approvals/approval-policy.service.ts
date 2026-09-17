import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import {
  WorkflowError,
  type PolicyInput,
  type WorkflowActor,
} from './approval.rules';

export const publicPerson = { id: true, name: true, email: true } as const;
export const policyInclude = {
  assignments: {
    orderBy: [{ permission: 'asc' as const }, { sequence: 'asc' as const }],
    include: { user: { select: publicPerson } },
  },
};

export async function requirePolicyAccess(
  actor: WorkflowActor,
  familyId: string,
) {
  if (actor.systemRole === 'SUPER_ADMIN') return;
  if (actor.familyId !== familyId)
    throw new WorkflowError(
      'FORBIDDEN',
      'Anda tidak dapat mengatur hirarki keluarga lain.',
      403,
    );
  const member = await prisma.familyMember.findUnique({
    where: { familyId_userId: { familyId, userId: actor.sub } },
  });
  if (member?.status !== 'ACTIVE' || member.role !== 'ADMIN')
    throw new WorkflowError(
      'FORBIDDEN',
      'Setup hirarki hanya untuk Super Admin atau Admin keluarga terkait.',
      403,
    );
}

export async function getFamilyPolicy(actor: WorkflowActor, familyId: string) {
  await requirePolicyAccess(actor, familyId);
  const family = await prisma.family.findUnique({
    where: { id: familyId },
    select: { id: true, name: true, code: true },
  });
  if (!family)
    throw new WorkflowError(
      'FAMILY_NOT_FOUND',
      'Keluarga tidak ditemukan.',
      404,
    );
  const [policy, members, history] = await Promise.all([
    prisma.approvalPolicy.findFirst({
      where: { familyId, transactionType: 'LOAN', active: true },
      include: policyInclude,
    }),
    prisma.familyMember.findMany({
      where: {
        familyId,
        status: 'ACTIVE',
        user: { isActive: true, systemRole: 'USER' },
      },
      select: { role: true, user: { select: publicPerson } },
      orderBy: { user: { name: 'asc' } },
    }),
    prisma.approvalPolicy.findMany({
      where: { familyId, transactionType: 'LOAN' },
      orderBy: { version: 'desc' },
      take: 20,
      select: {
        id: true,
        version: true,
        active: true,
        reason: true,
        createdAt: true,
        assignments: policyInclude.assignments,
      },
    }),
  ]);
  return { family, policy, members, history };
}

export async function saveFamilyPolicy(
  actor: WorkflowActor,
  familyId: string,
  input: PolicyInput,
) {
  await requirePolicyAccess(actor, familyId);
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "Family" WHERE id = ${familyId}::uuid FOR UPDATE`;
    if (!locked.length)
      throw new WorkflowError(
        'FAMILY_NOT_FOUND',
        'Keluarga tidak ditemukan.',
        404,
      );
    const existing = await tx.approvalPolicy.findFirst({
      where: { familyId, transactionType: 'LOAN', active: true },
    });
    if ((existing?.version ?? 0) !== input.expectedVersion)
      throw new WorkflowError(
        'POLICY_VERSION_CONFLICT',
        'Hirarki telah diperbarui pengguna lain. Muat ulang sebelum menyimpan.',
      );
    const ids = [
      ...new Set([...input.makerIds, ...input.approverIds, input.releaserId]),
    ];
    const members = await tx.familyMember.findMany({
      where: {
        familyId,
        userId: { in: ids },
        status: 'ACTIVE',
        user: { isActive: true, systemRole: 'USER' },
      },
      select: { userId: true },
    });
    if (members.length !== ids.length)
      throw new WorkflowError(
        'INVALID_ASSIGNMENT',
        'Semua petugas harus merupakan anggota aktif keluarga ini, bukan Super Admin.',
        400,
      );
    if (existing)
      await tx.approvalPolicy.update({
        where: { id: existing.id },
        data: { active: false },
      });
    const policy = await tx.approvalPolicy.create({
      data: {
        familyId,
        version: (existing?.version ?? 0) + 1,
        createdById: actor.sub,
        reason: input.reason,
        assignments: {
          create: [
            ...input.makerIds.map((userId, index) => ({
              userId,
              permission: 'MAKER' as const,
              sequence: index + 1,
            })),
            ...input.approverIds.map((userId, index) => ({
              userId,
              permission: 'APPROVER' as const,
              sequence: index + 1,
            })),
            {
              userId: input.releaserId,
              permission: 'RELEASER' as const,
              sequence: input.approverIds.length + 1,
            },
          ],
        },
      },
      include: policyInclude,
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        familyId,
        action: 'APPROVAL_POLICY_CHANGED',
        entityType: 'ApprovalPolicy',
        entityId: policy.id,
        before: existing
          ? { id: existing.id, version: existing.version }
          : Prisma.JsonNull,
        after: { version: policy.version, ...input } as Prisma.InputJsonValue,
      },
    });
    return policy;
  });
}
