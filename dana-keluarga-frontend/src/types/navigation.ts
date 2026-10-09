export type AppPage =
  | "Tidak ditemukan"
  | "Ringkasan"
  | "Kas"
  | "Pinjaman"
  | "Cicilan"
  | "Anggota"
  | "Notifikasi"
  | "Pengaturan"
  | "Ubah password"
  | "Panduan"
  | "Setup Hirarki"
  | "Persetujuan";
export type SessionUser = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  systemRole: string;
  familyRole?: string;
  familyId?: string;
  families?: { id: string; name: string; role: string }[];
  familyName?: string;
};
export function roleLabel(user: SessionUser) {
  if (user.systemRole === "SUPER_ADMIN") return "Super Admin";
  if (user.familyRole === "ADMIN") return "Admin keluarga";
  if (user.familyRole === "TREASURER") return "Pengelola dana";
  return "Anggota";
}

export const pageQueries: Record<AppPage, string> = {
  "Tidak ditemukan": "not-found",
  Ringkasan: "summary",
  Kas: "ledger",
  Pinjaman: "loans",
  Cicilan: "installments",
  Anggota: "members",
  Notifikasi: "notifications",
  Pengaturan: "settings",
  "Ubah password": "change-password",
  Panduan: "help",
  "Setup Hirarki": "hierarchy",
  Persetujuan: "approvals",
};
export function initialPage(): AppPage {
  const query = new URLSearchParams(window.location.search);
  if (!["/", "/index.html"].includes(window.location.pathname))
    return "Tidak ditemukan";
  if (query.has("installment")) return "Cicilan";
  return (
    (Object.entries(pageQueries).find(
      ([, value]) => value === query.get("view"),
    )?.[0] as AppPage | undefined) ??
    (query.has("view") ? "Tidak ditemukan" : "Ringkasan")
  );
}
