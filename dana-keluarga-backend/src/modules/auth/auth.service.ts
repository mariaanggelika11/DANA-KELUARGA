import crypto from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/prisma";
import { FamilyRole, SystemRole } from "@prisma/client";
import { env } from "../../config/env";

export type SessionUser = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  systemRole: SystemRole;
  familyRole: FamilyRole | undefined;
  familyId: string | undefined;
  familyName: string | undefined;
  families: { id: string; name: string; role: FamilyRole }[];
};

export async function createSession(
  userId: string,
  familyId: string | undefined,
  familyRole: FamilyRole | undefined,
  systemRole: SystemRole,
) {
  const accessToken = jwt.sign(
    { sub: userId, familyId, familyRole, systemRole },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "15m" },
  );
  const sessionId = crypto.randomUUID();
  const refreshToken = `${sessionId}.${crypto.randomBytes(48).toString("hex")}`;
  await prisma.refreshToken.create({
    data: {
      id: sessionId,
      userId,
      tokenHash: await argon2.hash(refreshToken),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  return { accessToken, refreshToken };
}

export async function getSessionUser(
  userId: string,
  familyId?: string,
): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({
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

async function matchingRefreshSession(token: string) {
  const sessionId = token.split(".")[0];
  const modern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      sessionId,
    );
  // Existing opaque tokens remain valid until expiry; new tokens use indexed lookup.
  const sessions = await prisma.refreshToken.findMany({
    where: {
      ...(modern ? { id: sessionId } : {}),
      revokedAt: null,
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
  const user = await getSessionUser(session.userId, familyId);
  if (!user) return null;
  const claimed = await prisma.refreshToken.updateMany({
    where: { id: session.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!claimed.count) return null;
  return {
    user,
    tokens: await createSession(
      user.id,
      user.familyId,
      user.familyRole,
      user.systemRole,
    ),
  };
}

export async function revokeRefreshToken(token: string) {
  const session = await matchingRefreshSession(token);
  if (session)
    await prisma.refreshToken.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
}
