import { z } from "zod";

const newPassword = z
  .string()
  .min(8, "Password baru minimal 8 karakter.")
  .max(128, "Password baru maksimal 128 karakter.")
  .refine(
    (value) => value.trim().length > 0,
    "Password tidak boleh hanya spasi.",
  );
const confirmPassword = z
  .string()
  .min(1, "Konfirmasi password wajib diisi.")
  .max(128);
export const forgotPasswordSchema = z
  .object({ email: z.string().trim().toLowerCase().email() })
  .strict();
export const resetPasswordSchema = z
  .object({
    token: z.string().regex(/^[0-9a-f]{64}$/),
    newPassword,
    confirmPassword,
  })
  .strict()
  .refine((input) => input.newPassword === input.confirmPassword, {
    path: ["confirmPassword"],
    message: "Konfirmasi password belum sama dengan password baru.",
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Password lama wajib diisi.").max(128),
    newPassword,
    confirmPassword,
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.newPassword !== input.confirmPassword)
      ctx.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Konfirmasi password belum sama dengan password baru.",
      });
    if (input.newPassword === input.currentPassword)
      ctx.addIssue({
        code: "custom",
        path: ["newPassword"],
        message: "Password baru harus berbeda dari password lama.",
      });
  });
