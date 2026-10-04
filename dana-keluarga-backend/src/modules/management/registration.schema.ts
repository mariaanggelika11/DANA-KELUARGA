import { z } from "zod";
import { normalizeIndonesianPhone } from "../../utils/phone";

const name = z
  .string()
  .trim()
  .min(2, "Nama lengkap minimal 2 karakter.")
  .max(120, "Nama lengkap maksimal 120 karakter.");
const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Masukkan email yang valid.")
  .max(254);
const phone = z
  .string()
  .trim()
  .regex(/^[+\d\s()-]+$/, "Masukkan nomor telepon yang valid.")
  .transform(normalizeIndonesianPhone)
  .refine(
    (value) => /^628\d{7,10}$/.test(value),
    "Masukkan nomor telepon Indonesia yang valid, misalnya 081234567890.",
  );
const password = z
  .string()
  .min(8, "Password minimal 8 karakter.")
  .max(128, "Password maksimal 128 karakter.");
const person = { name, email, phone, password, confirmPassword: z.string() };
const role = z.enum(["ADMIN", "MEMBER", "TREASURER"]).default("MEMBER");
const familyId = z.string().uuid("Pilih keluarga tujuan.");
export const registrationSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("NEW_FAMILY"),
      ...person,
      familyName: z
        .string()
        .trim()
        .min(2, "Nama keluarga minimal 2 karakter.")
        .max(120),
      familyCode: z
        .string()
        .trim()
        .toUpperCase()
        .min(3)
        .max(30)
        .regex(
          /^[A-Z0-9-]+$/,
          "Kode keluarga hanya boleh berisi huruf, angka, dan tanda hubung.",
        ),
      description: z.string().trim().max(240).optional(),
    }),
    z.object({ type: z.literal("NEW_MEMBER"), ...person, familyId, role }),
    z.object({
      type: z.literal("EXISTING_MEMBER"),
      familyId,
      role,
      existingUserId: z.string().uuid("Pilih akun dari hasil pencarian."),
    }),
  ])
  .superRefine((input, context) => {
    if (
      input.type !== "EXISTING_MEMBER" &&
      input.password !== input.confirmPassword
    ) {
      context.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Konfirmasi password belum sama dengan password.",
      });
    }
  });
export type RegistrationInput = z.infer<typeof registrationSchema>;
