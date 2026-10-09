import { BookOpen, ChevronRight } from "lucide-react";
import { Feedback } from "./Feedback";
import { roleLabel, type AppPage, type SessionUser } from "../types/navigation";
import "./HelpGuide.css";

type Guide = {
  id: string;
  title: string;
  description: string;
  steps: string[];
  target?: AppPage;
};
const guides: Guide[] = [
  {
    id: "overview",
    title: "Memahami ringkasan dan kas",
    description:
      "Lihat posisi dana keluarga dan catatan uang masuk atau keluar.",
    steps: [
      "Buka Ringkasan untuk melihat saldo kas dan sisa dana yang masih dipinjamkan.",
      "Buka Kas untuk membaca tanggal, keterangan, dan nominal setiap transaksi. Gunakan navigasi halaman untuk menelusuri catatan lama.",
      "Setiap anggota dapat memilih Setor dana untuk mencatat dana yang sudah diserahkan. Admin/Bendahara memakai Catat kas untuk pemasukan/pengeluaran umum, bukan kontribusi pribadi.",
      "Saldo kas keluarga di Ringkasan adalah saldo total. Kas tersedia untuk diambil sudah dikurangi dana yang dicadangkan. Pengembalian pinjaman menambah kas, bukan kontribusi Anda.",
    ],
    target: "Kas",
  },
  {
    id: "loans",
    title: "Mengajukan dan memantau pinjaman",
    description:
      "Pengajuan dilakukan melalui aplikasi dan diperiksa pengelola keluarga.",
    steps: [
      "Buka Kas → Ambil dana. Nominal sampai kontribusi tersedia menjadi tarikan sendiri tanpa utang dan tanpa approval pinjaman.",
      "Jika melebihi kontribusi, hanya selisihnya menjadi pinjaman. Periksa preview tarikan/pinjaman, tenor dan tujuan sebelum konfirmasi. Bagian pinjaman harus diajukan oleh Maker sesuai hirarki.",
      "Untuk pengajuan campuran, dana dicadangkan sampai pencairan bersama. Jika ditolak, seluruh cadangan dilepas.",
      "Status Menunggu persetujuan berarti pengajuan sedang ditinjau. Disetujui berarti masih menunggu pencairan.",
      "Jika ditolak, baca alasan yang diberikan. Jika sudah dicairkan, lihat jadwal pada menu Cicilan.",
      "Selesaikan pinjaman yang masih berjalan sebelum membuat pengajuan baru.",
    ],
    target: "Pinjaman",
  },
  {
    id: "installments",
    title: "Melihat cicilan dan pembayaran",
    description:
      "Setiap cicilan memiliki nominal, tanggal jatuh tempo, status, dan riwayat.",
    steps: [
      "Buka Cicilan, pilih nama anggota, lalu buka Lihat pembayaran pada cicilan yang dipilih.",
      "Periksa sisa cicilan dan rekening tujuan keluarga, lalu transfer seluruh sisa cicilan melalui bank Anda.",
      "Klik Saya sudah transfer. Nominal otomatis mengikuti sisa cicilan dan laporan langsung Menunggu pemeriksaan, tanpa mengisi formulir. Hanya peminjam dapat melaporkan cicilannya sendiri.",
      "Laporan berstatus Menunggu pemeriksaan belum mengurangi sisa cicilan. Pengelola dana keluarga memeriksa mutasi rekening dan mengonfirmasi Dana sudah masuk atau menolak dengan alasan.",
      "Setelah konfirmasi, status cicilan dan kas diperbarui. Jika semua cicilan lunas, pinjaman ditandai Lunas.",
      "Jika laporan ditolak, baca alasan lalu laporkan kembali data yang benar. Pilih Perbarui status untuk memuat rincian terbaru. Jangan mentransfer ulang sebelum memastikan mutasi bank Anda.",
    ],
    target: "Cicilan",
  },
  {
    id: "notifications",
    title: "Membaca pemberitahuan email",
    description:
      "Lonceng menunjukkan jumlah pemberitahuan akun Anda yang belum dibaca.",
    steps: [
      "Tekan lonceng di kanan atas atau pilih Notifikasi di sidebar.",
      "Gunakan filter Belum dibaca untuk menemukan pemberitahuan baru. Tandai satu per satu atau pilih Tandai semua dibaca.",
      "Buka rincian dari notifikasi untuk melihat pinjaman atau pembayaran terkait. Membaca notifikasi tidak mengubah status transaksi.",
      "Buka Pengaturan untuk melihat alamat email akun dan riwayat pengiriman pemberitahuan.",
      "Riwayat email menampilkan status pengiriman. Status diterima server email tidak berarti pesan sudah dibaca.",
    ],
    target: "Notifikasi",
  },
  {
    id: "account",
    title: "Menu akun dan keluar",
    description: "Identitas akun kini berada di kanan atas.",
    steps: [
      "Tekan nama atau avatar di kanan atas untuk melihat nama, kontak, dan peran.",
      "Pilih Pengaturan untuk melihat email tujuan dan riwayat pengiriman.",
      "Pilih Keluar dari akun setelah selesai, terutama pada perangkat bersama.",
      "Jika lupa password atau nomor akun salah, hubungi admin keluarga. Pengubahan password mandiri belum tersedia.",
    ],
  },
];
const managerGuide: Guide = {
  id: "management",
  title: "Panduan admin dan bendahara",
  description:
    "Pisahkan keputusan pengajuan, transfer dana, dan pencatatan pencairan.",
  steps: [
    "Buka Persetujuan → Menunggu Saya. Hanya petugas pada tahap aktif yang dapat menyetujui, menolak, atau mengembalikan pengajuan.",
    "Gunakan Tolak dengan alasan yang jelas jika pengajuan belum dapat dipenuhi.",
    "Setelah semua approver menyetujui dan transfer dilakukan di luar aplikasi, Releaser yang berbeda memilih Catat pencairan. Jadwal cicilan baru dibentuk pada langkah ini.",
    "Cicilan pertama dijadwalkan sebulan setelah pencairan. Tanggal akhir bulan disesuaikan jika bulan berikutnya lebih pendek.",
    "Pantau cicilan Terlambat dan tindak lanjuti secara pribadi. Jangan membagikan rincian pinjaman ke pihak yang tidak berkepentingan.",
    "Admin keluarga dapat menambahkan anggota; bendahara menangani dana sesuai hak aksesnya.",
  ],
  target: "Persetujuan",
};

