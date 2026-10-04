import type { FamilyRole } from '@prisma/client';
import { prisma } from '../../config/prisma';
import type { AuthPayload } from '../../middleware/auth';
import { WorkflowError } from '../approvals/approval.rules';

export async function updateMemberRole(actor: AuthPayload, id: string, role: FamilyRole) {
  const superAdmin = actor.systemRole === 'SUPER_ADMIN';
  if (!superAdmin && actor.familyRole !== 'ADMIN')
    throw new WorkflowError('FORBIDDEN', 'Hanya admin yang dapat mengubah peran anggota.', 403);
  return prisma.$transaction(async (tx) => {
    const initial = await tx.familyMember.findFirst({ where: { id, ...(!superAdmin ? { familyId: actor.familyId } : {}) } });
    if (!initial || (!superAdmin && !actor.familyId))
      throw new WorkflowError('NOT_FOUND', 'Anggota tidak ditemukan.', 404);
    await tx.$queryRaw`SELECT id FROM "Family" WHERE id = ${initial.familyId}::uuid FOR UPDATE`;
    if (!superAdmin) {
      const access = await tx.familyMember.findFirst({ where: { familyId: initial.familyId, userId: actor.sub, role: 'ADMIN', status: 'ACTIVE' } });
      if (!access) throw new WorkflowError('FORBIDDEN', 'Akses admin Anda sudah berubah. Muat ulang halaman.', 403);
    }
    const member = await tx.familyMember.findUniqueOrThrow({ where: { id }, include: { user: true } });
    if (member.user.systemRole === 'SUPER_ADMIN')
      throw new WorkflowError('FORBIDDEN', 'Peran akun Super Admin tidak dapat diubah melalui menu anggota.', 403);
    if (member.role === role) return { id, role };
    if (member.role === 'ADMIN' && member.status === 'ACTIVE' && member.user.isActive) {
      const others = await tx.familyMember.count({ where: { familyId: member.familyId, id: { not: id }, role: 'ADMIN', status: 'ACTIVE', user: { isActive: true } } });
      if (!others) throw new WorkflowError('LAST_ADMIN', 'Keluarga harus memiliki minimal satu Admin aktif. Tetapkan Admin lain terlebih dahulu.', 409);
    }
    await tx.familyMember.update({ where: { id }, data: { role } });
    await tx.auditLog.create({ data: { actorId: actor.sub, familyId: member.familyId, action: 'MEMBER_ROLE_UPDATED', entityType: 'FamilyMember', entityId: id, before: { role: member.role }, after: { role } } });
    return { id, role };
  });
}
