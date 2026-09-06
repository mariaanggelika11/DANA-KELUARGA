import { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { FamilyRole, SystemRole } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { requireAuth, type AuthRequest } from '../../middleware/auth';
import { requireSystemRole } from '../../middleware/roles';
import { normalizeIndonesianPhone } from '../../utils/phone';

const personSchema = z.object({ name: z.string().trim().min(2).max(120), email: z.string().email().optional(), phone: z.string().min(8).max(20), password: z.string().min(8), role: z.enum(['ADMIN', 'MEMBER', 'TREASURER']).default('MEMBER'), familyId: z.string().uuid().optional() });
const memberSchema = personSchema.extend({ existingUserId: z.string().uuid().optional() });
const familySchema = z.object({ name: z.string().trim().min(2).max(120), code: z.string().trim().min(3).max(30).regex(/^[A-Z0-9-]+$/), description: z.string().trim().max(240).optional(), admin: personSchema.omit({ role: true }) });

export const managementRouter = Router();

managementRouter.get('/families', requireAuth, requireSystemRole(SystemRole.SUPER_ADMIN), async (_req, res) => {
  const families = await prisma.family.findMany({ select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } });
  return res.json({ success: true, data: families });
});

managementRouter.get('/users', requireAuth, requireSystemRole(SystemRole.SUPER_ADMIN), async (req, res) => {
  const search = String(req.query.search ?? '').trim();
  if (search.length < 2) return res.json({ success: true, data: [] });
  const users = await prisma.user.findMany({ where: { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] }, select: { id: true, name: true, email: true, phone: true, systemRole: true }, take: 10, orderBy: { name: 'asc' } });
  return res.json({ success: true, data: users });
});

managementRouter.post('/families', requireAuth, requireSystemRole(SystemRole.SUPER_ADMIN), async (req, res) => {
  const parsed = familySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: { code: 'INVALID_FAMILY', message: 'Data keluarga atau admin belum valid' } });
  const { admin, ...familyData } = parsed.data;
  const phone = normalizeIndonesianPhone(admin.phone);
  const existing = await prisma.user.findFirst({ where: { OR: [{ email: admin.email }, { phone }] } });
  if (existing) return res.status(409).json({ success: false, error: { code: 'USER_ALREADY_EXISTS', message: 'Email atau nomor anggota sudah digunakan' } });
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name: admin.name, email: admin.email, phone, passwordHash: await argon2.hash(admin.password) } });
    const family = await tx.family.create({ data: { ...familyData, createdById: user.id } });
    const membership = await tx.familyMember.create({ data: { familyId: family.id, userId: user.id, role: FamilyRole.ADMIN } });
    return { family, user: { id: user.id, name: user.name, email: user.email }, membership };
  });
  return res.status(201).json({ success: true, data: result, message: 'Keluarga dan admin berhasil dibuat' });
});

managementRouter.post('/members', requireAuth, async (req: AuthRequest, res) => {
  if (req.auth?.systemRole !== SystemRole.SUPER_ADMIN && req.auth?.familyRole !== FamilyRole.ADMIN) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Hanya admin yang dapat mendaftarkan anggota' } });
  const parsed = memberSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: { code: 'INVALID_MEMBER', message: 'Data anggota belum valid' } });
  const familyId = req.auth.systemRole === SystemRole.SUPER_ADMIN ? parsed.data.familyId : req.auth.familyId;
  if (!familyId) return res.status(400).json({ success: false, error: { code: 'FAMILY_REQUIRED', message: 'Akun belum memiliki keluarga' } });
  const family = await prisma.family.findUnique({ where: { id: familyId } });
  if (!family) return res.status(404).json({ success: false, error: { code: 'FAMILY_NOT_FOUND', message: 'Keluarga tidak ditemukan' } });
  let user = parsed.data.existingUserId ? await prisma.user.findUnique({ where: { id: parsed.data.existingUserId }, include: { memberships: true } }) : null;
  if (parsed.data.existingUserId && !user) return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Anggota yang dipilih tidak ditemukan' } });
  if (user) {
    if (user.memberships.some((membership) => membership.familyId === familyId)) return res.status(409).json({ success: false, error: { code: 'ALREADY_FAMILY_MEMBER', message: 'Anggota tersebut sudah terdaftar di keluarga ini' } });
    await prisma.familyMember.create({ data: { familyId, userId: user.id, role: parsed.data.role } });
  } else {
    const phone = normalizeIndonesianPhone(parsed.data.phone);
    const existing = await prisma.user.findFirst({ where: { OR: [{ email: parsed.data.email }, { phone }] } });
    if (existing) return res.status(409).json({ success: false, error: { code: 'USER_ALREADY_EXISTS', message: 'Email atau nomor anggota sudah digunakan. Pilih anggota yang sudah ada.' } });
    user = await prisma.user.create({ data: { name: parsed.data.name, email: parsed.data.email, phone, passwordHash: await argon2.hash(parsed.data.password), memberships: { create: { familyId, role: parsed.data.role } } }, include: { memberships: true } });
  }
  return res.status(201).json({ success: true, data: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: parsed.data.role, familyId }, message: 'Anggota berhasil didaftarkan' });
});

managementRouter.get('/members', requireAuth, async (req: AuthRequest, res) => {
  if (!req.auth?.familyId) return res.status(400).json({ success: false, error: { code: 'FAMILY_REQUIRED', message: 'Akun belum memiliki keluarga' } });
  const members = await prisma.familyMember.findMany({ where: { familyId: req.auth.familyId }, select: { id: true, role: true, status: true, joinedAt: true, user: { select: { id: true, name: true, email: true, phone: true, isActive: true, systemRole: true } } }, orderBy: { joinedAt: 'asc' } });
  return res.json({ success: true, data: members });
});
