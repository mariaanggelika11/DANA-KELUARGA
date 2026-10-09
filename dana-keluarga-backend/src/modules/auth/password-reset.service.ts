import crypto from "node:crypto";
import argon2 from "argon2";
import type { z } from "zod";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { WorkflowError } from "../approvals/approval.rules";
import { defaultSender, type EmailSender } from "../email/email.service";
import { renderEmail } from "../email/email.templates";
import { lockSessionUser, revokeAccountSessions } from "./auth.service";
import type { resetPasswordSchema } from "./auth.schemas";

const digest = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");
const invalidToken = () =>
  new WorkflowError(
    "RESET_TOKEN_INVALID",
    "Tautan pemulihan tidak berlaku atau sudah digunakan. Minta tautan baru melalui Lupa password.",
    400,
  );

export async function requestPasswordReset(
  email: string,
  sender: EmailSender | null = defaultSender(),
) {
  const account = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, isActive: true },
  });
  if (!account?.email || env.EMAIL_MODE === "disabled") return;
  const token = crypto.randomBytes(32).toString("hex");
  const reset = await prisma.$transaction(async (tx) => {
    await lockSessionUser(tx, account.id);
    const current = await tx.user.findUnique({ where: { id: account.id } });
    if (
      !current?.isActive ||
      current.email?.toLowerCase() !== email.toLowerCase()
    )
      return null;
    const recent = await tx.passwordResetToken.findFirst({
      where: {
        userId: account.id,
        createdAt: { gt: new Date(Date.now() - 60_000) },
      },
    });
    if (recent) return null;
    await tx.passwordResetToken.updateMany({
      where: { userId: account.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return tx.passwordResetToken.create({
      data: {
        userId: current.id,
        tokenHash: digest(token),
        authVersion: current.authVersion,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
  });
  if (!reset) return;
  const link = new URL(env.PUBLIC_APP_URL ?? env.FRONTEND_URL);
  link.searchParams.set("view", "reset-password");
  link.searchParams.set("token", token);
  const subject = "Pulihkan password Dana Keluarga";
  const body = `Ada permintaan untuk memulihkan password akun Dana Keluarga Anda. Buka tautan berikut untuk membuat password baru: ${link.toString()}\n\nTautan berlaku 30 menit dan hanya dapat dipakai sekali. Jika Anda tidak meminta pemulihan, abaikan email ini. Password Anda belum berubah.`;
  try {
    // Recovery has no family dependency (including platform owners). Send directly:
    // a bearer secret must not appear in the family email history or audit logs.
    await sender?.({
      id: reset.id,
      to: account.email,
      subject,
      ...renderEmail(subject, body),
      idempotencyKey: `PASSWORD_RESET:${reset.id}`,
    });
  } catch {
    await prisma.passwordResetToken.updateMany({
      where: { id: reset.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    // Do not expose transport errors, recipient addresses or recovery links.
    console.warn("Email pemulihan password belum berhasil dikirim.");
  }
}

export async function resetPassword(
  input: z.infer<typeof resetPasswordSchema>,
) {
  const tokenHash = digest(input.token);
  const snapshot = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });
  if (!snapshot || snapshot.usedAt || snapshot.expiresAt <= new Date())
    throw invalidToken();
  const passwordHash = await argon2.hash(input.newPassword);
  return prisma.$transaction(async (tx) => {
    await lockSessionUser(tx, snapshot.userId);
    const current = await tx.passwordResetToken.findUnique({
      where: { id: snapshot.id },
    });
    const user = await tx.user.findUnique({ where: { id: snapshot.userId } });
    if (
      !current ||
      current.usedAt ||
      current.expiresAt <= new Date() ||
      !user?.isActive ||
      user.authVersion !== current.authVersion
    )
      throw invalidToken();
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, authVersion: { increment: 1 } },
    });
    const revoked = await revokeAccountSessions(tx, user.id);
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "PASSWORD_RESET",
        entityType: "User",
        entityId: user.id,
        before: { authVersion: user.authVersion },
        after: {
          authVersion: user.authVersion + 1,
          sessionsRevoked: revoked.count,
        },
      },
    });
  });
}
