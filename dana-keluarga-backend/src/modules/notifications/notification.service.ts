import { queueEmail } from "../email/email.service";
import { formatMoney } from "../../utils/money";
import { Prisma, NotificationType } from "@prisma/client";
import { env } from "../../config/env";
import { wibDay } from "../../utils/calendar";

type Tx = Prisma.TransactionClient;
export const money = formatMoney;
export const installmentLink = (id: string) =>
  `${(env.PUBLIC_APP_URL ?? env.FRONTEND_URL).replace(/\/$/, "")}/?installment=${encodeURIComponent(id)}`;
const loansLink = () =>
  `${(env.PUBLIC_APP_URL ?? env.FRONTEND_URL).replace(/\/$/, "")}/?view=loans`;

export async function enqueue(
  tx: Tx,
  data: {
    eventKey: string;
    userId: string;
    familyId: string;
    kind: string;
    body: string;
    installmentId?: string;
    view?: "cash" | "loans";
  },
) {
  const titles: Record<string, string> = {
    CONTRIBUTION: "Setoran dikonfirmasi",
    CONTRIBUTION_PENDING: "Setoran menunggu pemeriksaan",
    CONTRIBUTION_REPORTED: "Laporan setoran baru",
    CONTRIBUTION_REJECTED: "Laporan setoran ditolak",
    CONTRIBUTION_REVERSED: "Setoran dikoreksi",
    PAYMENT_REVERSED: "Pembayaran dikoreksi",
    WITHDRAWAL: "Tarikan dicatat",
    LOAN_REQUESTED: "Pengajuan pinjaman",
    LOAN_APPROVED: "Pinjaman disetujui",
    LOAN_REJECTED: "Pengajuan ditolak",
    LOAN_DISBURSED: "Pencairan dicatat",
    INSTALLMENT_DUE: "Pengingat cicilan",
    PAYMENT_SUCCESS: "Pembayaran berhasil",
    PAYMENT_REPORTED: "Transfer cicilan menunggu pemeriksaan",
    PAYMENT_REJECTED: "Laporan transfer belum dapat diterima",
    LOAN_PAID_OFF: "Pinjaman lunas",
  };
  const type = Object.values(NotificationType).includes(
    data.kind as NotificationType,
  )
    ? (data.kind as NotificationType)
    : NotificationType.GENERAL;
  const inserted = await queueEmail(
    tx,
    {
      eventKey: data.eventKey,
      userId: data.userId,
      familyId: data.familyId,
      subject: titles[data.kind] ?? "Pemberitahuan keluarga",
      body: data.body,
    },
    data.kind,
  );
  if (inserted.count) {
    await tx.notification.create({
      data: {
        userId: data.userId,
        familyId: data.familyId,
        type,
        title: titles[data.kind] ?? "Pemberitahuan keluarga",
        message: data.body,
        metadata: {
          eventKey: data.eventKey,
          ...(data.installmentId
            ? { installmentId: data.installmentId }
            : { view: data.view ?? "loans" }),
        },
      },
    });
  }
}

export async function queueLoanEvent(
  tx: Tx,
  loanId: string,
  kind: "LOAN_REQUESTED" | "LOAN_APPROVED" | "LOAN_REJECTED" | "LOAN_DISBURSED",
  notifyManagers = true,
) {
  const loan = await tx.loan.findUniqueOrThrow({
    where: { id: loanId },
    include: {
      borrower: true,
      fundRequest: true,
      rejectedBy: { select: { name: true } },
      family: true,
      installments: { orderBy: { installmentNumber: "asc" } },
    },
  });
  const prefix = `[${loan.family.name}] Halo ${loan.borrower.name}, `;
  let body: string;
  if (kind === "LOAN_REQUESTED")
    body = `${prefix}pengajuan ${money(loan.principalAmount)} (${loan.tenorMonths} bulan) diterima dan menunggu persetujuan. ${loansLink()}`;
  else if (kind === "LOAN_APPROVED")
    body = `${prefix}pengajuan ${money(loan.principalAmount)} disetujui, menunggu pencairan. Jadwal cicilan akan tersedia setelah pencairan dicatat. ${loansLink()}`;
  else if (kind === "LOAN_REJECTED")
    body = `${prefix}pengajuan belum disetujui. Alasan: ${loan.rejectionReason ?? "Silakan hubungi pengelola"}. ${loansLink()}`;
  else {
    const first = loan.installments[0];
    body = `${prefix}pencairan ${money(loan.principalAmount)} telah dicatat. Tenor ${loan.tenorMonths} bulan, bunga 0%. Cicilan pertama ${money(first.principalAmount)}, jatuh tempo ${wibDay(first.dueDate)}. Lihat seluruh jadwal: ${installmentLink(first.id)}`;
  }
  if (loan.fundRequest)
    body += ` Total permintaan ${money(loan.fundRequest.amount)}; tarikan sendiri ${money(loan.fundRequest.withdrawalAmount)}; pinjaman ${money(loan.fundRequest.loanAmount)}. Tujuan: ${loan.purpose}. Diajukan ${wibDay(loan.requestedAt)}.`;
  if (kind === "LOAN_REJECTED" && loan.rejectedBy)
    body += ` Ditolak oleh ${loan.rejectedBy.name}.`;
  await enqueue(tx, {
    eventKey: `${kind}:${loan.id}:${loan.borrowerId}`,
    familyId: loan.familyId,
    userId: loan.borrowerId,
    kind,
    body,
  });
  if (kind === "LOAN_REQUESTED" && notifyManagers) {
    const managers = await tx.familyMember.findMany({
      where: {
        familyId: loan.familyId,
        status: "ACTIVE",
        role: { in: ["ADMIN", "TREASURER"] },
        user: { isActive: true },
      },
    });
    for (const manager of managers) {
      if (manager.userId === loan.borrowerId) continue;
      await enqueue(tx, {
        eventKey: `${kind}:${loan.id}:${manager.userId}`,
        familyId: loan.familyId,
        userId: manager.userId,
        kind,
        body: `[${loan.family.name}] Pengajuan baru dari ${loan.borrower.name} sebesar ${money(loan.principalAmount)}. Periksa dashboard: ${loansLink()}`,
      });
    }
  }
}

export async function cancelReminders(
  tx: Tx,
  installmentId: string,
  reason = "Cicilan sudah lunas",
) {
  await tx.emailMessage.updateMany({
    where: {
      eventKey: { startsWith: `INSTALLMENT_DUE:${installmentId}:` },
      status: { in: ["QUEUED", "PROCESSING", "FAILED"] },
    },
    data: {
      status: "CANCELLED",
      completedAt: new Date(),
      lockedAt: null,
      lastError: reason,
    },
  });
}
