import crypto from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/prisma';
import { FamilyRole, SystemRole } from '@prisma/client';
import { env } from '../../config/env';

export type SessionUser = { id: string; name: string; email: string | null; phone: string; systemRole: SystemRole; familyRole: FamilyRole | undefined; familyId: string | undefined; familyName: string | undefined };

export async function createSession(userId: string, familyId: string | undefined, familyRole: FamilyRole | undefined, systemRole: SystemRole) {
  const accessToken = jwt.sign({ sub: userId, familyId, familyRole, systemRole }, env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
  const refreshToken = crypto.randomBytes(48).toString('hex');
  await prisma.refreshToken.create({ data: { userId, tokenHash: await argon2.hash(refreshToken), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
  return { accessToken, refreshToken };
}

export async function getSessionUser(userId: string): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { memberships: { where: { status: 'ACTIVE' }, orderBy: { joinedAt: 'asc' }, include: { family: { select: { name: true } } } } } });
  const membership = user?.memberships[0];
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, systemRole: user.systemRole, familyRole: membership?.role, familyId: membership?.familyId, familyName: membership?.family.name };
}

export async function rotateRefreshToken(token: string) {
  const sessions = await prisma.refreshToken.findMany({ where: { revokedAt: null, expiresAt: { gt: new Date() } } });
  for (const session of sessions) {
    if (await argon2.verify(session.tokenHash, token)) {
      const user = await getSessionUser(session.userId);
      if (!user) return null;
      await prisma.refreshToken.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return { user, tokens: await createSession(user.id, user.familyId, user.familyRole, user.systemRole) };
    }
  }
  return null;
}

export async function revokeRefreshToken(token: string) {
  const sessions = await prisma.refreshToken.findMany({ where: { revokedAt: null } });
  for (const session of sessions) if (await argon2.verify(session.tokenHash, token)) await prisma.refreshToken.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
}
