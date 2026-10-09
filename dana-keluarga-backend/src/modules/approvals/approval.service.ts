import { queueEmail } from "../email/email.service";
import { formatMoney } from "../../utils/money";
import { env } from "../../config/env";
import {
  cashBalance,
  reservedCash,
  lockFamily,
  postLedger,
} from "../cash/ledger.service";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { generateInstallments } from "../../utils/installments";
import {
  WorkflowError,
  assertAssignedActor,
  requireOperationalActor,
  type WorkflowActor,
} from "./approval.rules";
import { queueLoanEvent } from "../notifications/notification.service";
import { publicPerson } from "./approval-policy.service";

type Tx = Prisma.TransactionClient;
export const requestInclude = {
  maker: { select: publicPerson },
  policy: { select: { version: true } },
  steps: {
    orderBy: { sequence: "asc" as const },
    include: { assignedUser: { select: publicPerson } },
  },
  actions: {
    orderBy: { actedAt: "asc" as const },
    include: { actor: { select: publicPerson } },
  },
  loan: {
    select: {
      id: true,
      purpose: true,
      status: true,
      tenorMonths: true,
      fundRequest: true,
    },
  },
};

async function notify(
  tx: Tx,
  userId: string,
  familyId: string,
  title: string,
  message: string,
  requestId: string,
) {
  const detail = await tx.approvalRequest.findUnique({
    where: { id: requestId },
    include: {
      loan: {
        include: { borrower: { select: { name: true } }, fundRequest: true },
      },
    },
  });
  const loan = detail?.loan;
  const fund = loan?.fundRequest;
  const body = `${message}${loan ? ` Pemohon: ${loan.borrower.name}. Total permintaan ${formatMoney(fund?.amount ?? loan.principalAmount)}; tarikan sendiri ${formatMoney(fund?.withdrawalAmount ?? 0)}; pinjaman ${formatMoney(loan.principalAmount)}. Tujuan: ${loan.purpose}. Tanggal: ${loan.requestedAt.toISOString()}.` : ""} ${(env.PUBLIC_APP_URL ?? env.FRONTEND_URL).replace(/\/$/, "")}/?view=approvals&request=${requestId}`;
  await queueEmail(tx, {
    eventKey: `APPROVAL:${requestId}:${userId}:${detail?.currentStep}:${title}`,
    userId,
    familyId,
    subject: title,
    body,
  });
  await tx.notification.create({
    data: {
      userId,
      familyId,
      type: "GENERAL",
      title,
      message: body,
      metadata: { approvalRequestId: requestId, view: "approvals" },
    },
  });
}
async function audit(
  tx: Tx,
  requestId: string,
  familyId: string,
  actorId: string,
  action: string,
  notes?: string,
) {
  await tx.auditLog.create({
    data: {
      actorId,
      familyId,
      action,
      entityType: "ApprovalRequest",
      entityId: requestId,
      after: { notes: notes ?? null },
    },
  });
}

