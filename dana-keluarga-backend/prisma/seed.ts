import argon2 from "argon2";
import { PrismaClient, SystemRole } from "@prisma/client";

const prisma = new PrismaClient();
async function main() {
  const name = process.env.SEED_SUPER_ADMIN_NAME ?? process.env.SEED_ADMIN_NAME;
  const email =
    process.env.SEED_SUPER_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL;
  const phone =
    process.env.SEED_SUPER_ADMIN_PHONE ?? process.env.SEED_ADMIN_PHONE;
  const password =
    process.env.SEED_SUPER_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;
  if (!name || !email || !phone || !password)
    throw new Error("SEED_SUPER_ADMIN_* environment variables are required");
  const existingAdmin = await prisma.user.findFirst({
    where: { OR: [{ email }, { phone }] },
  });
  if (existingAdmin) {
    if (
      existingAdmin.systemRole !== SystemRole.SUPER_ADMIN ||
      existingAdmin.email !== email ||
      existingAdmin.phone !== phone
    ) {
      throw new Error(
        "Identitas bootstrap sudah digunakan akun lain. Tidak ada akun yang diubah.",
      );
    }
    console.log("Akun Super Admin sudah tersedia. Tidak ada data yang diubah.");
    return;
  }
  const passwordHash = await argon2.hash(password);
  await prisma.user.create({
    data: {
      name,
      email,
      phone,
      passwordHash,
      systemRole: SystemRole.SUPER_ADMIN,
    },
  });
  console.log(
    "Akun Super Admin dibuat. Keluarga dan anggota didaftarkan melalui aplikasi.",
  );
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Bootstrap Super Admin gagal.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
