import { UserPlus } from "lucide-react";
import { Feedback } from "../Feedback";
import type { AppPage, SessionUser } from "../../types/navigation";

const pageCopy: Partial<
  Record<AppPage, { title: string; description: string }>
> = {
  "Setup Hirarki": {
    title: "Setup hirarki keluarga.",
    description: "Atur petugas dan urutan persetujuan untuk setiap keluarga.",
  },
  Persetujuan: {
    title: "Persetujuan berurutan.",
    description:
      "Tinjau pengajuan pada tahap yang menjadi tanggung jawab Anda.",
  },
  Panduan: {
    title: "Panduan Dana Keluarga.",
    description:
      "Kenali alur aplikasi dan langkah yang sesuai dengan peran Anda.",
  },
  Pengaturan: {
    title: "Pengaturan keluarga.",
    description:
      "Lihat rekening tujuan transfer yang diatur pengelola dana keluarga.",
  },
  "Ubah password": {
    title: "Keamanan akun Anda.",
    description: "Ubah password untuk akun pribadi Anda.",
  },
  Notifikasi: {
    title: "Pemberitahuan keluarga.",
    description: "Baca kabar terbaru yang terkait dengan akun Anda.",
  },
  Anggota: {
    title: "Kelola ruang bersama.",
    description:
      "Pastikan setiap orang memiliki akses dan peran yang tepat di keluarga ini.",
  },
  Cicilan: {
    title: "Jadwal cicilan.",
    description:
      "Lihat jadwal pembayaran berdasarkan pinjaman yang telah dicairkan.",
  },
  Kas: {
    title: "Kas keluarga.",
    description:
      "Pantau saldo, kontribusi anggota, dan pengembalian pinjaman keluarga.",
  },
};
const fullDate = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "full",
  timeZone: "Asia/Jakarta",
});
type Props = {
  active: AppPage;
  user: SessionUser;
  canManageLoans: boolean;
  onNavigate: (page: AppPage) => void;
  onAddMember?: () => void;
};
export function PageIntro({
  active,
  user,
  canManageLoans,
  onNavigate,
  onAddMember,
}: Props) {
  const copy =
    active === "Pinjaman"
      ? canManageLoans
        ? {
            title: "Kelola pinjaman.",
            description:
              "Tinjau pengajuan dan kelola dana keluarga dengan tertib.",
          }
        : {
            title: "Pinjaman saya.",
            description: "Pantau pengajuan dan kewajiban pinjaman Anda.",
          }
      : (pageCopy[active] ?? {
          title: `Halo, ${user.name}.`,
          description:
            "Pelan-pelan, yang penting bersama. Ini kabar terbaru ruang dana keluarga.",
        });
  return (
    <section className="intro">
      <div>
        <p className="date">{fullDate.format(new Date())}</p>
        {!user.familyId &&
          user.systemRole !== "SUPER_ADMIN" &&
          active !== "Ubah password" && (
            <Feedback tone="warning">
              Akun Anda belum memiliki keluarga aktif. Hubungi admin untuk
              memeriksa keanggotaan.
            </Feedback>
          )}
        {active === "Tidak ditemukan" && (
          <Feedback tone="warning" title="Halaman tidak ditemukan">
            Tautan tidak dikenali. Pilih menu di sebelah kiri atau{" "}
            <button
              className="text-button"
              onClick={() => onNavigate("Ringkasan")}
            >
              buka beranda
            </button>
            .
          </Feedback>
        )}
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
      </div>
      {onAddMember && (
        <button className="primary" onClick={onAddMember}>
          <UserPlus size={17} />
          Tambah anggota
        </button>
      )}
    </section>
  );
}
