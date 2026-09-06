import { NextFunction, Response } from 'express';
import { SystemRole, FamilyRole } from '@prisma/client';
import { AuthRequest } from './auth';

export function requireSystemRole(...roles: SystemRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.auth?.systemRole || !roles.includes(req.auth.systemRole)) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Akses global tidak diizinkan' } });
    return next();
  };
}

export function requireFamilyRole(...roles: FamilyRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const role = req.auth?.familyRole;
    if (!role || !roles.includes(role)) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Role keluarga tidak memiliki akses ini' } });
    return next();
  };
}
