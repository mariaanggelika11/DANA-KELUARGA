import argon2 from 'argon2';
import { PrismaClient, FamilyRole, LedgerDirection, LedgerType, SystemRole } from '@prisma/client';

const prisma = new PrismaClient();
async function main() {
  const name = process.env.SEED_SUPER_ADMIN_NAME ?? process.env.SEED_ADMIN_NAME;
  const email = process.env.SEED_SUPER_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL;
  const phone = process.env.SEED_SUPER_ADMIN_PHONE ?? process.env.SEED_ADMIN_PHONE;
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;
  if (!name || !email || !phone || !password) throw new Error('SEED_SUPER_ADMIN_* environment variables are required');
  const passwordHash = await argon2.hash(password);
  const existingAdmin = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
  const admin = existingAdmin
    ? await prisma.user.update({ where: { id: existingAdmin.id }, data: { name, email, phone, passwordHash, systemRole: SystemRole.SUPER_ADMIN } })
    : await prisma.user.create({ data: { name, email, phone, passwordHash, systemRole: SystemRole.SUPER_ADMIN } });
  const family = await prisma.family.upsert({ where: { code: 'KUSUMA' }, update: {}, create: { name: 'Keluarga Kusuma', code: 'KUSUMA', createdById: admin.id } });
  await prisma.familyMember.upsert({ where: { familyId_userId: { familyId: family.id, userId: admin.id } }, update: { role: FamilyRole.ADMIN }, create: { familyId: family.id, userId: admin.id, role: FamilyRole.ADMIN } });
  const existing = await prisma.ledgerEntry.count({ where: { familyId: family.id, type: LedgerType.INITIAL_BALANCE } });
  if (!existing) await prisma.ledgerEntry.create({ data: { familyId: family.id, type: LedgerType.INITIAL_BALANCE, direction: LedgerDirection.IN, amount: 0, description: 'Saldo awal kas keluarga', createdById: admin.id } });
}
main().finally(() => prisma.$disconnect());
