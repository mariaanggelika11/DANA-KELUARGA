import { formatMoney } from "../../utils/money";
import { wibDay } from "../../utils/calendar";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { renderEmail } from "./email.templates";

export type OutgoingEmail = {
  id: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};
export type EmailSender = (email: OutgoingEmail) => Promise<void>;
// Thrown by senders; permanent errors (bad credentials, unverified sender) are not retried.
export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

// Billing (including transfer reports/rejections), loan requests and decisions are emailed.
const INBOX_ONLY_KINDS = new Set(["CONTRIBUTION", "WITHDRAWAL"]);

export async function queueEmail(
  tx: Prisma.TransactionClient,
  data: {
    eventKey: string;
    familyId: string;
    userId: string;
    subject: string;
    body: string;
  },
  kind?: string,
) {
  // Skipped emails are still recorded: the unique eventKey keeps the inbox write idempotent.
  const reason =
    env.EMAIL_MODE === "disabled"
      ? "Pengiriman email dinonaktifkan"
      : kind && INBOX_ONLY_KINDS.has(kind)
        ? "Jenis pemberitahuan ini tidak dikirim lewat email"
        : null;
  return tx.emailMessage.createMany({
    data: [
      {
        ...data,
        ...(reason
          ? {
              status: "CANCELLED" as const,
              lastError: reason,
              completedAt: new Date(),
            }
          : {}),
      },
    ],
    skipDuplicates: true,
  });
}

let smtpTransport: ReturnType<typeof nodemailer.createTransport> | undefined;
// SMTP (e.g. Brevo) is at-least-once delivery: a crash after the server accepts a message can cause a retry.
export const smtpSender: EmailSender = async ({
  id,
  idempotencyKey: _idempotencyKey,
  ...email
}) => {
  smtpTransport ??= nodemailer.createTransport({
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
  });
  try {
    await smtpTransport.sendMail({
      from: env.EMAIL_FROM,
      replyTo: env.EMAIL_REPLY_TO,
      ...email,
      messageId: `<${id}@dana-keluarga.local>`,
    });
  } catch (error) {
    const { code, responseCode } = error as {
      code?: string;
      responseCode?: number;
    };
    // EAUTH and 5xx replies (rejected sender/recipient) fail the same way on every retry.
    if (code === "EAUTH" || (responseCode ?? 0) >= 500)
      throw new EmailDeliveryError(
        `SMTP menolak pengiriman (${code === "EAUTH" ? "autentikasi gagal" : `kode ${responseCode}`}). Periksa SMTP_USER/SMTP_PASSWORD dan pastikan EMAIL_FROM terverifikasi.`,
        true,
      );
    throw error;
  }
};

let resendClient: Resend | undefined;
export const resendSender: EmailSender = async ({
  id: _id,
  idempotencyKey,
  ...email
}) => {
  resendClient ??= new Resend(env.RESEND_API_KEY);
  // The SDK reports API failures as { error } instead of throwing. The idempotency key makes
  // a retry after a crash (provider accepted, status not yet saved) return the original email.
  const { error } = await resendClient.emails.send(
    { from: env.EMAIL_FROM, replyTo: env.EMAIL_REPLY_TO, ...email },
    { idempotencyKey },
  );
  if (!error) return;
  const status = error.statusCode ?? 0;
  // 4xx means the request itself is wrong (API key, sender domain, recipient); retrying will not help.
  // 409 (concurrent idempotent request) and 429 (rate limit/quota) are transient.
  throw new EmailDeliveryError(
    `Resend ${error.name}: ${error.message}`.slice(0, 300),
    status >= 400 && status < 500 && status !== 409 && status !== 429,
  );
};

export const defaultSender = (): EmailSender | null =>
  env.EMAIL_MODE === "smtp"
    ? smtpSender
    : env.EMAIL_MODE === "resend"
      ? resendSender
      : null;

