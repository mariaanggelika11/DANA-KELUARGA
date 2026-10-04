import { Prisma } from "@prisma/client";
import { WorkflowError } from "../approvals/approval.rules";
import { MAX_MONEY } from "../../utils/money";
type Tx = Prisma.TransactionClient;
export const lockFamily = (tx: Tx, familyId: string) =>
  tx.$queryRaw`SELECT id FROM "Family" WHERE id = ${familyId}::uuid FOR UPDATE`;
export async function cashBalance(tx: Tx, familyId: string) {
  const rows = await tx.ledgerEntry.groupBy({
    by: ["direction"],
    where: { familyId },
    _sum: { amount: true },
  });
  return rows.reduce(
    (sum, row) =>
      row.direction === "IN"
        ? sum.add(row._sum.amount ?? 0)
        : sum.sub(row._sum.amount ?? 0),
    new Prisma.Decimal(0),
  );
}
export async function reservedCash(
  tx: Tx,
  familyId: string,
  excluding?: string,
) {
  const result = await tx.fundRequest.aggregate({
    where: {
      familyId,
      status: { in: ["PENDING", "APPROVED"] },
      ...(excluding ? { id: { not: excluding } } : {}),
    },
    _sum: { amount: true },
  });
  return result._sum.amount ?? new Prisma.Decimal(0);
}
export async function memberContribution(
  tx: Tx,
  familyId: string,
  userId: string,
) {
  const rows = await tx.ledgerEntry.groupBy({
    by: ["type"],
    where: {
      familyId,
      ownerUserId: userId,
      type: { in: ["CONTRIBUTION", "WITHDRAWAL"] },
    },
    _sum: { amount: true },
  });
  const deposited =
    rows.find((row) => row.type === "CONTRIBUTION")?._sum.amount ??
    new Prisma.Decimal(0);
  const withdrawn =
    rows.find((row) => row.type === "WITHDRAWAL")?._sum.amount ??
    new Prisma.Decimal(0);
  const reservations = await tx.fundRequest.aggregate({
    where: { familyId, userId, status: { in: ["PENDING", "APPROVED"] } },
    _sum: { withdrawalAmount: true },
  });
  const reserved = reservations._sum.withdrawalAmount ?? new Prisma.Decimal(0);
  return {
    deposited,
    withdrawn,
    reserved,
    available: deposited.sub(withdrawn).sub(reserved),
  };
}
// Caller holds Family lock. All money postings share this path and store audit snapshots.
export async function postLedger(
  tx: Tx,
  data: Prisma.LedgerEntryUncheckedCreateInput,
  excludingReservation?: string,
) {
  const before = await cashBalance(tx, data.familyId);
  const amount = new Prisma.Decimal(data.amount.toString());
  const after =
    data.direction === "IN" ? before.add(amount) : before.sub(amount);
  if (!amount.isInteger() || amount.lte(0) || after.gt(MAX_MONEY.toString()))
    throw new WorkflowError(
      "INVALID_AMOUNT",
      "Nominal atau saldo akhir melampaui batas pencatatan.",
      400,
    );
  if (
    after.lt(0) ||
    (data.direction === "OUT" &&
      after.lt(await reservedCash(tx, data.familyId, excludingReservation)))
  )
    throw new WorkflowError(
      "INSUFFICIENT_FAMILY_CASH",
      "Saldo Kas Keluarga tidak mencukupi untuk transaksi ini.",
    );
  const entry = await tx.ledgerEntry.create({
    data: { ...data, balanceBefore: before, balanceAfter: after },
  });
  await tx.auditLog.create({
    data: {
      actorId: data.createdById,
      familyId: data.familyId,
      action: data.type,
      entityType: "LedgerEntry",
      entityId: entry.id,
      before: { balance: before.toString() },
      after: {
        balance: after.toString(),
        amount: amount.toString(),
        ownerUserId: data.ownerUserId ?? null,
      },
    },
  });
  return entry;
}
