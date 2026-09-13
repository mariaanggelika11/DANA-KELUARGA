import { BookOpen, ChevronRight } from 'lucide-react'
import { Feedback } from './Feedback'
import { roleLabel, type AppPage, type SessionUser } from '../types/navigation'
import './HelpGuide.css'

type Guide = {
  id: string
  title: string
  description: string
  steps: string[]
  target?: AppPage
}
const guides: Guide[] = [
  {
    id: 'overview',
    title: 'Memahami ringkasan dan kas',
    description:
      'Lihat posisi dana keluarga dan catatan uang masuk atau keluar.',
    steps: [
      'Buka Ringkasan untuk melihat saldo kas dan sisa dana yang masih dipinjamkan.',
      'Buka Kas untuk membaca tanggal, keterangan, dan nominal setiap transaksi.',
      'Admin atau bendahara dapat menambahkan catatan kas. Anggota dapat melihat catatan sesuai akses keluarga.',
    ],
    target: 'Kas',
  },
  {
    id: 'loans',
    title: 'Mengajukan dan memantau pinjaman',
    description:
      'Pengajuan dilakukan melalui aplikasi dan diperiksa pengelola keluarga.',
    steps: [
      'Anggota membuka Pinjaman, lalu memilih Ajukan pinjaman.',
      'Isi nominal, tenor dalam bulan, dan tujuan. Periksa kembali sebelum mengirim.',
      'Status Menunggu persetujuan berarti pengajuan sedang ditinjau. Disetujui berarti masih menunggu pencairan.',
      'Jika ditolak, baca alasan yang diberikan. Jika sudah dicairkan, lihat jadwal pada menu Cicilan.',
      'Selesaikan pinjaman yang masih berjalan sebelum membuat pengajuan baru.',
    ],
    target: 'Pinjaman',
  },
  {
    id: 'installments',
    title: 'Melihat cicilan dan pembayaran',
    description:
      'Setiap cicilan memiliki nominal, tanggal jatuh tempo, status, dan riwayat.',
    steps: [
      'Buka Cicilan, pilih nama anggota, lalu buka Lihat pembayaran pada cicilan yang dipilih.',
      'Periksa sisa cicilan dan status sebelum membuat pembayaran.',
      'Pada mode simulasi, anggota dapat membuat pembayaran uji. Hanya pengelola yang dapat mengonfirmasi keberhasilannya.',
      'Setelah konfirmasi, status cicilan dan kas diperbarui. Jika semua cicilan lunas, pinjaman ditandai Lunas.',
      'Jika status belum berubah, pilih Perbarui status. Hubungi pengelola bila masih tidak sesuai.',
    ],
    target: 'Cicilan',
  },
  {
    id: 'notifications',
    title: 'Membaca notifikasi dan mengatur WhatsApp',
    description:
      'Lonceng menunjukkan jumlah pemberitahuan akun Anda yang belum dibaca.',
    steps: [
      'Tekan lonceng di kanan atas atau pilih Notifikasi di sidebar.',
      'Gunakan filter Belum dibaca untuk menemukan pemberitahuan baru. Tandai satu per satu atau pilih Tandai semua dibaca.',
      'Buka rincian dari notifikasi untuk melihat pinjaman atau pembayaran terkait. Membaca notifikasi tidak mengubah status transaksi.',
      'Pada Pengaturan, aktifkan persetujuan WhatsApp jika ingin menerima pemberitahuan melalui nomor akun Anda.',
      'Notifikasi di aplikasi tetap tersedia meskipun persetujuan WhatsApp dimatikan. Riwayat WhatsApp menampilkan hasil pemrosesan, bukan status baca kotak masuk.',
    ],
    target: 'Notifikasi',
  },
  {
    id: 'account',
    title: 'Menu akun dan keluar',
    description: 'Identitas akun kini berada di kanan atas.',
    steps: [
      'Tekan nama atau avatar di kanan atas untuk melihat nama, kontak, dan peran.',
      'Pilih Pengaturan notifikasi untuk mengubah persetujuan WhatsApp.',
      'Pilih Keluar dari akun setelah selesai, terutama pada perangkat bersama.',
      'Jika lupa password atau nomor akun salah, hubungi admin keluarga. Pengubahan password mandiri belum tersedia.',
    ],
  },
]
const managerGuide: Guide = {
  id: 'management',
  title: 'Panduan admin dan bendahara',
  description:
    'Pisahkan keputusan pengajuan, transfer dana, dan pencatatan pencairan.',
  steps: [
    'Periksa nominal, tujuan, dan saldo kas sebelum menyetujui pengajuan.',
    'Gunakan Tolak dengan alasan yang jelas jika pengajuan belum dapat dipenuhi.',
    'Setelah dana ditransfer di luar aplikasi, pilih Catat pencairan. Tindakan ini mencatat kas keluar dan membentuk jadwal cicilan.',
    'Cicilan pertama dijadwalkan sebulan setelah pencairan. Tanggal akhir bulan disesuaikan jika bulan berikutnya lebih pendek.',
    'Pantau cicilan Terlambat dan tindak lanjuti secara pribadi. Jangan membagikan rincian pinjaman ke pihak yang tidak berkepentingan.',
    'Admin keluarga dapat menambahkan anggota; bendahara menangani dana sesuai hak aksesnya.',
  ],
  target: 'Pinjaman',
}

export function HelpGuide({
  user,
  onNavigate,
}: {
  user: SessionUser
  onNavigate: (page: AppPage) => void
}) {
  const manager =
    user.systemRole === 'SUPER_ADMIN' ||
    ['ADMIN', 'TREASURER'].includes(user.familyRole ?? '')
  const visible = manager ? [...guides, managerGuide] : guides
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
        Pengiriman WhatsApp dan pembayaran masih dalam mode simulasi. Tidak ada
        pesan WA atau transfer uang otomatis. Konfirmasi pembayaran uji tetap
        mengubah catatan kas pada ruang yang digunakan.
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
            akun Anda; persetujuan WA tidak diperlukan untuk membaca kotak masuk
            aplikasi.
          </dd>
          <dt>WhatsApp belum masuk</dt>
          <dd>
            Versi saat ini belum mengirim pesan nyata. Lihat hasil simulasi
            melalui Riwayat WhatsApp pada Pengaturan.
          </dd>
          <dt>Pembayaran masih menunggu</dt>
          <dd>
            Pada mode simulasi, minta pengelola memeriksa pembayaran uji. Jangan
            melakukan transfer nyata berdasarkan tampilan simulasi.
          </dd>
        </dl>
      </section>
    </section>
  )
}