export async function processEmails(
  now = new Date(),
  sender: EmailSender | null = defaultSender(),
  options: { messageId?: string } = {},
) {
  if (env.EMAIL_MODE === "disabled") return;
  if ((env.EMAIL_MODE === "smtp" || env.EMAIL_MODE === "resend") && !sender)
    throw new EmailDeliveryError("Penyedia email nyata belum tersedia.", true);
  const scope = options.messageId ? { id: options.messageId } : {};
  await prisma.emailMessage.updateMany({
    where: {
      ...scope,
      status: "PROCESSING",
      lockedAt: { lt: new Date(now.getTime() - 300000) },
    },
    data: { status: "QUEUED", lockedAt: null },
  });
  const messages = await prisma.emailMessage.findMany({
    where: { ...scope, status: "QUEUED", nextAttemptAt: { lte: now } },
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
          include: {
            loan: { include: { installments: true } },
            payments: {
              where: {
                provider: "MANUAL",
                status: "PENDING",
                bankAccountId: { not: null },
              },
              select: { id: true },
              take: 1,
            },
          },
        });
        if (
          !current ||
          current.status === "PAID" ||
          current.loan.status !== "ACTIVE" ||
          current.payments.length > 0
        ) {
          await prisma.emailMessage.update({
            where: { id: message.id },
            data: {
              status: "CANCELLED",
              completedAt: new Date(),
              lockedAt: null,
              lastError: current?.payments?.length
                ? "Pembayaran menunggu pemeriksaan pengelola dana."
                : "Tagihan sudah selesai",
            },
          });
          continue;
        }
        const outstanding = current.loan.installments.reduce(
          (total, item) => total.add(item.remainingAmount),
          current.loan.principalAmount.sub(current.loan.principalAmount),
        );
        body = `Pengingat cicilan ke-${current.installmentNumber}: ${formatMoney(current.remainingAmount)}, jatuh tempo ${wibDay(current.dueDate)}. Total pinjaman ${formatMoney(current.loan.principalAmount)}, sudah dibayar ${formatMoney(current.loan.principalAmount.sub(outstanding))}, sisa tagihan ${formatMoney(outstanding)}. Lihat rincian: ${(env.PUBLIC_APP_URL ?? env.FRONTEND_URL).replace(/\/$/, "")}/?installment=${current.id}`;
      }
      // Queued messages may predate deployment. Keep public links current, and
      // omit localhost links from real mail until the app has a public address.
      const appUrl = env.PUBLIC_APP_URL ?? env.FRONTEND_URL;
      const localOrigin =
        /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?(?=\/|\s|$)/g;
      const localUrl =
        /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?(?:\/[^\s]*)?(?=\s|$)/g;
      const hostname = new URL(appUrl).hostname;
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
      if (!local) body = body.replace(localOrigin, appUrl.replace(/\/$/, ""));
      else if (env.EMAIL_MODE === "smtp" || env.EMAIL_MODE === "resend")
        body = body.replace(
          localUrl,
          "Buka aplikasi Dana Keluarga untuk melihat rincian.",
        );
      // Simulation has no sender: the email is rendered and recorded but never leaves the server.
      await sender?.({
        id: message.id,
        to: user.email,
        subject: message.subject,
        ...renderEmail(message.subject, body),
        idempotencyKey: message.eventKey,
      });
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: {
          status: sender ? "SENT" : "SIMULATED",
          completedAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });
    } catch (error) {
      const known = error instanceof EmailDeliveryError;
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: {
          status:
            (known && error.permanent) || message.attempts + 1 >= 5
              ? "FAILED"
              : "QUEUED",
          nextAttemptAt: new Date(
            Date.now() + Math.min(3600000, 30000 * 2 ** message.attempts),
          ),
          lockedAt: null,
          // Raw transport errors may echo credentials or hosts; only our own messages are stored.
          lastError: known
            ? error.message
            : "Email belum terkirim. Periksa koneksi dan konfigurasi penyedia email.",
        },
      });
    }
  }
}
