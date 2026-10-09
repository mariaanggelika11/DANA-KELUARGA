import type { Prisma, FamilyRole } from "@prisma/client";
import {
  WorkflowError,
  requireOperationalActor,
  type WorkflowActor,
} from "../approvals/approval.rules";
import { lockFamily } from "./ledger.service";

// Permission checks belong after the same family lock used by role changes.
export async function authorizeFamily(
  tx: Prisma.TransactionClient,
  actor: WorkflowActor,
  roles?: FamilyRole[],
) {
  requireOperationalActor(actor, actor.familyId ?? "");
  if (!actor.familyId)
    throw new WorkflowError("FAMILY_REQUIRED", "Pilih keluarga aktif.", 403);
  await lockFamily(tx, actor.familyId);
  const member = await tx.familyMember.findUnique({
    where: { familyId_userId: { familyId: actor.familyId, userId: actor.sub } },
    include: { user: { select: { isActive: true, systemRole: true } } },
  });
  if (
    member?.status !== "ACTIVE" ||
    !member.user.isActive ||
    member.user.systemRole !== "USER" ||
    (roles && !roles.includes(member.role))
  )
    throw new WorkflowError(
      "FORBIDDEN",
      "Akses keluarga Anda sudah berubah. Muat ulang halaman.",
      403,
    );
  return {
    ...actor,
    familyId: actor.familyId,
    familyRole: member.role,
    systemRole: member.user.systemRole,
  };
}

export async function availableReviewers(
  tx: Prisma.TransactionClient,
  familyId: string,
  ownerId: string,
) {
  return tx.familyMember.findMany({
    where: {
      familyId,
      status: "ACTIVE",
      role: "TREASURER",
      userId: { not: ownerId },
      user: { isActive: true, systemRole: "USER" },
    },
    select: { userId: true },
  });
}
export async function requireReviewer(
  tx: Prisma.TransactionClient,
  familyId: string,
  ownerId: string,
) {
  const reviewers = await availableReviewers(tx, familyId, ownerId);
  if (!reviewers.length)
    throw new WorkflowError(
      "REVIEWER_UNAVAILABLE",
      "Belum ada pengelola dana lain yang dapat memeriksa laporan Anda. Hubungi Admin untuk menetapkan pengelola dana.",
      409,
    );
  return reviewers;
}
