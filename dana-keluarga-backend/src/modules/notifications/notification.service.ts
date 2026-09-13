import { Prisma, NotificationType } from '@prisma/client';
import { env } from '../../config/env';
import { wibDay } from '../../utils/calendar';

type Tx = Prisma.TransactionClient;
export const money = (amount: Prisma.Decimal | number | string) =>
  `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(amount))}`;
export const installmentLink = (id: string) =>
  `${env.FRONTEND_URL.replace(/\/$/, '')}/?installment=${encodeURIComponent(id)}`;
const loansLink = () => `${env.FRONTEND_URL.replace(/\/$/, '')}/?view=loans`;

export async function enqueue(
  tx: Tx,
  data: {
    eventKey: string;
    userId: string;
    familyId: string;
    kind: string;
    body: string;
    installmentId?: string;
  },
) {
  // createMany/skipDuplicates is safe under concurrent workers (unlike read-then-create).
  const recipient = await tx.user.findUnique({
    where: { id: data.userId },
    select: { whatsappOptInAt: true },
  });
  const reason =
    env.WHATSAPP_MODE === 'disabled'
      ? 'Pemrosesan WhatsApp dinonaktifkan'
      : !recipient?.whatsappOptInAt
        ? 'Penerima belum menyetujui notifikasi WhatsApp saat kejadian'
        : null;
  const inserted = await tx.whatsAppMessage.createMany({
    data: [
      {
        ...data,
        ...(reason
          ? {
              status: 'CANCELLED' as const,
              lastError: reason,
              completedAt: new Date(),
            }
          : {}),
      },
    ],
    skipDuplicates: true,
  });
  // In-app notifications do not depend on WhatsApp consent or delivery success.
  // The outbox's unique event key also makes the inbox write idempotent.
  if (inserted.count) {
    const titles: Record<string, string> = {
      LOAN_REQUESTED: 'Pengajuan pinjaman',
      LOAN_APPROVED: 'Pinjaman disetujui',
      LOAN_REJECTED: 'Pengajuan ditolak',
      LOAN_DISBURSED: 'Pencairan dicatat',
      INSTALLMENT_DUE: 'Pengingat cicilan',
      PAYMENT_SUCCESS: 'Pembayaran berhasil',
      LOAN_PAID_OFF: 'Pinjaman lunas',
    };
    const type = Object.values(NotificationType).includes(
      data.kind as NotificationType,
    )
      ? (data.kind as NotificationType)
      : NotificationType.GENERAL;
    await tx.notification.create({
      data: {
        userId: data.userId,
        familyId: data.familyId,
        type,
        title: titles[data.kind] ?? 'Pemberitahuan keluarga',
        message: data.body,
        metadata: {
          eventKey: data.eventKey,
          ...(data.installmentId
            ? { installmentId: data.installmentId }
            : { view: 'loans' }),
        },
      },
    });
  }
}

export async function queueLoanEvent(
  tx: Tx,
  loanId: string,
  kind: 'LOAN_REQUESTED' | 'LOAN_APPROVED' | 'LOAN_REJECTED' | 'LOAN_DISBURSED',
) {
  const loan = await tx.loan.findUniqueOrThrow({
    where: { id: loanId },
    include: {
      borrower: true,
      family: true,
      installments: { orderBy: { installmentNumber: 'asc' } },
    },
  });
  const prefix = `[${loan.family.name}] Halo ${loan.borrower.name}, `;
  let body: string;
  if (kind === 'LOAN_REQUESTED')
    body = `${prefix}pengajuan ${money(loan.principalAmount)} (${loan.tenorMonths} bulan) diterima dan menunggu persetujuan. ${loansLink()}`;
  else if (kind === 'LOAN_APPROVED')
    body = `${prefix}pengajuan ${money(loan.principalAmount)} disetujui, menunggu pencairan. Jadwal cicilan akan tersedia setelah pencairan dicatat. ${loansLink()}`;
  else if (kind === 'LOAN_REJECTED')
    body = `${prefix}pengajuan belum disetujui. Alasan: ${loan.rejectionReason ?? 'Silakan hubungi pengelola'}. ${loansLink()}`;
  else {
    const first = loan.installments[0];
    body = `${prefix}pencairan ${money(loan.principalAmount)} telah dicatat. Tenor ${loan.tenorMonths} bulan, bunga 0%. Cicilan pertama ${money(first.principalAmount)}, jatuh tempo ${wibDay(first.dueDate)}. Lihat seluruh jadwal: ${installmentLink(first.id)}`;
  }
  await enqueue(tx, {
    eventKey: `${kind}:${loan.id}:${loan.borrowerId}`,
    familyId: loan.familyId,
    userId: loan.borrowerId,
    kind,
    body,
  });
  if (kind === 'LOAN_REQUESTED') {
    const managers = await tx.familyMember.findMany({
      where: {
        familyId: loan.familyId,
        status: 'ACTIVE',
        role: { in: ['ADMIN', 'TREASURER'] },
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

export async function cancelReminders(tx: Tx, installmentId: string) {
  await tx.whatsAppMessage.updateMany({
    where: {
      installmentId,
      kind: 'INSTALLMENT_DUE',
      status: { in: ['QUEUED', 'PROCESSING', 'FAILED'] },
    },
    data: {
      status: 'CANCELLED',
      completedAt: new Date(),
      lockedAt: null,
      lastError: 'Cicilan sudah lunas',
    },
  });
}
