import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { FamilyRole, SystemRole } from "@prisma/client";
import { prisma } from "../config/prisma";
import { env } from "../config/env";

export type AuthPayload = {
  sub: string;
  sid?: string;
  authVersion?: number;
  familyId?: string;
  familyRole?: FamilyRole;
  systemRole: SystemRole;
};
export type AuthRequest = Request & { auth?: AuthPayload };

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const token = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : undefined;
  if (!token)
    return res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Silakan login terlebih dahulu",
      },
    });
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ["HS256"],
    });
    if (
      typeof payload === "string" ||
      typeof payload.sub !== "string" ||
      (payload.familyId !== undefined &&
        typeof payload.familyId !== "string") ||
      (payload.authVersion !== undefined &&
        (!Number.isSafeInteger(payload.authVersion) || payload.authVersion < 0))
    )
      throw new Error("Invalid token");
    req.auth = payload as AuthPayload;
  } catch {
    return res.status(401).json({
      success: false,
      error: { code: "TOKEN_EXPIRED", message: "Sesi login telah berakhir" },
    });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth.sub },
      include: {
        memberships: {
          where: { familyId: req.auth.familyId, status: "ACTIVE" },
        },
      },
    });
    if (!user?.isActive)
      return res.status(401).json({ error: { message: "Akun tidak aktif" } });
    if ((req.auth.authVersion ?? 0) !== (user.authVersion ?? 0))
      return res.status(401).json({
        success: false,
        error: {
          code: "SESSION_REVOKED",
          message: "Sesi login telah berakhir. Silakan masuk kembali.",
        },
      });
    const activeSession =
      typeof req.auth.sid === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        req.auth.sid,
      ) &&
      (await prisma.authSession.findFirst({
        where: {
          id: req.auth.sid,
          userId: user.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      }));
    if (!activeSession)
      return res.status(401).json({
        success: false,
        error: {
          code: "SESSION_REVOKED",
          message: "Sesi login telah berakhir. Silakan masuk kembali.",
        },
      });
    req.auth.systemRole = user.systemRole;
    const membership = req.auth.familyId
      ? user.memberships.find((item) => item.familyId === req.auth!.familyId)
      : undefined;
    req.auth.familyRole = membership?.role;
    if (!membership) req.auth.familyId = undefined;
    return next();
  } catch (error) {
    return next(error);
  }
}
