import { prisma } from "../../config/prisma";
import { WorkflowError, type WorkflowActor } from "../approvals/approval.rules";
import { authorizeFamily, requireReviewer } from "./family-access.service";
import { memberContribution, postLedger } from "./ledger.service";
import { enqueue, money } from "../notifications/notification.service";
import { env } from "../../config/env";

export async function contribute(
  actor: WorkflowActor,
  input: {
    amount: string;
    purpose: string;
    idempotencyKey: string;
    bankAccountId?: string;
  },
) {
  return prisma.$transaction(async (tx) => {
    const current = await authorizeFamily(tx, actor);
    const familyId = current.familyId;
    const previous = await tx.contributionReport.findUnique({
      where: {
        familyId_userId_idempotencyKey: {
          familyId,
          userId: actor.sub,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (previous) {
      if (
        !previous.amount.equals(input.amount) ||
        previous.purpose !== input.purpose ||
        (input.bankAccountId && previous.bankAccountId !== input.bankAccountId)
      )
        throw new WorkflowError(
          "IDEMPOTENCY_CONFLICT",
          "Kode laporan sudah dipakai untuk data berbeda.",
        );
      return previous;
    }
    const reviewers = await requireReviewer(tx, familyId, actor.sub);
    const account = await tx.familyBankAccount.findFirst({
      where: {
        familyId,
        ...(input.bankAccountId ? { id: input.bankAccountId } : {}),
      },
      orderBy: { version: "desc" },
    });
    if (!account)
      throw new WorkflowError(
        "BANK_ACCOUNT_REQUIRED",
        "Rekening keluarga belum diatur. Hubungi pengelola dana.",
        409,
      );
    const report = await tx.contributionReport.create({
      data: {
        familyId,
        userId: actor.sub,
        amount: input.amount,
        purpose: input.purpose,
        idempotencyKey: input.idempotencyKey,
        bankAccountId: account.id,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        familyId,
        action: "CONTRIBUTION_REPORTED",
        entityType: "ContributionReport",
        entityId: report.id,
        after: {
          amount: input.amount,
          bankAccountId: account.id,
          status: "PENDING",
        },
      },
    });
    const link = `${(env.PUBLIC_APP_URL ?? env.FRONTEND_URL).replace(/\/$/, "")}/?view=cash`;
    for (const reviewer of reviewers)
      await enqueue(tx, {
        eventKey: `CONTRIBUTION_REPORTED:${report.id}:${reviewer.userId}`,
        familyId,
        userId: reviewer.userId,
        kind: "CONTRIBUTION_REPORTED",
        view: "cash",
        body: `Laporan setoran ${money(input.amount)} menunggu pemeriksaan rekening keluarga. Kas belum berubah. Periksa laporan: ${link}`,
      });
    await enqueue(tx, {
      eventKey: `CONTRIBUTION_PENDING:${report.id}`,
      familyId,
      userId: actor.sub,
      kind: "CONTRIBUTION_PENDING",
      view: "cash",
      body: `Laporan setoran ${money(input.amount)} diterima dan menunggu pemeriksaan pengelola dana. Kontribusi Anda dan saldo kas bertambah setelah uang masuk dikonfirmasi.`,
    });
    return report;
  });
}

export async function listContributions(actor: WorkflowActor, page = 1) {
  return prisma.$transaction(async (tx) => {
    const current = await authorizeFamily(tx, actor);
    const canManage = current.familyRole === "TREASURER";
    const where = {
      familyId: current.familyId,
      ...(["ADMIN", "TREASURER"].includes(current.familyRole)
        ? {}
        : { userId: actor.sub }),
    };
    const items = await tx.contributionReport.findMany({
      where,
      include: {
        user: { select: { name: true } },
        reviewedBy: { select: { name: true } },
        reversedBy: { select: { name: true } },
        bankAccount: {
          select: { bankName: true, accountNumber: true, accountHolder: true },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * 20,
      take: 20,
    });
    return {
      items: items.map((item) => ({
        ...item,
        canReview:
          canManage && item.userId !== actor.sub && item.status === "PENDING",
        canReverse:
          canManage && item.userId !== actor.sub && item.status === "CONFIRMED",
      })),
      total: await tx.contributionReport.count({ where }),
      page,
    };
  });
}

export async function reverseContribution(
  actor: WorkflowActor,
  id: string,
  reason: string,
) {
  reason = reason.trim();
  if (reason.length < 5 || reason.length > 500)
    throw new WorkflowError(
      "REVERSAL_REASON_REQUIRED",
      "Isi alasan koreksi 5–500 karakter.",
      400,
    );
  return prisma.$transaction(async (tx) => {
    const current = await authorizeFamily(tx, actor, ["TREASURER"]);
    const report = await tx.contributionReport.findFirst({
      where: { id, familyId: current.familyId },
    });
    if (!report)
      throw new WorkflowError(
        "CONTRIBUTION_NOT_FOUND",
        "Laporan setoran tidak ditemukan.",
        404,
      );
    if (report.userId === actor.sub)
      throw new WorkflowError(
        "SELF_CONFIRMATION_NOT_ALLOWED",
        "Setoran sendiri harus dikoreksi pengelola dana lain.",
        403,
      );
    if (report.status === "REVERSED") {
      if (report.reversalReason === reason) return report;
      throw new WorkflowError(
        "CONTRIBUTION_ALREADY_REVERSED",
        "Setoran sudah dikoreksi. Riwayat koreksi tidak dapat diubah.",
      );
    }
    if (report.status !== "CONFIRMED")
      throw new WorkflowError(
        "CONTRIBUTION_NOT_CONFIRMED",
        "Hanya setoran yang sudah dikonfirmasi dapat dikoreksi.",
      );
    const original = await tx.ledgerEntry.findFirst({
      where: {
        familyId: report.familyId,
        referenceType: "CONTRIBUTION_REPORT",
        referenceId: id,
        type: "CONTRIBUTION",
        direction: "IN",
        ownerUserId: report.userId,
      },
    });
    if (!original || !original.amount.equals(report.amount))
      throw new WorkflowError(
        "CONTRIBUTION_LEDGER_MISMATCH",
        "Catatan setoran tidak sesuai. Hubungi Admin untuk pemeriksaan.",
      );
    const contribution = await memberContribution(
      tx,
      report.familyId,
      report.userId,
    );
    if (contribution.available.lt(report.amount))
      throw new WorkflowError(
        "CONTRIBUTION_CORRECTION_BLOCKED",
        "Setoran sudah ditarik atau dicadangkan untuk pengajuan. Selesaikan pengajuan dan pulihkan kontribusi sebelum melakukan koreksi.",
      );
    await postLedger(tx, {
      familyId: report.familyId,
      createdById: actor.sub,
      ownerUserId: report.userId,
      type: "CONTRIBUTION_REVERSAL",
      direction: "OUT",
      amount: report.amount,
      description: `Koreksi setoran: ${report.purpose}. Alasan: ${reason}`,
      referenceType: "CONTRIBUTION_REVERSAL",
      referenceId: id,
    });
    const result = await tx.contributionReport.update({
      where: { id },
      data: {
        status: "REVERSED",
        reversedById: actor.sub,
        reversedAt: new Date(),
        reversalReason: reason,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        familyId: report.familyId,
        action: "CONTRIBUTION_REVERSED",
        entityType: "ContributionReport",
        entityId: id,
        before: { status: "CONFIRMED", ledgerEntryId: original.id },
        after: { status: "REVERSED", amount: report.amount.toString(), reason },
      },
    });
    await enqueue(tx, {
      eventKey: `CONTRIBUTION_REVERSED:${id}`,
      familyId: report.familyId,
      userId: report.userId,
      kind: "CONTRIBUTION_REVERSED",
      view: "cash",
      body: `Setoran ${money(report.amount)} dikoreksi pengelola dana. Kas dan kontribusi dikurangi sebesar nominal tersebut. Alasan: ${reason}. Koreksi ini merupakan pencatatan aplikasi; pengembalian uang melalui bank ditangani pengelola dana.`,
    });
    return result;
  });
}

export async function reviewContribution(
  actor: WorkflowActor,
  id: string,
  decision: "confirm" | "reject",
  notes: string,
) {
  notes = notes.trim();
  if (decision === "reject" && notes.length < 5)
    throw new WorkflowError(
      "REJECTION_REASON_REQUIRED",
      "Isi alasan penolakan minimal 5 karakter.",
      400,
    );
  return prisma.$transaction(async (tx) => {
    const current = await authorizeFamily(tx, actor, ["TREASURER"]);
    const report = await tx.contributionReport.findFirst({
      where: { id, familyId: current.familyId },
    });
    if (!report)
      throw new WorkflowError(
        "CONTRIBUTION_NOT_FOUND",
        "Laporan setoran tidak ditemukan.",
        404,
      );
    if (report.userId === actor.sub)
      throw new WorkflowError(
        "SELF_CONFIRMATION_NOT_ALLOWED",
        "Setoran sendiri harus diperiksa pengelola dana lain.",
        403,
      );
    const status = decision === "confirm" ? "CONFIRMED" : "REJECTED";
    if (report.status === status) return report;
    if (report.status !== "PENDING")
      throw new WorkflowError(
        "CONTRIBUTION_ALREADY_REVIEWED",
        "Laporan setoran sudah diperiksa.",
      );
    const result = await tx.contributionReport.update({
      where: { id, status: "PENDING" },
      data: {
        status,
        reviewedById: actor.sub,
        reviewedAt: new Date(),
        reviewNotes:
          notes || "Dana masuk sudah diperiksa pada rekening keluarga.",
      },
    });
    if (decision === "confirm")
      await postLedger(tx, {
        familyId: report.familyId,
        createdById: actor.sub,
        ownerUserId: report.userId,
        type: "CONTRIBUTION",
        direction: "IN",
        amount: report.amount,
        description: report.purpose,
        referenceType: "CONTRIBUTION_REPORT",
        referenceId: report.id,
      });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        familyId: report.familyId,
        action: `CONTRIBUTION_${status}`,
        entityType: "ContributionReport",
        entityId: report.id,
        before: { status: "PENDING" },
        after: {
          status,
          amount: report.amount.toString(),
          notes: result.reviewNotes,
        },
      },
    });
    await enqueue(tx, {
      eventKey: `CONTRIBUTION_${status}:${report.id}`,
      userId: report.userId,
      familyId: report.familyId,
      kind: decision === "confirm" ? "CONTRIBUTION" : "CONTRIBUTION_REJECTED",
      view: "cash",
      body:
        decision === "confirm"
          ? `Setoran ${money(report.amount)} dikonfirmasi pengelola dana. Kas dan kontribusi Anda sudah bertambah.`
          : `Laporan setoran ${money(report.amount)} ditolak. Alasan: ${notes}. Kas dan kontribusi Anda belum berubah.`,
    });
    return result;
  });
}