export async function createLoanApproval(
  tx: Tx,
  actor: WorkflowActor,
  loan: {
    id: string;
    familyId: string;
    borrowerId: string;
    principalAmount: Prisma.Decimal;
  },
) {
  requireOperationalActor(actor, loan.familyId);
  // Configuration updates and new submissions share the family lock.
  await tx.$queryRaw`SELECT id FROM "Family" WHERE id = ${loan.familyId}::uuid FOR UPDATE`;
  const policy = await tx.approvalPolicy.findFirst({
    where: { familyId: loan.familyId, transactionType: "LOAN", active: true },
    include: { assignments: { orderBy: { sequence: "asc" } } },
  });
  if (!policy)
    throw new WorkflowError(
      "WORKFLOW_NOT_CONFIGURED",
      "Hirarki pinjaman belum diatur. Hubungi Admin keluarga atau Super Admin.",
    );
  if (
    !policy.assignments.some(
      (item) => item.permission === "MAKER" && item.userId === actor.sub,
    )
  )
    throw new WorkflowError(
      "NOT_ASSIGNED_AS_MAKER",
      "Anda belum ditetapkan sebagai Maker untuk keluarga ini.",
      403,
    );
  const stages = policy.assignments.filter(
    (item) => item.permission !== "MAKER",
  );
  if (
    stages.length < 2 ||
    stages.at(-1)?.permission !== "RELEASER" ||
    stages.slice(0, -1).some((item) => item.permission !== "APPROVER") ||
    new Set(stages.map((item) => item.userId)).size !== stages.length
  )
    throw new WorkflowError(
      "WORKFLOW_INVALID",
      "Hirarki harus berisi approver berurutan dan satu releaser berbeda.",
    );
  if (
    stages.some(
      (item) => item.userId === actor.sub || item.userId === loan.borrowerId,
    )
  )
    throw new WorkflowError(
      "SELF_APPROVAL_NOT_ALLOWED",
      "Pembuat/peminjam tidak boleh menjadi approver atau releaser pada pengajuan yang sama. Perbaiki hirarki terlebih dahulu.",
      403,
    );
  const ids = stages.map((item) => item.userId);
  const active = await tx.familyMember.count({
    where: {
      familyId: loan.familyId,
      userId: { in: ids },
      status: "ACTIVE",
      user: { isActive: true, systemRole: "USER" },
    },
  });
  if (active !== new Set(ids).size)
    throw new WorkflowError(
      "INACTIVE_WORKFLOW_ACTOR",
      "Ada petugas hirarki yang tidak aktif. Hubungi Admin.",
    );
  const request = await tx.approvalRequest.create({
    data: {
      familyId: loan.familyId,
      policyId: policy.id,
      referenceId: loan.id,
      makerId: actor.sub,
      amount: loan.principalAmount,
      steps: {
        create: stages.map((item, index) => ({
          sequence: index + 1,
          permission: item.permission,
          assignedUserId: item.userId,
        })),
      },
      actions: {
        create: {
          step: 0,
          actorId: actor.sub,
          action: "SUBMIT",
          afterStatus: "PENDING_APPROVAL",
        },
      },
    },
  });
  await tx.loan.update({
    where: { id: loan.id },
    data: { approvalRequestId: request.id },
  });
  await audit(tx, request.id, loan.familyId, actor.sub, "LOAN_SUBMITTED");
  await queueLoanEvent(tx, loan.id, "LOAN_REQUESTED", false);
  if (actor.sub !== loan.borrowerId)
    await notify(
      tx,
      actor.sub,
      loan.familyId,
      "Pengajuan pinjaman diterima",
      "Pengajuan menunggu persetujuan sesuai hirarki keluarga.",
      request.id,
    );
  await notify(
    tx,
    stages[0].userId,
    loan.familyId,
    "Tugas persetujuan baru",
    "Ada pengajuan pinjaman yang menunggu keputusan Anda pada tahap 1.",
    request.id,
  );
  return request;
}

