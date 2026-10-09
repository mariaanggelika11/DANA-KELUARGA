import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { defaultSender, type EmailSender } from "../email/email.service";
import { WorkflowError } from "../approvals/approval.rules";

export const supportSchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(10, "Jelaskan kendala minimal 10 karakter.")
      .max(5000, "Kendala maksimal 5.000 karakter."),
  })
  .strict();
const SUPPORT_EMAIL = "aglkamaria086@gmail.com";

export async function sendSupportRequest(
  userId: string,
  familyId: string | undefined,
  message: string,
  sender: EmailSender | null = defaultSender(),
) {
  if (!sender)
    throw new WorkflowError(
      "SUPPORT_UNAVAILABLE",
      "Pengiriman bantuan belum tersedia. Silakan coba lagi nanti.",
      503,
    );
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      isActive: true,
      systemRole: true,
      memberships: {
        where: { familyId, status: "ACTIVE" },
        select: {
          familyId: true,
          role: true,
          family: { select: { name: true } },
        },
      },
    },
  });
  if (!user?.isActive)
    throw new WorkflowError(
      "UNAUTHORIZED",
      "Silakan login terlebih dahulu.",
      401,
    );
  const membership = familyId
    ? user.memberships.find((item) => item.familyId === familyId)
    : undefined;
  const role =
    user.systemRole === "SUPER_ADMIN"
      ? "Super Admin"
      : membership?.role === "ADMIN"
        ? "Admin keluarga"
        : membership?.role === "TREASURER"
          ? "Pengelola dana"
          : "Anggota";
  const subject = "[Butuh Bantuan] Kendala pengguna Dana Keluarga";
  const text = `Nama: ${user.name}\nEmail: ${user.email ?? "Belum tersedia"}\nPeran: ${role}\nKeluarga: ${membership?.family.name ?? "Tidak ada keluarga aktif"}\n\nKendala:\n${message}`;
  const escaped = text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
  const id = crypto.randomUUID();
  try {
    await sender({
      id,
      to: SUPPORT_EMAIL,
      subject,
      text,
      html: `<div style="font-family:Arial,sans-serif"><h1 style="font-size:20px">${subject}</h1><p style="white-space:pre-wrap">${escaped}</p></div>`,
      ...(user.email ? { replyTo: user.email } : {}),
      idempotencyKey: `SUPPORT:${id}`,
    });
  } catch {
    throw new WorkflowError(
      "SUPPORT_DELIVERY_FAILED",
      "Pesan bantuan belum berhasil dikirim. Silakan coba lagi nanti.",
      503,
    );
  }
}
