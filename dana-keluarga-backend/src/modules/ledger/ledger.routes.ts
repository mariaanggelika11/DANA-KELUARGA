import { Router } from 'express';
import { z } from 'zod';
import { LedgerDirection, LedgerType } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { requireAuth, type AuthRequest } from '../../middleware/auth';

const entrySchema = z.object({
  direction: z.enum(['IN', 'OUT']),
  amount: z.coerce.number().positive(),
  description: z.string().trim().min(3).max(240),
  occurredAt: z.coerce.date().optional(),
});

export const ledgerRouter = Router();

function canManageLedger(req: AuthRequest) {
  return req.auth?.systemRole === 'SUPER_ADMIN' || req.auth?.familyRole === 'ADMIN' || req.auth?.familyRole === 'TREASURER';
}

ledgerRouter.get('/', requireAuth, async (req: AuthRequest, res) => {
  if (!req.auth?.familyId) return res.status(400).json({ success: false, error: { code: 'FAMILY_REQUIRED', message: 'Akun belum memiliki keluarga' } });
  const entries = await prisma.ledgerEntry.findMany({ where: { familyId: req.auth.familyId }, include: { createdBy: { select: { id: true, name: true } } }, orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }], take: 100 });
  return res.json({ success: true, data: entries });
});

ledgerRouter.post('/', requireAuth, async (req: AuthRequest, res) => {
  if (!canManageLedger(req)) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Hanya pengelola keluarga yang dapat mencatat kas' } });
  if (!req.auth?.familyId) return res.status(400).json({ success: false, error: { code: 'FAMILY_REQUIRED', message: 'Akun belum memiliki keluarga' } });
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: { code: 'INVALID_LEDGER_ENTRY', message: 'Arah, nominal, dan keterangan kas wajib valid' } });
  const entry = await prisma.ledgerEntry.create({ data: { familyId: req.auth.familyId, direction: parsed.data.direction as LedgerDirection, type: parsed.data.direction === 'IN' ? LedgerType.OTHER_INCOME : LedgerType.EXPENSE, amount: parsed.data.amount, description: parsed.data.description, occurredAt: parsed.data.occurredAt, createdById: req.auth.sub }, include: { createdBy: { select: { id: true, name: true } } } });
  return res.status(201).json({ success: true, data: entry, message: 'Catatan kas berhasil disimpan' });
});