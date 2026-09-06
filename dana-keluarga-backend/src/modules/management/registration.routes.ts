import { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { FamilyRole, SystemRole } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { requireAuth, type AuthRequest } from '../../middleware/auth';
import { requireSystemRole } from '../../middleware/roles';
import { normalizeIndonesianPhone } from '../../utils/phone';

const base = z.object({
  type: z.enum(['NEW_FAMILY', 'NEW_MEMBER', 'EXISTING_MEMBER']),
  role: z.enum(['ADMIN', 'TREASURER', 'MEMBER']).default('MEMBER'),
  familyId: z.string().uuid().optional(),
  existingUserId: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(8).max(20).optional(),
  password: z.string().min(8).optional(),
  familyName: z.string().trim().min(2).max(120).optional(),
  familyCode: z.string().trim().min(3).max(30).regex(/^[A-Z0-9-]+$/).optional(),
  description: z.string().trim().max(240).optional(),
});

export const registrationRouter = Router();

registrationRouter.post('/', requireAuth, requireSystemRole(SystemRole.SUPER_ADMIN), async (req: AuthRequest, res) => {
  const parsed = base.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: { code: 'INVALID_REGISTRATION', message: 'Data pendaftaran belum lengkap atau tidak valid' } });
  const data = parsed.data;

  if (data.type === 'NEW_FAMILY') {
    if (!data.name || !data.email || !data.phone || !data.password || !data.familyName || !data.familyCode) return res.status(400).json({ success: false, error: { code: 'NEW_FAMILY_DATA_REQUIRED', message: 'Data anggota dan keluarga baru wajib diisi' } });
    const phone = normalizeIndonesianPhone(data.phone);
    const duplicate = await prisma.user.findFirst({ where: { OR: [{ email: data.email }, { phone }] } });
    if (duplicate) return res.status(409).json({ success: false, error: { code: 'USER_ALREADY_EXISTS', message: 'Email atau nomor WhatsApp sudah digunakan' } });
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name: data.name!, email: data.email, phone, passwordHash: await argon2.hash(data.password!) } });
      const family = await tx.family.create({ data: { name: data.familyName!, code: data.familyCode!, description: data.description, createdById: user.id } });
      const membership = await tx.familyMember.create({ data: { familyId: family.id, userId: user.id, role: FamilyRole.ADMIN } });
      return { user, family, membership };
    });
    return res.status(201).json({ success: true, data: { family: result.family, user: { id: result.user.id, name: result.user.name, email: result.user.email }, role: result.membership.role }, message: 'Keluarga baru dan Admin berhasil didaftarkan' });
  }

  if (!data.familyId) return res.status(400).json({ success: false, error: { code: 'FAMILY_REQUIRED', message: 'Pilih keluarga tujuan terlebih dahulu' } });
  const family = await prisma.family.findUnique({ where: { id: data.familyId } });
  if (!family) return res.status(404).json({ success: false, error: { code: 'FAMILY_NOT_FOUND', message: 'Keluarga tujuan tidak ditemukan' } });

  if (data.type === 'EXISTING_MEMBER') {
    if (!data.existingUserId) return res.status(400).json({ success: false, error: { code: 'EXISTING_USER_REQUIRED', message: 'Pilih anggota yang sudah ada' } });
    const existingUser = await prisma.user.findUnique({ where: { id: data.existingUserId } });
    if (!existingUser) return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Anggota yang dipilih tidak ditemukan' } });
    const membership = await prisma.familyMember.findUnique({ where: { familyId_userId: { familyId: family.id, userId: existingUser.id } } });
    if (membership) return res.status(409).json({ success: false, error: { code: 'ALREADY_FAMILY_MEMBER', message: 'Anggota tersebut sudah terdaftar di keluarga ini' } });
    await prisma.familyMember.create({ data: { familyId: family.id, userId: existingUser.id, role: data.role } });
    return res.status(201).json({ success: true, data: { family, user: { id: existingUser.id, name: existingUser.name, email: existingUser.email }, role: data.role }, message: 'Anggota lama berhasil ditambahkan ke keluarga' });
  }

  if (!data.name || !data.phone || !data.password) return res.status(400).json({ success: false, error: { code: 'NEW_MEMBER_DATA_REQUIRED', message: 'Nama, nomor WhatsApp, dan password wajib diisi' } });
  const phone = normalizeIndonesianPhone(data.phone);
  const duplicate = await prisma.user.findFirst({ where: { OR: [{ email: data.email }, { phone }] } });
  if (duplicate) return res.status(409).json({ success: false, error: { code: 'USER_ALREADY_EXISTS', message: 'Email atau nomor WhatsApp sudah digunakan. Gunakan pilihan anggota yang sudah ada.' } });
  const user = await prisma.user.create({ data: { name: data.name, email: data.email, phone, passwordHash: await argon2.hash(data.password), memberships: { create: { familyId: family.id, role: data.role } } } });
  return res.status(201).json({ success: true, data: { family, user: { id: user.id, name: user.name, email: user.email }, role: data.role }, message: 'Anggota baru berhasil didaftarkan ke keluarga' });
});
