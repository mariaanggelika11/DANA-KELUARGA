import crypto from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/prisma";
import { FamilyRole, SystemRole, type Prisma } from "@prisma/client";
import { WorkflowError } from "../approvals/approval.rules";
import { env } from "../../config/env";

export type SessionUser = {
  id: string;
  authVersion: number;
  name: string;
  email: string | null;
  phone: string;
  systemRole: SystemRole;
  familyRole: FamilyRole | undefined;
  familyId: string | undefined;
  familyName: string | undefined;
  families: { id: string; name: string; role: FamilyRole }[];
};

// Session issuance, refresh and password changes share this lock so a revoked
// refresh token cannot issue a new session after a password change commits.
export async function lockSessionUser(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
}

async function issueSession(
  tx: Prisma.TransactionClient,
  user: SessionUser,
  existingSessionId?: string,
) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const session = existingSessionId
    ? await tx.authSession.update({
        where: { id: existingSessionId },
        data: { expiresAt },
      })
    : await tx.authSession.create({ data: { userId: user.id, expiresAt } });
  const accessToken = jwt.sign(
    {
      sub: user.id,
      familyId: user.familyId,
      familyRole: user.familyRole,
      systemRole: user.systemRole,
      authVersion: user.authVersion,
      sid: session.id,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "15m" },
  );
  const tokenId = crypto.randomUUID();
  const refreshToken = `${tokenId}.${crypto.randomBytes(48).toString("hex")}`;
  await tx.refreshToken.create({
    data: {
      id: tokenId,
      userId: user.id,
      sessionId: session.id,
      tokenHash: await argon2.hash(refreshToken),
      expiresAt,
    },
  });
  return { accessToken, refreshToken };
}

export async function createSession(
  userId: string,
  familyId?: string,
  verifiedPasswordHash?: string,
) {
  return prisma.$transaction(async (tx) => {
    await lockSessionUser(tx, userId);
    const account = await tx.user.findUnique({ where: { id: userId } });
    if (
      !account?.isActive ||
      (verifiedPasswordHash !== undefined &&
        account.passwordHash !== verifiedPasswordHash)
    )
      throw new WorkflowError("SESSION_REVOKED", "Silakan masuk kembali.", 401);
    const user = await getSessionUser(userId, familyId, tx);
    if (!user)
      throw new WorkflowError("SESSION_REVOKED", "Silakan masuk kembali.", 401);
    return issueSession(tx, user);
  });
}

export async function getSessionUser(
  userId: string,
  familyId?: string,
  db: Prisma.TransactionClient = prisma,
): Promise<SessionUser | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        where: { status: "ACTIVE" },
        orderBy: { joinedAt: "asc" },
        include: { family: { select: { name: true } } },
      },
    },
  });
  const membership = familyId
    ? user?.memberships.find((item) => item.familyId === familyId)
    : user?.memberships[0];
  if (!user || !user.isActive) return null;
  return {
    id: user.id,
    authVersion: user.authVersion,
    name: user.name,
    email: user.email,
    phone: user.phone,
    systemRole: user.systemRole,
    familyRole: membership?.role,
    familyId: membership?.familyId,
    familyName: membership?.family.name,
    families: user.memberships.map((item) => ({
      id: item.familyId,
      name: item.family.name,
      role: item.role,
    })),
  };
}

async function matchingRefreshSession(token: string, includeRevoked = false) {
  const sessionId = token.split(".")[0];
  const modern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      sessionId,
    );
  // Existing opaque tokens remain valid until expiry; new tokens use indexed lookup.
  const sessions = await prisma.refreshToken.findMany({
    where: {
      ...(modern ? { id: sessionId } : {}),
      ...(!includeRevoked ? { revokedAt: null } : {}),
      expiresAt: { gt: new Date() },
    },
  });
  for (const session of sessions)
    if (await argon2.verify(session.tokenHash, token)) return session;
  return null;
}

export async function rotateRefreshToken(token: string, familyId?: string) {
  const session = await matchingRefreshSession(token);
  if (!session) return null;
  return prisma.$transaction(async (tx) => {
    await lockSessionUser(tx, session.userId);
    const user = await getSessionUser(session.userId, familyId, tx);
    if (!user) return null;
    const active = await tx.authSession.findFirst({
      where: {
        id: session.sessionId,
        userId: session.userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!active) return null;
    const claimed = await tx.refreshToken.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    if (!claimed.count) return null;
    return { user, tokens: await issueSession(tx, user, session.sessionId) };
  });
}

export async function revokeRefreshToken(token: string) {
  // A refresh may have rotated while logout was in flight. Its old secret still
  // identifies the same session, so the new access/refresh pair is revoked too.
  const tokenRecord = await matchingRefreshSession(token, true);
  if (!tokenRecord) return;
  await revokeSession(tokenRecord.userId, tokenRecord.sessionId);
}

export async function revokeSession(userId: string, sessionId: string) {
  await prisma.$transaction(async (tx) => {
    await lockSessionUser(tx, userId);
    const revokedAt = new Date();
    await tx.authSession.updateMany({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
      },
      data: { revokedAt },
    });
    await tx.refreshToken.updateMany({
      where: { sessionId, userId, revokedAt: null },
      data: { revokedAt },
    });
  });
}

// Caller holds the User lock. Password changes and recovery use one revocation path.
export async function revokeAccountSessions(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const now = new Date();
  await tx.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  await tx.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: now },
  });
  return tx.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
}