export function HelpGuide({
  user,
  onNavigate,
}: {
  user: SessionUser;
  onNavigate: (page: AppPage) => void;
}) {
  const hierarchyGuide: Guide = {
    id: "hierarchy",
    title: "Mengatur hirarki approval",
    description:
      "Satu konfigurasi aktif per keluarga dengan urutan dan riwayat versi.",
    steps: [
      "Buka Setup Hirarki dan pilih keluarga yang ingin diatur. Super Admin dapat memilih seluruh keluarga; Admin hanya keluarganya sendiri.",
      "Pilih Maker, tambahkan approver secara berurutan, misalnya Dani lalu Danang, dan pilih Releaser yang berbeda.",
      "Seluruh petugas harus anggota aktif keluarga tersebut. Pembuat dan peminjam tidak boleh menjadi approver atau releaser pada pengajuan yang sama.",
      "Isi alasan lalu simpan. Untuk dua approver diperlukan minimal empat orang berbeda: Maker, Dani, Danang, dan Releaser.",
      "Perubahan berlaku untuk pengajuan baru. Pengajuan berjalan tetap menggunakan versi saat diajukan. Pinjaman lama tanpa snapshot memerlukan tinjauan migrasi.",
      "Super Admin mengatur akses dan hirarki, tetapi tidak dapat menyetujui atau mencairkan pinjaman.",
    ],
    target: "Setup Hirarki",
  };
  const registrationGuide: Guide = {
    id: "registration",
    title: "Mendaftarkan keluarga dan anggota",
    description: "Akun dibuat oleh administrator; email digunakan untuk masuk.",
    steps: [
      "Super Admin membuka Anggota lalu memilih keluarga yang akan ditampilkan. Gunakan Tambah anggota untuk membuat keluarga, membuat akun, atau menghubungkan akun yang sudah ada.",
      "Untuk keluarga baru, isi satu identitas admin dan data keluarga lalu pilih Buat keluarga dan admin. Admin pertama ditetapkan otomatis.",
      "Akun baru memerlukan email, nomor telepon, password dan konfirmasi password yang sama. Sampaikan kredensial awal melalui jalur aman; aplikasi tidak mengirim undangan otomatis.",
      "Untuk akun lama, cari lalu pilih akun aktif dan keluarga tujuan. Password lama tetap berlaku. Penghubungan akun dilakukan Super Admin.",
      "Admin keluarga hanya membuat akun pada keluarganya sendiri. Role Admin tidak otomatis memberi hak approval; atur petugas melalui Setup Hirarki.",
    ],
    target: "Anggota",
  };
  const visible =
    user.systemRole === "SUPER_ADMIN"
      ? [
          registrationGuide,
          hierarchyGuide,
          ...guides.filter((guide) =>
            ["notifications", "account"].includes(guide.id),
          ),
        ]
      : [
          ...guides,
          managerGuide,
          ...(user.familyRole === "ADMIN"
            ? [registrationGuide, hierarchyGuide]
            : []),
        ];
  return (
    <section className="help-guide" aria-label="Panduan aplikasi Dana Keluarga">
      <div className="guide-welcome">
        <BookOpen size={30} aria-hidden="true" />
        <div>
          <h2>Mulai dari kebutuhan Anda</h2>
          <p>
            Panduan untuk {roleLabel(user).toLowerCase()}: mengenali menu,
            mengikuti alur dana, dan menemukan bantuan.
          </p>
        </div>
      </div>
      <Feedback tone="info" title="Status fitur saat ini">
        Pemberitahuan menggunakan email akun. Status pengiriman tersedia di
        Pengaturan. Pembayaran cicilan dilakukan melalui transfer bank manual.
        Hanya peminjam melaporkan transfer, kemudian pengelola dana keluarga
        mengonfirmasi uang masuk berdasarkan mutasi rekening.
      </Feedback>
      <div className="guide-topics">
        {visible.map((guide, index) => (
          <details
            className="guide-topic"
            key={guide.id}
            open={index === 0 ? true : undefined}
          >
            <summary>
              <span>
                <strong>{guide.title}</strong>
                <small>{guide.description}</small>
              </span>
              <ChevronRight size={19} aria-hidden="true" />
            </summary>
            <div className="guide-topic-content">
              <ol>
                {guide.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {guide.target && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onNavigate(guide.target!)}
                >
                  Buka {guide.target}
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </details>
        ))}
      </div>
      <section className="panel guide-troubleshooting">
        <h2>Jika mengalami kendala</h2>
        <dl>
          <dt>Tidak bisa masuk</dt>
          <dd>
            Periksa email, password, dan Caps Lock. Ikon mata membantu memeriksa
            password. Hubungi admin jika akses belum tersedia.
          </dd>
          <dt>Akses ditolak</dt>
          <dd>
            Pastikan Anda masuk dengan akun dan peran yang sesuai. Pengelola
            dapat membantu memeriksa keanggotaan keluarga.
          </dd>
          <dt>Notifikasi belum muncul</dt>
          <dd>
            Tekan Perbarui. Notifikasi baru muncul setelah ada aktivitas terkait
            akun Anda. Riwayat aktivitas tetap dapat dibaca di dalam aplikasi.
          </dd>
          <dt>Email belum masuk</dt>
          <dd>
            Periksa folder spam dan riwayat pengiriman di Pengaturan. Jika mode
            pengiriman belum aktif, hubungi pengelola untuk konfigurasi SMTP
            atau Resend.
          </dd>
          <dt>Pembayaran masih menunggu</dt>
          <dd>
            Pilih Perbarui status pada detail cicilan. Jika masih menunggu,
            hubungi pengelola dana untuk memeriksa mutasi rekening. Jangan
            transfer ulang hanya karena laporan belum dikonfirmasi.
          </dd>
        </dl>
      </section>
    </section>
  );
}
