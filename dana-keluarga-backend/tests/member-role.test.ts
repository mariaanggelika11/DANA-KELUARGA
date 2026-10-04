import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ $transaction: vi.fn(), $queryRaw: vi.fn(), familyMember: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), count: vi.fn(), update: vi.fn() }, auditLog: { create: vi.fn() } }));
vi.mock('../src/config/prisma', () => ({ prisma: db }));
import { updateMemberRole } from '../src/modules/management/member-role.service';
const actor = { sub: 'admin', systemRole: 'USER' as const, familyRole: 'ADMIN' as const, familyId: 'family' };
const member = { id: 'member', familyId: 'family', role: 'MEMBER', status: 'ACTIVE', user: { systemRole: 'USER', isActive: true } };
beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation((run) => run(db));
  db.familyMember.findFirst.mockResolvedValue(member);
  db.familyMember.findUniqueOrThrow.mockResolvedValue(member);
});
it('allows family admin to promote a member and records audit', async () => {
  await expect(updateMemberRole(actor, 'member', 'TREASURER')).resolves.toEqual({ id: 'member', role: 'TREASURER' });
  expect(db.familyMember.findFirst).toHaveBeenNthCalledWith(1, { where: { id: 'member', familyId: 'family' } });
  expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ before: { role: 'MEMBER' }, after: { role: 'TREASURER' } }) }));
});
it('rejects ordinary members and treasurers', async () => {
  for (const role of ['MEMBER', 'TREASURER'] as const) await expect(updateMemberRole({ ...actor, familyRole: role }, 'member', 'ADMIN')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(db.$transaction).not.toHaveBeenCalled();
});
it('rejects a target outside the family', async () => {
  db.familyMember.findFirst.mockResolvedValue(null);
  await expect(updateMemberRole(actor, 'other', 'TREASURER')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(db.familyMember.update).not.toHaveBeenCalled();
});
it('rechecks admin access after acquiring the family lock', async () => {
  db.familyMember.findFirst.mockResolvedValueOnce(member).mockResolvedValueOnce(null);
  await expect(updateMemberRole(actor, 'member', 'TREASURER')).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('protects the last active admin, including from super admin', async () => {
  db.familyMember.findUniqueOrThrow.mockResolvedValue({ ...member, role: 'ADMIN' });
  db.familyMember.count.mockResolvedValue(0);
  await expect(updateMemberRole({ ...actor, systemRole: 'SUPER_ADMIN' }, 'member', 'MEMBER')).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  expect(db.familyMember.update).not.toHaveBeenCalled();
});
it('allows super admin across families and demotion when another admin exists', async () => {
  db.familyMember.findUniqueOrThrow.mockResolvedValue({ ...member, role: 'ADMIN' });
  db.familyMember.count.mockResolvedValue(1);
  await updateMemberRole({ ...actor, systemRole: 'SUPER_ADMIN' }, 'member', 'TREASURER');
  expect(db.familyMember.findFirst).toHaveBeenCalledWith({ where: { id: 'member' } });
  expect(db.familyMember.update).toHaveBeenCalled();
});
it('does not change super admin accounts', async () => {
  db.familyMember.findUniqueOrThrow.mockResolvedValue({ ...member, user: { isActive: true, systemRole: 'SUPER_ADMIN' } });
  await expect(updateMemberRole(actor, 'member', 'MEMBER')).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('does not write or audit an unchanged role', async () => {
  await updateMemberRole(actor, 'member', 'MEMBER');
  expect(db.familyMember.update).not.toHaveBeenCalled();
  expect(db.auditLog.create).not.toHaveBeenCalled();
});
