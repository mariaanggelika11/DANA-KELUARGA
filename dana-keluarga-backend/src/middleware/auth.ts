import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { FamilyRole, SystemRole } from '@prisma/client';
import { env } from '../config/env';

export type AuthPayload = { sub: string; familyId?: string; familyRole?: FamilyRole; systemRole: SystemRole };
export type AuthRequest = Request & { auth?: AuthPayload };

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
  if (!token) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Silakan login terlebih dahulu' } });
  try {
    req.auth = jwt.verify(token, env.JWT_ACCESS_SECRET) as AuthPayload;
    return next();
  } catch {
    return res.status(401).json({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Sesi login telah berakhir' } });
  }
}

export function requireRole(...roles: FamilyRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.auth?.systemRole === SystemRole.SUPER_ADMIN) return next();
    if (!req.auth?.familyRole || !roles.includes(req.auth.familyRole)) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Anda tidak memiliki akses' } });
    return next();
  };
}
