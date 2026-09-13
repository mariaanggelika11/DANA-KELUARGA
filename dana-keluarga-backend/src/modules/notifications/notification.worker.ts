import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { daysUntil, wibDay, wibHour } from '../../utils/calendar';
import { enqueue, installmentLink, money } from './notification.service';

export function reminderStage(due: Date, now: Date, hour = env.REMINDER_HOUR_WIB) {
  if (wibHour(now) < hour) return null;
  const days = daysUntil(due, now);
  return days === 3 ? 'H-3' : days === 0 ? 'H' : null;
}

export async function scheduleReminders(now = new Date()) {
  // Bound the query to today's due date and H-3 candidates, independent of host timezone.
  const start = new Date(`${wibDay(now)}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 4 * 86400000);
  await prisma.loanInstallment.updateMany({ where: { dueDate: { lt: start }, status: { in: ['UNPAID', 'PARTIAL'] }, loan: { status: 'ACTIVE' } }, data: { status: 'OVERDUE' } });
  if (env.WHATSAPP_MODE === 'disabled' || wibHour(now) < env.REMINDER_HOUR_WIB) return;
  const installments = await prisma.loanInstallment.findMany({ where: { dueDate: { gte: start, lt: end }, status: { not: 'PAID' }, remainingAmount: { gt: 0 }, loan: { status: 'ACTIVE' } }, include: { loan: { include: { borrower: true, family: true } } } });
  for (const item of installments) {
    const stage = reminderStage(item.dueDate, now);
    if (!stage) continue;
    await prisma.$transaction(async (tx) => {
      await enqueue(tx, { eventKey: `INSTALLMENT_DUE:${item.id}:${wibDay(item.dueDate)}:${stage}`, kind: 'INSTALLMENT_DUE', installmentId: item.id,
        familyId: item.loan.familyId, userId: item.loan.borrowerId,
        body: `[${item.loan.family.name}] Halo ${item.loan.borrower.name}, cicilan ke-${item.installmentNumber} sebesar ${money(item.remainingAmount)} jatuh tempo ${wibDay(item.dueDate)}. Lihat rincian: ${installmentLink(item.id)}` });
    });
  }
}

export async function processMessages(now = new Date()) {
  if (env.WHATSAPP_MODE === 'disabled') return;
  // Recover leases after a crashed process. No external message delivery exists in simulation.
  await prisma.whatsAppMessage.updateMany({ where: { status: 'PROCESSING', lockedAt: { lt: new Date(now.getTime() - 300000) } }, data: { status: 'QUEUED', lockedAt: null } });
  const batch = await prisma.whatsAppMessage.findMany({ where: { status: 'QUEUED', nextAttemptAt: { lte: now } }, orderBy: { createdAt: 'asc' }, take: 50 });
  for (const message of batch) {
    const claim = await prisma.whatsAppMessage.updateMany({ where: { id: message.id, status: 'QUEUED' }, data: { status: 'PROCESSING', lockedAt: now, attempts: { increment: 1 } } });
    if (!claim.count) continue;
    try {
      await prisma.$transaction(async (tx) => {
        const recipient = await tx.user.findUnique({ where: { id: message.userId }, include: { memberships: { where: { familyId: message.familyId, status: 'ACTIVE' } } } });
        let reason: string | null = null;
        if (!recipient?.isActive || !recipient.memberships.length) reason = 'Penerima bukan anggota aktif keluarga';
        else if (!recipient.whatsappOptInAt) reason = 'Penerima belum menyetujui notifikasi WhatsApp';
        if (message.kind === 'INSTALLMENT_DUE' && message.installmentId) {
          const item = await tx.loanInstallment.findUnique({ where: { id: message.installmentId }, include: { loan: true } });
          if (!item || item.status === 'PAID' || item.loan.status !== 'ACTIVE') reason = 'Cicilan tidak lagi perlu diingatkan';
          else if (wibDay(message.createdAt) !== wibDay(now) || !reminderStage(item.dueDate, now)) reason = 'Jadwal pengingat sudah berlalu';
        }
        if (!reason && !/^62[1-9]\d{7,12}$/.test(recipient!.phone)) throw new Error('Nomor WhatsApp harus memakai format 62 yang valid');
        await tx.whatsAppMessage.updateMany({ where: { id: message.id, status: 'PROCESSING', lockedAt: now },
          data: { status: reason ? 'CANCELLED' : 'SIMULATED', completedAt: now, lockedAt: null, lastError: reason } });
      });
    } catch (error) {
      const attempts = message.attempts + 1;
      await prisma.whatsAppMessage.updateMany({ where: { id: message.id, status: 'PROCESSING', lockedAt: now }, data: {
        status: attempts >= 3 ? 'FAILED' : 'QUEUED', lockedAt: null,
        nextAttemptAt: new Date(now.getTime() + 60000 * 2 ** (attempts - 1)),
        lastError: error instanceof Error && error.message.startsWith('Nomor WhatsApp') ? error.message : 'Pemrosesan pesan gagal; akan dicoba ulang sesuai batas',
      } });
    }
  }
}

export function startNotificationWorker() {
  let running: Promise<void> | undefined;
  const tick = () => {
    if (running) return;
    running = (async () => { await scheduleReminders(); await processMessages(); })()
      .catch(() => console.error('Pemrosesan notifikasi gagal. Periksa koneksi database dan migration.'))
      .finally(() => { running = undefined; });
  };
  tick();
  const timer = setInterval(tick, env.NOTIFICATION_POLL_MS);
  timer.unref();
  return async () => { clearInterval(timer); await running; };
}
