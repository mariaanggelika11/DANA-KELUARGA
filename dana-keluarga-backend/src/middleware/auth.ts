import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { FamilyRole, SystemRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { env } from '../config/env';

export type AuthPayload = { sub: string; familyId?: string; familyRole?: FamilyRole; systemRole: SystemRole };
export type AuthRequest = Request & { auth?: AuthPayload };

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
  if (!token) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Silakan login terlebih dahulu' } });
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string' || (payload.familyId !== undefined && typeof payload.familyId !== 'string')) throw new Error('Invalid token');
    req.auth = payload as AuthPayload;
  } catch {
    return res.status(401).json({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Sesi login telah berakhir' } });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth.sub }, include: { memberships: { where: { familyId: req.auth.familyId, status: 'ACTIVE' } } } });
    if (!user?.isActive) return res.status(401).json({ error: { message: 'Akun tidak aktif' } });
    req.auth.systemRole = user.systemRole;
    const membership = req.auth.familyId ? user.memberships.find((item) => item.familyId === req.auth!.familyId) : undefined;
    req.auth.familyRole = membership?.role;
    if (!membership) req.auth.familyId = undefined;
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireRole(...roles: FamilyRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.auth?.systemRole === SystemRole.SUPER_ADMIN) return next();
    if (!req.auth?.familyRole || !roles.includes(req.auth.familyRole)) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Anda tidak memiliki akses' } });
    return next();
  };
}
