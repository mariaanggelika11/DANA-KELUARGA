import { Prisma } from "@prisma/client";
import { processEmails } from "../email/email.service";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { daysUntil, wibDay, wibHour } from "../../utils/calendar";
import { enqueue, installmentLink, money } from "./notification.service";

export function reminderStage(
  due: Date,
  now: Date,
  hour = env.REMINDER_HOUR_WIB,
) {
  if (wibHour(now) < hour) return null;
  const days = daysUntil(due, now);
  return days === 3 ? "H-3" : days === 0 ? "H" : null;
}

export async function scheduleReminders(now = new Date()) {
  // Bound the query to today's due date and H-3 candidates, independent of host timezone.
  const start = new Date(`${wibDay(now)}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 4 * 86400000);
  await prisma.loanInstallment.updateMany({
    where: {
      dueDate: { lt: start },
      status: { in: ["UNPAID", "PARTIAL"] },
      loan: { status: "ACTIVE" },
    },
    data: { status: "OVERDUE" },
  });
  if (wibHour(now) < env.REMINDER_HOUR_WIB) return;
  const installments = await prisma.loanInstallment.findMany({
    where: {
      dueDate: { gte: start, lt: end },
      status: { not: "PAID" },
      remainingAmount: { gt: 0 },
      payments: {
        none: {
          provider: "MANUAL",
          status: "PENDING",
          bankAccountId: { not: null },
        },
      },
      loan: { status: "ACTIVE" },
    },
    include: {
      loan: { include: { borrower: true, family: true, installments: true } },
    },
  });
  for (const item of installments) {
    const stage = reminderStage(item.dueDate, now);
    if (!stage) continue;
    await prisma.$transaction(async (tx) => {
      const paid = item.loan.installments.reduce(
        (sum, row) => sum.add(row.paidAmount ?? 0),
        new Prisma.Decimal(0),
      );
      const outstanding = item.loan.principalAmount.sub(paid);
      await enqueue(tx, {
        eventKey: `INSTALLMENT_DUE:${item.id}:${wibDay(item.dueDate)}:${stage}`,
        kind: "INSTALLMENT_DUE",
        installmentId: item.id,
        familyId: item.loan.familyId,
        userId: item.loan.borrowerId,
        body: `[${item.loan.family.name}] Halo ${item.loan.borrower.name}, cicilan ke-${item.installmentNumber} sebesar ${money(item.remainingAmount)} jatuh tempo ${wibDay(item.dueDate)}. Total pinjaman ${money(item.loan.principalAmount)}, sudah dibayar ${money(paid)}, sisa tagihan ${money(outstanding)}. Lihat rincian: ${installmentLink(item.id)}`,
      });
    });
  }
}

export function notificationFailure(error: unknown) {
  // Never print Prisma's raw message: it may include connection details or SQL.
  const candidate = error as { code?: unknown; errorCode?: unknown } | null;
  const rawCode = candidate?.code ?? candidate?.errorCode;
  const code =
    typeof rawCode === "string" && /^P\d{4}$/.test(rawCode)
      ? rawCode
      : "UNKNOWN";
  const guidance = ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(code)
    ? "Koneksi database terputus atau timeout. Periksa jaringan dan ketersediaan PostgreSQL."
    : ["P2021", "P2022"].includes(code)
      ? "Tabel/kolom database belum sesuai. Jalankan npx prisma migrate deploy dan npm run prisma:generate, lalu restart backend."
      : ["P1000", "P1010"].includes(code)
        ? "Autentikasi atau akses database ditolak. Periksa konfigurasi DATABASE_URL dan izin pengguna database."
        : "Worker gagal memproses data. Periksa log server dan konfigurasi database; migration belum tentu penyebabnya.";
  return { code, guidance };
}

export function startNotificationWorker() {
  let running: Promise<void> | undefined;
  let failures = 0;
  let retryAt = 0;
  let stopped = false;
  const tick = () => {
    if (stopped || running || Date.now() < retryAt) return;
    let stage = "pengingat cicilan";
    running = (async () => {
      await scheduleReminders();
      stage = "antrean email";
      await processEmails();
      if (failures)
        console.info(
          "Worker notifikasi pulih; koneksi dan pemrosesan database berhasil.",
        );
      failures = 0;
      retryAt = 0;
    })()
      .catch((error: unknown) => {
        failures += 1;
        const delay = Math.max(
          env.NOTIFICATION_POLL_MS,
          Math.min(300000, 10000 * 2 ** Math.min(failures - 1, 5)),
        );
        retryAt = Date.now() + delay;
        const { code, guidance } = notificationFailure(error);
        console.error(
          `Notifikasi gagal pada ${stage} [${code}]. ${guidance} Percobaan ulang dalam sekitar ${Math.ceil(delay / 1000)} detik.`,
        );
      })
      .finally(() => {
        running = undefined;
      });
  };
  tick();
  const timer = setInterval(tick, env.NOTIFICATION_POLL_MS);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
