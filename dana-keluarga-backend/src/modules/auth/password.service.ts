import argon2 from "argon2";
import type { z } from "zod";
import { prisma } from "../../config/prisma";
import { WorkflowError } from "../approvals/approval.rules";
import type { changePasswordSchema } from "./auth.schemas";
import { lockSessionUser, revokeAccountSessions } from "./auth.service";

export async function changePassword(
  userId: string,
  authVersion: number,
  input: z.infer<typeof changePasswordSchema>,
) {
  const previous = await prisma.user.findUnique({ where: { id: userId } });
  if (!previous?.isActive || previous.authVersion !== authVersion)
    throw new WorkflowError("SESSION_REVOKED", "Silakan masuk kembali.", 401);
  if (!(await argon2.verify(previous.passwordHash, input.currentPassword)))
    throw new WorkflowError(
      "CURRENT_PASSWORD_INCORRECT",
      "Password lama yang Anda masukkan salah.",
      400,
    );
  const passwordHash = await argon2.hash(input.newPassword);
  return prisma.$transaction(async (tx) => {
    await lockSessionUser(tx, userId);
    const current = await tx.user.findUnique({ where: { id: userId } });
    if (
      !current?.isActive ||
      current.authVersion !== authVersion ||
      current.passwordHash !== previous.passwordHash
    )
      throw new WorkflowError("SESSION_REVOKED", "Silakan masuk kembali.", 401);
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, authVersion: { increment: 1 } },
    });
    const revoked = await revokeAccountSessions(tx, userId);
    // Passwords and their hashes must never be written to the audit log.
    await tx.auditLog.create({
      data: {
        actorId: userId,
        action: "PASSWORD_CHANGED",
        entityType: "User",
        entityId: userId,
        before: { authVersion },
        after: { authVersion: authVersion + 1, sessionsRevoked: revoked.count },
      },
    });
  });
}
