import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { z } from "zod";
import { env } from "../src/config/env";
import { prisma } from "../src/config/prisma";
import {
  defaultSender,
  processEmails,
} from "../src/modules/email/email.service";

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--to"))
    throw new Error(
      "Gunakan npm run email:check -- --to alamat@email.com, atau tanpa argumen untuk cek SMTP saja.",
    );
  if (env.EMAIL_MODE !== "smtp" && env.EMAIL_MODE !== "resend")
    throw new Error(
      "EMAIL_MODE harus smtp atau resend untuk menguji pengiriman nyata.",
    );
  if (env.EMAIL_MODE === "smtp") {
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      requireTLS: !env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    try {
      await transport.verify();
    } catch (error) {
      const smtp = error as { code?: string; responseCode?: number };
      throw new Error(
        `Pemeriksaan SMTP gagal (${smtp.code ?? "UNKNOWN"}, ${smtp.responseCode ?? "tanpa kode balasan"}). Periksa konfigurasi penyedia.`,
      );
    } finally {
      transport.close();
    }
    console.log("Koneksi TLS dan autentikasi SMTP berhasil.");
    console.log(
      "Koneksi SMTP tidak memverifikasi autentikasi domain. Penyedia dapat mengganti alamat From jika domain belum terverifikasi.",
    );
  }
  if (!args.length) {
    console.log(
      "Tidak ada email dikirim. Tambahkan --to untuk mengirim email uji ke akun anggota aktif.",
    );
    return;
  }
  const email = z.email().parse(args[1].trim().toLowerCase());
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      isActive: true,
      memberships: {
        where: { status: "ACTIVE" },
        orderBy: { joinedAt: "asc" },
        select: { familyId: true },
        take: 1,
      },
    },
  });
  const member = user?.memberships[0];
  if (!user?.isActive || !member)
    throw new Error(
      "Penerima harus merupakan akun dengan keanggotaan keluarga aktif.",
    );
  const message = await prisma.emailMessage.create({
    data: {
      eventKey: `EMAIL_TEST:${crypto.randomUUID()}`,
      familyId: member.familyId,
      userId: user.id,
      subject: `Uji alamat pengirim Dana Keluarga (${env.EMAIL_MODE})`,
      body: `Email ini menguji alamat pengirim Dana Keluarga. Pengirim yang diminta: ${env.EMAIL_FROM}. Layanan pengiriman: ${env.EMAIL_MODE}. Periksa alamat Dari pada email ini. Tidak ada perubahan saldo, cicilan, atau transaksi keuangan dari pengujian ini.`,
    },
  });
  await processEmails(new Date(), defaultSender(), { messageId: message.id });
  const readResult = () =>
    prisma.emailMessage.findUniqueOrThrow({
      where: { id: message.id },
      select: { status: true, attempts: true, lastError: true },
    });
  let result = await readResult();
  // A running API worker can claim the test before this command does. Wait only for
  // this message instead of reporting failure while delivery is still in progress.
  for (
    let attempt = 0;
    result.status === "PROCESSING" && attempt < 20;
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    result = await readResult();
  }
  console.log(
    JSON.stringify({
      messageId: message.id,
      provider: env.EMAIL_MODE,
      from: env.EMAIL_FROM,
      status: result.status,
      attempts: result.attempts,
    }),
  );
  if (result.status !== "SENT")
    throw new Error(
      result.lastError ??
        "Email uji belum diterima server penyedia. Periksa riwayat email aplikasi.",
    );
  console.log(
    "Email uji diterima server penyedia. Periksa inbox atau spam serta alamat Dari pada email yang diterima; from di atas adalah alamat yang diminta aplikasi.",
  );
}
main()
  .catch((error) => {
    // Avoid raw Prisma/provider errors, which can contain credentials or personal data.
    console.error(
      error instanceof Error &&
        (error.message.startsWith("Pemeriksaan SMTP") ||
          error.message.startsWith("Penerima harus") ||
          error.message.startsWith("EMAIL_MODE") ||
          error.message.startsWith("Gunakan") ||
          error.message.startsWith("SMTP menolak") ||
          error.message.startsWith("Email uji"))
        ? error.message
        : "Pemeriksaan email gagal. Periksa riwayat email dan konfigurasi layanan; detail rahasia tidak ditampilkan.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
