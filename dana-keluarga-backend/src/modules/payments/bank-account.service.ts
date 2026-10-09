import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../../config/prisma";
import { WorkflowError, type WorkflowActor } from "../approvals/approval.rules";
import { authorizeFamily } from "../cash/family-access.service";
import type { bankAccountSchema } from "./payment.rules";

export const bankAccountSelect = {
  id: true,
  version: true,
  bankName: true,
  accountNumber: true,
  accountHolder: true,
} as const;
export async function saveBankAccount(
  actor: WorkflowActor,
  input: z.infer<typeof bankAccountSchema>,
) {
  return prisma.$transaction(async (tx) => {
    await authorizeFamily(tx, actor, ["TREASURER"]);
    const previous = await tx.familyBankAccount.findFirst({
      where: { familyId: actor.familyId! },
      orderBy: { version: "desc" },
      select: bankAccountSelect,
    });
    if ((previous?.version ?? 0) !== input.expectedVersion)
      throw new WorkflowError(
        "ACCOUNT_CHANGED",
        "Rekening sudah berubah. Muat ulang sebelum menyimpan.",
      );
    const account = await tx.familyBankAccount.create({
      data: {
        familyId: actor.familyId!,
        createdById: actor.sub,
        version: input.expectedVersion + 1,
        bankName: input.bankName,
        accountNumber: input.accountNumber,
        accountHolder: input.accountHolder,
      },
      select: bankAccountSelect,
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        familyId: actor.familyId!,
        action: "FAMILY_BANK_ACCOUNT_CHANGED",
        entityType: "FamilyBankAccount",
        entityId: account.id,
        before: previous ?? Prisma.JsonNull,
        after: account,
      },
    });
    return account;
  });
}
