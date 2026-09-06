import { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { requireAuth, type AuthRequest } from '../../middleware/auth';
import { createSession, getSessionUser, revokeRefreshToken, rotateRefreshToken } from './auth.service';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Email dan password tidak valid' } });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email }, include: { memberships: { where: { status: 'ACTIVE' } } } });
  if (!user || !user.isActive || !(await argon2.verify(user.passwordHash, parsed.data.password))) return res.status(401).json({ success: false, error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Email atau password salah' } });
  const session = await createSession(user.id, user.memberships[0]?.familyId, user.memberships[0]?.role, user.systemRole);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return res.json({ success: true, data: { ...session, user: await getSessionUser(user.id) } });
});

authRouter.post('/refresh', async (req, res) => {
  const parsed = z.object({ refreshToken: z.string().min(20) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: { code: 'REFRESH_TOKEN_REQUIRED', message: 'Refresh token wajib diisi' } });
  const rotated = await rotateRefreshToken(parsed.data.refreshToken);
  if (!rotated) return res.status(401).json({ success: false, error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token tidak valid atau sudah kedaluwarsa' } });
  return res.json({ success: true, data: { ...rotated.tokens, user: rotated.user } });
});

authRouter.post('/logout', async (req, res) => {
  const parsed = z.object({ refreshToken: z.string().min(20) }).safeParse(req.body);
  if (parsed.success) await revokeRefreshToken(parsed.data.refreshToken);
  return res.json({ success: true, message: 'Logout berhasil' });
});

authRouter.get('/me', requireAuth, async (req: AuthRequest, res) => {
  const user = await getSessionUser(req.auth!.sub);
  if (!user) return res.status(401).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Sesi pengguna tidak ditemukan' } });
  return res.json({ success: true, data: user });
});
