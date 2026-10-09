import { Prisma } from "@prisma/client";
import argon2 from "argon2";
import { prisma } from "../../config/prisma";
import { WorkflowError, type WorkflowActor } from "../approvals/approval.rules";
import type { RegistrationInput } from "./registration.schema";
import { authorizeFamily } from "../cash/family-access.service";

const publicUser = { id: true, name: true, email: true, phone: true } as const;
export async function registerFamilyAccess(
  actor: WorkflowActor,
  input: RegistrationInput,
) {
  const global = actor.systemRole === "SUPER_ADMIN";
  if (
    !global &&
    (input.type !== "NEW_MEMBER" ||
      actor.familyRole !== "ADMIN" ||
      input.familyId !== actor.familyId)
  ) {
    throw new WorkflowError(
      "FORBIDDEN",
      "Anda tidak memiliki akses untuk menambahkan akun ke keluarga ini.",
      403,
    );
  }
  // Hash outside the transaction to avoid holding database locks during password hashing.
  const passwordHash =
    input.type !== "EXISTING_MEMBER"
      ? await argon2.hash(input.password)
      : undefined;
  return prisma
    .$transaction(async (tx) => {
      if (!global) {
        await authorizeFamily(tx, actor, ["ADMIN"]);
      } else {
        const current = await tx.user.findUnique({ where: { id: actor.sub } });
        if (!current?.isActive || current.systemRole !== "SUPER_ADMIN")
          throw new WorkflowError(
            "FORBIDDEN",
            "Akses pendaftaran Anda sudah berubah. Muat ulang halaman.",
            403,
          );
      }
      if (input.type !== "EXISTING_MEMBER") {
        const [emailExists, phoneExists] = await Promise.all([
          tx.user.findFirst({
            where: { email: { equals: input.email, mode: "insensitive" } },
            select: { id: true },
          }),
          tx.user.findFirst({
            where: { phone: input.phone },
            select: { id: true },
          }),
        ]);
        if (emailExists || phoneExists)
          throw accountConflict(Boolean(emailExists), Boolean(phoneExists));
      }
      let family;
      if (input.type === "NEW_FAMILY") {
        if (
          await tx.family.findUnique({
            where: { code: input.familyCode },
            select: { id: true },
          })
        )
          throw new WorkflowError(
            "FAMILY_CODE_EXISTS",
            "Kode keluarga sudah digunakan. Pilih kode lain.",
          );
        family = await tx.family.create({
          data: {
            name: input.familyName,
            code: input.familyCode,
            description: input.description,
            createdById: actor.sub,
          },
          select: { id: true, name: true, code: true },
        });
      } else {
        family = await tx.family.findUnique({
          where: { id: input.familyId },
          select: { id: true, name: true, code: true },
        });
        if (!family)
          throw new WorkflowError(
            "FAMILY_NOT_FOUND",
            "Keluarga tujuan tidak ditemukan.",
            404,
          );
      }
      let user;
      if (input.type === "EXISTING_MEMBER") {
        const candidate = await tx.user.findUnique({
          where: { id: input.existingUserId },
          select: { ...publicUser, isActive: true, systemRole: true },
        });
        if (!candidate?.isActive || candidate.systemRole !== "USER")
          throw new WorkflowError(
            "INVALID_MEMBER",
            "Pilih akun anggota aktif. Akun Super Admin tidak dapat ditambahkan sebagai anggota keluarga.",
            400,
          );
        if (
          await tx.familyMember.findUnique({
            where: {
              familyId_userId: { familyId: family.id, userId: candidate.id },
            },
          })
        )
          throw new WorkflowError(
            "ALREADY_FAMILY_MEMBER",
            "Akun ini sudah terdaftar di keluarga tersebut. Tidak ada akses baru yang dibuat.",
          );
        user = {
          id: candidate.id,
          name: candidate.name,
          email: candidate.email,
          phone: candidate.phone,
        };
      } else {
        user = await tx.user.create({
          data: {
            name: input.name,
            email: input.email,
            phone: input.phone,
            passwordHash: passwordHash!,
          },
          select: publicUser,
        });
      }
      const assignedRole = input.type === "NEW_FAMILY" ? "ADMIN" : input.role;
      await tx.familyMember.create({
        data: { familyId: family.id, userId: user.id, role: assignedRole },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          familyId: family.id,
          action: input.type,
          entityType: "FamilyMember",
          entityId: user.id,
          after: { userId: user.id, role: assignedRole, familyId: family.id },
        },
      });
      return { family, user, role: assignedRole };
    })
    .catch((error: unknown) => {
      // A concurrent submission can pass preflight and hit a unique index at commit.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const target = error.meta?.target;
        const fields = Array.isArray(target) ? target.map(String) : [];
        if (fields.includes("email") || fields.includes("phone"))
          throw accountConflict(
            fields.includes("email"),
            fields.includes("phone"),
          );
        if (fields.includes("code"))
          throw new WorkflowError(
            "FAMILY_CODE_EXISTS",
            "Kode keluarga sudah digunakan. Pilih kode lain.",
          );
        if (fields.includes("familyId") && fields.includes("userId"))
          throw new WorkflowError(
            "ALREADY_FAMILY_MEMBER",
            "Akun ini sudah terdaftar di keluarga tersebut. Tidak ada akses baru yang dibuat.",
          );
      }
      throw error;
    });
}

function accountConflict(email: boolean, phone: boolean) {
  const field =
    email && phone
      ? "Email dan nomor telepon"
      : email
        ? "Email"
        : "Nomor telepon";
  return new WorkflowError(
    email && phone
      ? "EMAIL_AND_PHONE_ALREADY_USED"
      : email
        ? "EMAIL_ALREADY_USED"
        : "PHONE_ALREADY_USED",
    `${field} sudah digunakan pada akun yang terdaftar di aplikasi, termasuk akun di keluarga lain atau akun tidak aktif. Periksa isian Anda. Jika ini akun yang sama, gunakan Hubungkan akun yang sudah ada melalui Super Admin; jangan membuat akun baru.`,
  );
}