export async function actOnRequest(
  actor: WorkflowActor,
  id: string,
  action: "APPROVE" | "REJECT" | "RETURN" | "RELEASE",
  notes?: string,
) {
  if (!actor.familyId)
    throw new WorkflowError(
      "FAMILY_REQUIRED",
      "Pilih keluarga aktif terlebih dahulu.",
      403,
    );
  requireOperationalActor(actor, actor.familyId);
  return prisma.$transaction(async (tx) => {
    await lockFamily(tx, actor.familyId!);
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "ApprovalRequest" WHERE id = ${id}::uuid AND "familyId" = ${actor.familyId}::uuid FOR UPDATE`;
    if (!rows.length)
      throw new WorkflowError(
        "REQUEST_NOT_FOUND",
        "Pengajuan tidak ditemukan.",
        404,
      );
    const request = await tx.approvalRequest.findUniqueOrThrow({
      where: { id },
      include: {
        steps: { orderBy: { sequence: "asc" } },
        loan: { include: { fundRequest: true } },
      },
    });
    const completed = await tx.approvalAction.findFirst({
      where: { requestId: id, actorId: actor.sub, action },
    });
    if (completed && (action === "APPROVE" || action === "RELEASE"))
      return tx.approvalRequest.findUniqueOrThrow({
        where: { id },
        include: requestInclude,
      });
    const step = request.steps.find(
      (item) => item.sequence === request.currentStep,
    );
    if (
      !step ||
      !["PENDING_APPROVAL", "PENDING_RELEASE"].includes(request.status) ||
      step.status !== "WAITING"
    )
      throw new WorkflowError(
        "REQUEST_ALREADY_PROCESSED",
        "Pengajuan tidak lagi menunggu tindakan ini.",
      );
    const expected =
      request.status === "PENDING_APPROVAL" ? "APPROVER" : "RELEASER";
    if (
      (action === "RELEASE") !== (expected === "RELEASER") ||
      step.permission !== expected
    )
      throw new WorkflowError(
        "INVALID_WORKFLOW_ACTION",
        "Tindakan tidak sesuai tahap yang sedang berjalan.",
      );
    assertAssignedActor(
      actor.sub,
      request.makerId,
      step.assignedUserId,
      expected,
      request.steps
        .filter((item) => item.permission === "APPROVER")
        .map((item) => item.assignedUserId),
    );
    const member = await tx.familyMember.findUnique({
      where: {
        familyId_userId: { familyId: request.familyId, userId: actor.sub },
      },
      include: { user: { select: { isActive: true, systemRole: true } } },
    });
    if (
      member?.status !== "ACTIVE" ||
      !member.user.isActive ||
      member.user.systemRole === "SUPER_ADMIN"
    )
      throw new WorkflowError(
        "NOT_ACTIVE_MEMBER",
        "Petugas bukan anggota aktif keluarga ini.",
        403,
      );
    const loan = request.loan;
    if (
      !loan ||
      loan.familyId !== request.familyId ||
      !loan.principalAmount.equals(request.amount)
    )
      throw new WorkflowError(
        "REQUEST_DATA_CHANGED",
        "Data pinjaman tidak sesuai snapshot pengajuan.",
      );
    if (actor.sub === loan.borrowerId)
      throw new WorkflowError(
        "SELF_APPROVAL_NOT_ALLOWED",
        "Peminjam tidak boleh memutuskan atau mencairkan pinjamannya sendiri.",
        403,
      );
    const fund = loan.fundRequest;
    if (action === "APPROVE" || action === "RELEASE") {
      const available = (await cashBalance(tx, loan.familyId)).sub(
        await reservedCash(tx, loan.familyId, fund?.id),
      );
      if (available.lt(fund?.amount ?? loan.principalAmount))
        throw new WorkflowError(
          "INSUFFICIENT_FAMILY_CASH",
          "Saldo Kas Keluarga tidak mencukupi untuk transaksi ini.",
        );
    }
    const now = new Date();
    if (action === "RELEASE") {
      if (
        loan.status !== "APPROVED" ||
        request.steps.some(
          (item) =>
            item.permission === "APPROVER" && item.status !== "APPROVED",
        )
      )
        throw new WorkflowError(
          "REQUEST_NOT_APPROVED",
          "Seluruh tahap persetujuan harus selesai sebelum pencairan.",
        );
      const borrower = await tx.familyMember.findUnique({
        where: {
          familyId_userId: { familyId: loan.familyId, userId: loan.borrowerId },
        },
        include: { user: { select: { isActive: true, name: true } } },
      });
      if (borrower?.status !== "ACTIVE" || !borrower.user.isActive)
        throw new WorkflowError(
          "MEMBER_NOT_FOUND",
          "Peminjam tidak lagi aktif.",
        );
      const installments = generateInstallments(
        BigInt(request.amount.toFixed(0)),
        loan.tenorMonths,
        now,
        1,
      );
      await tx.loan.update({
        where: { id: loan.id, status: "APPROVED" },
        data: { status: "ACTIVE", disbursedAt: now },
      });
      await tx.loanInstallment.createMany({
        data: installments.map((item) => ({
          loanId: loan.id,
          installmentNumber: item.installmentNumber,
          dueDate: item.dueDate,
          principalAmount: item.principalAmount.toString(),
          remainingAmount: item.remainingAmount.toString(),
        })),
      });
      if (fund && fund.withdrawalAmount.gt(0)) {
        await postLedger(
          tx,
          {
            familyId: loan.familyId,
            type: "WITHDRAWAL",
            direction: "OUT",
            amount: fund.withdrawalAmount,
            ownerUserId: loan.borrowerId,
            createdById: actor.sub,
            description: fund.purpose,
            referenceType: "FUND_REQUEST",
            referenceId: fund.id,
          },
          fund.id,
        );
      }
      await postLedger(
        tx,
        {
          familyId: loan.familyId,
          type: "LOAN_DISBURSEMENT",
          direction: "OUT",
          amount: request.amount,
          createdById: actor.sub,
          description: `Pencairan pinjaman untuk ${borrower.user.name}`,
          referenceType: "LOAN",
          referenceId: loan.id,
        },
        fund?.id,
      );
      if (fund)
        await tx.fundRequest.update({
          where: { id: fund.id },
          data: { status: "ACTIVE" },
        });
      await tx.approvalStep.update({
        where: { id: step.id },
        data: { status: "RELEASED", actedAt: now },
      });
      await tx.approvalRequest.update({
        where: { id },
        data: { status: "RELEASED", completedAt: now },
      });
      await queueLoanEvent(tx, loan.id, "LOAN_DISBURSED");
    } else if (action === "APPROVE") {
      if (loan.status !== "PENDING")
        throw new WorkflowError(
          "REQUEST_ALREADY_PROCESSED",
          "Status pinjaman sudah berubah.",
        );
      const next = request.steps.find(
        (item) => item.sequence === step.sequence + 1,
      );
      if (!next)
        throw new WorkflowError(
          "WORKFLOW_INVALID",
          "Tahap releaser tidak ditemukan.",
        );
      await tx.approvalStep.update({
        where: { id: step.id },
        data: { status: "APPROVED", actedAt: now },
      });
      await tx.approvalRequest.update({
        where: { id },
        data: {
          currentStep: next.sequence,
          status:
            next.permission === "RELEASER"
              ? "PENDING_RELEASE"
              : "PENDING_APPROVAL",
        },
      });
      if (next.permission === "RELEASER") {
        await tx.loan.update({
          where: { id: loan.id },
          data: {
            status: "APPROVED",
            approvedById: actor.sub,
            approvedAt: now,
          },
        });
        if (fund)
          await tx.fundRequest.update({
            where: { id: fund.id },
            data: { status: "APPROVED" },
          });
        await queueLoanEvent(tx, loan.id, "LOAN_APPROVED");
      }
      await notify(
        tx,
        next.assignedUserId,
        loan.familyId,
        next.permission === "RELEASER"
          ? "Tugas pencairan baru"
          : "Tugas persetujuan baru",
        `Pengajuan menunggu tindakan Anda pada tahap ${next.sequence}.`,
        id,
      );
    } else {
      if (loan.status !== "PENDING")
        throw new WorkflowError(
          "REQUEST_ALREADY_PROCESSED",
          "Status pinjaman sudah berubah.",
        );
      if (!notes?.trim())
        throw new WorkflowError(
          "NOTE_REQUIRED",
          "Alasan penolakan atau pengembalian wajib diisi.",
          400,
        );
      await tx.approvalStep.update({
        where: { id: step.id },
        data: {
          status: action === "REJECT" ? "REJECTED" : "RETURNED",
          actedAt: now,
        },
      });
      await tx.approvalRequest.update({
        where: { id },
        data: {
          status: action === "REJECT" ? "REJECTED" : "RETURNED",
          completedAt: now,
        },
      });
      await tx.loan.update({
        where: { id: loan.id },
        data: {
          status: action === "REJECT" ? "REJECTED" : "CANCELLED",
          rejectedById: actor.sub,
          rejectedAt: now,
          rejectionReason: notes,
        },
      });
      if (fund)
        await tx.fundRequest.update({
          where: { id: fund.id },
          data: { status: action === "REJECT" ? "REJECTED" : "CANCELLED" },
        });
      if (action === "REJECT")
        await queueLoanEvent(tx, loan.id, "LOAN_REJECTED");
      if (action === "RETURN" || request.makerId !== loan.borrowerId)
        await notify(
          tx,
          request.makerId,
          request.familyId,
          action === "REJECT" ? "Pengajuan ditolak" : "Pengajuan dikembalikan",
          `${notes}${action === "RETURN" ? " Silakan ajukan kembali data yang sudah diperbaiki." : ""}`,
          id,
        );
    }
    await tx.approvalAction.create({
      data: {
        requestId: id,
        step: step.sequence,
        actorId: actor.sub,
        action,
        beforeStatus: request.status,
        afterStatus:
          action === "RELEASE"
            ? "RELEASED"
            : action === "REJECT"
              ? "REJECTED"
              : action === "RETURN"
                ? "RETURNED"
                : request.steps.find(
                      (item) => item.sequence === step.sequence + 1,
                    )?.permission === "RELEASER"
                  ? "PENDING_RELEASE"
                  : "PENDING_APPROVAL",
        notes,
      },
    });
    await audit(tx, id, request.familyId, actor.sub, `LOAN_${action}`, notes);
    return tx.approvalRequest.findUniqueOrThrow({
      where: { id },
      include: requestInclude,
    });
  });
}

// An explicit, audited exception to the immutable policy snapshot. Only the
// current waiting step may move; completed decisions and monetary data stay fixed.
export async function reassignRequest(
  actor: WorkflowActor,
  id: string,
  input: { userId: string; expectedAssignedUserId: string; reason: string },
) {
  requireOperationalActor(actor, actor.familyId ?? "");
  if (actor.familyRole !== "ADMIN")
    throw new WorkflowError(
      "FORBIDDEN",
      "Hanya Admin keluarga dapat mengganti petugas.",
      403,
    );
  return prisma.$transaction(async (tx) => {
    await lockFamily(tx, actor.familyId!);
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "ApprovalRequest" WHERE id = ${id}::uuid AND "familyId" = ${actor.familyId}::uuid FOR UPDATE`;
    if (!rows.length)
      throw new WorkflowError(
        "REQUEST_NOT_FOUND",
        "Pengajuan tidak ditemukan.",
        404,
      );
    const request = await tx.approvalRequest.findUniqueOrThrow({
      where: { id },
      include: { steps: true, loan: true },
    });
    const step = request.steps.find(
      (item) => item.sequence === request.currentStep,
    );
    if (
      !step ||
      step.status !== "WAITING" ||
      !["PENDING_APPROVAL", "PENDING_RELEASE"].includes(request.status)
    )
      throw new WorkflowError(
        "REQUEST_ALREADY_PROCESSED",
        "Tahap ini tidak lagi menunggu petugas.",
      );
    if (step.assignedUserId !== input.expectedAssignedUserId)
      throw new WorkflowError(
        "ASSIGNMENT_CHANGED",
        "Petugas sudah berubah. Muat ulang pengajuan.",
      );
    if (
      input.userId === request.makerId ||
      input.userId === request.loan?.borrowerId ||
      request.steps.some((item) => item.assignedUserId === input.userId)
    )
      throw new WorkflowError(
        "INVALID_REPLACEMENT",
        "Petugas pengganti harus berbeda dari pemohon dan seluruh petugas lainnya.",
      );
    const member = await tx.familyMember.findUnique({
      where: {
        familyId_userId: { familyId: request.familyId, userId: input.userId },
      },
      include: {
        user: { select: { isActive: true, systemRole: true, name: true } },
      },
    });
    if (
      member?.status !== "ACTIVE" ||
      !member.user.isActive ||
      member.user.systemRole === "SUPER_ADMIN"
    )
      throw new WorkflowError(
        "NOT_ACTIVE_MEMBER",
        "Pilih anggota aktif keluarga ini.",
        403,
      );
    await tx.approvalStep.update({
      where: { id: step.id },
      data: { assignedUserId: input.userId },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        familyId: request.familyId,
        action: "APPROVAL_STEP_REASSIGNED",
        entityType: "ApprovalRequest",
        entityId: id,
        before: { step: step.sequence, assignedUserId: step.assignedUserId },
        after: {
          step: step.sequence,
          assignedUserId: input.userId,
          name: member.user.name,
          reason: input.reason,
        },
      },
    });
    await notify(
      tx,
      input.userId,
      request.familyId,
      "Tugas pengajuan dialihkan kepada Anda",
      `Anda ditunjuk sebagai ${step.permission === "RELEASER" ? "petugas pencairan" : "petugas persetujuan"} tahap ${step.sequence}. Alasan: ${input.reason}`,
      id,
    );
    return tx.approvalRequest.findUniqueOrThrow({
      where: { id },
      include: requestInclude,
    });
  });
}
