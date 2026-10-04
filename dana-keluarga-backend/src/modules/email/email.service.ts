import { formatMoney } from "../../utils/money";
import { wibDay } from "../../utils/calendar";
import nodemailer from "nodemailer";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
export async function queueEmail(
  tx: Prisma.TransactionClient,
  data: {
    eventKey: string;
    familyId: string;
    userId: string;
    subject: string;
    body: string;
  },
) {
  return tx.emailMessage.createMany({
    data: [
      {
        ...data,
        ...(env.EMAIL_MODE === "disabled"
          ? {
              status: "CANCELLED" as const,
              lastError: "Pengiriman email dinonaktifkan",
              completedAt: new Date(),
            }
          : {}),
      },
    ],
    skipDuplicates: true,
  });
}
const transport = () =>
  env.EMAIL_MODE === "smtp"
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        requireTLS: !env.SMTP_SECURE,
        auth: env.SMTP_USER
          ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
          : undefined,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
      })
    : nodemailer.createTransport({ jsonTransport: true });
// SMTP is at-least-once delivery: a crash after SMTP accepts a message can cause a retry.
export async function processEmails(now = new Date(), sender = transport()) {
  if (env.EMAIL_MODE === "disabled") return;
  await prisma.emailMessage.updateMany({
    where: {
      status: "PROCESSING",
      lockedAt: { lt: new Date(now.getTime() - 300000) },
    },
    data: { status: "QUEUED", lockedAt: null },
  });
  const messages = await prisma.emailMessage.findMany({
    where: { status: "QUEUED", nextAttemptAt: { lte: now } },
    take: 25,
    orderBy: { createdAt: "asc" },
  });
  for (const message of messages) {
    const claim = await prisma.emailMessage.updateMany({
      where: { id: message.id, status: "QUEUED" },
      data: { status: "PROCESSING", lockedAt: now, attempts: { increment: 1 } },
    });
    if (!claim.count) continue;
    try {
      const user = await prisma.user.findUnique({
        where: { id: message.userId },
        select: {
          email: true,
          isActive: true,
          memberships: {
            where: { familyId: message.familyId, status: "ACTIVE" },
            select: { id: true },
          },
        },
      });
      if (!user?.isActive || !user.email || !user.memberships.length) {
        await prisma.emailMessage.update({
          where: { id: message.id },
          data: {
            status: "CANCELLED",
            completedAt: new Date(),
            lockedAt: null,
            lastError: "Penerima tidak aktif atau email akun belum tersedia",
          },
        });
        continue;
      }
      let body = message.body;
      if (message.eventKey.startsWith("INSTALLMENT_DUE:")) {
        const installmentId = message.eventKey.split(":")[1];
        const current = await prisma.loanInstallment.findUnique({
          where: { id: installmentId },
          include: { loan: { include: { installments: true } } },
        });
        if (
          !current ||
          current.status === "PAID" ||
          current.loan.status !== "ACTIVE"
        ) {
          await prisma.emailMessage.update({
            where: { id: message.id },
            data: {
              status: "CANCELLED",
              completedAt: new Date(),
              lockedAt: null,
              lastError: "Tagihan sudah selesai",
            },
          });
          continue;
        }
        const outstanding = current.loan.installments.reduce(
          (total, item) => total.add(item.remainingAmount),
          current.loan.principalAmount.sub(current.loan.principalAmount),
        );
        body = `Pengingat cicilan ke-${current.installmentNumber}: ${formatMoney(current.remainingAmount)}, jatuh tempo ${wibDay(current.dueDate)}. Total pinjaman ${formatMoney(current.loan.principalAmount)}, sudah dibayar ${formatMoney(current.loan.principalAmount.sub(outstanding))}, sisa tagihan ${formatMoney(outstanding)}. Lihat rincian: ${env.FRONTEND_URL.replace(/\/$/, "")}/?installment=${current.id}`;
      }
      await sender.sendMail({
        from: env.SMTP_FROM,
        to: user.email,
        subject: message.subject,
        text: body,
        messageId: `<${message.id}@dana-keluarga.local>`,
      });
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: {
          status: env.EMAIL_MODE === "smtp" ? "SENT" : "SIMULATED",
          completedAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });
    } catch {
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: {
          status: message.attempts + 1 >= 5 ? "FAILED" : "QUEUED",
          nextAttemptAt: new Date(
            Date.now() + Math.min(3600000, 30000 * 2 ** message.attempts),
          ),
          lockedAt: null,
          lastError:
            "Email belum terkirim. Periksa koneksi dan konfigurasi SMTP.",
        },
      });
    }
  }
}
