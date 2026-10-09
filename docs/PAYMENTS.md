# Pembayaran cicilan dengan transfer bank manual

Pembayaran dilakukan melalui bank peminjam ke rekening keluarga. Aplikasi mencatat laporan transfer dan hasil pemeriksaan pengelola dana; tidak memindahkan uang, menggunakan payment gateway, atau menyediakan simulasi pembayaran.

## Hak akses

| Peran | Melaporkan transfer | Melihat cicilan | Mengatur rekening | Memeriksa uang masuk |
| --- | --- | --- | --- | --- |
| Anggota/peminjam | Hanya pinjaman sendiri | Milik sendiri | Tidak | Tidak |
| Admin keluarga | Hanya jika ia peminjam | Keluarga aktif | Tidak | Tidak |
| Pengelola dana (TREASURER) | Hanya jika ia peminjam | Keluarga aktif | Ya | Keluarga aktif, selain pinjamannya sendiri |
| Super Admin | Tidak | Tidak menjalankan transaksi keluarga | Tidak | Tidak |

Role diperiksa dari keanggotaan aktif terbaru, bukan hanya klaim token. Admin dapat menetapkan role Pengelola dana melalui pengelolaan anggota. Jika pengelola sendiri memiliki pinjaman, pengelola dana lain pada keluarga tersebut harus memeriksa transfernya.

## Menyiapkan rekening keluarga

1. Pengelola dana membuka **Pengaturan → Rekening pembayaran keluarga**.
2. Isi **Nama bank**, **Nomor rekening**, dan **Nama pemilik rekening**. Nomor rekening disimpan sebagai teks agar angka nol di depan tidak hilang.
3. Pilih **Simpan rekening** dan periksa kembali tujuan transfer.

Rekening memakai versi baru setiap disimpan. Versi lama tidak diedit atau dihapus; laporan menyimpan hubungan ke rekening tujuan yang ditampilkan ketika peminjam melapor. Pengubahan rekening tidak mengganti rekening pada laporan yang sudah ada. Editor rekening yang tertinggal versi ditolak agar tidak menimpa perubahan pengelola lain.

## Peminjam membayar

1. Buka **Cicilan → Lihat pembayaran** pada cicilan milik sendiri.
2. Periksa sisa tagihan dan rekening keluarga. Jika rekening belum diatur, hubungi pengelola sebelum transfer.
3. Transfer seluruh sisa cicilan melalui aplikasi bank, ATM, atau kanal bank Anda.
4. Klik **Saya sudah transfer**. Tanpa formulir tambahan, laporan langsung menjadi **Menunggu pemeriksaan** dan tombol pelaporan disembunyikan. Nominal otomatis mengikuti sisa cicilan yang diperiksa server. Kas dan sisa cicilan belum berubah.

Hanya peminjam dapat mengirim laporan; Admin atau bendahara tidak boleh melaporkan pembayaran atas nama peminjam lain. Waktu yang disimpan adalah waktu laporan, bukan waktu transfer bank. Nomor referensi bank tidak dibuat otomatis. Pengelola mencocokkan nama peminjam, nominal dan rekening tujuan dengan mutasi bank. Bila membutuhkan bukti tambahan, peminjam menyampaikannya melalui jalur keluarga yang disepakati.

## Pengelola memeriksa

1. Buka **Cicilan → Transfer menunggu pemeriksaan**, lalu **Periksa transfer**.
2. Cocokkan rekening tujuan, nominal dan peminjam dengan mutasi rekening bank. Laporan peminjam saja bukan bukti bahwa uang sudah diterima. Referensi atau waktu transfer pada laporan rinci lama tetap ditampilkan bila tersedia.
3. Jika dana cocok dan sudah masuk, pilih **Dana sudah masuk**; catatan pemeriksaan opsional. Kas bertambah dan sisa cicilan berkurang.
4. Jika dana belum masuk atau data tidak sesuai, pilih **Tolak laporan** dengan alasan. Kas dan utang tidak berubah; peminjam menerima alasan dan dapat mengirim laporan yang diperbaiki.

Pemeriksaan hanya dilakukan pengelola dana yang aktif pada keluarga terkait dan berbeda dari peminjam. Tidak ada kedaluwarsa otomatis untuk laporan transfer yang menunggu pemeriksaan. Jangan mentransfer ulang hanya karena status masih menunggu.

## Status pembayaran

| Kondisi | Status pada cicilan | Dampak kas dan tagihan |
| --- | --- | --- |
| Belum melapor dan belum ada pembayaran | Belum dibayar | Tidak berubah |
| Laporan manual belum diperiksa | Menunggu pemeriksaan | Tidak berubah; pengingat transfer ditunda |
| Laporan ditolak | Kembali ke status tagihan, disertai alasan penolakan | Tidak berubah; dapat melapor ulang |
| Laporan diterima, sisa cicilan nol | Lunas | Kas bertambah dan tagihan berkurang |
| Pembayaran sebagian dari laporan rinci lama diterima | Sebagian dibayar, atau Terlambat jika lewat jatuh tempo | Kas bertambah sesuai penerimaan |
| Belum lunas setelah tanggal jatuh tempo WIB | Terlambat | Tetap dapat melapor |
| Semua cicilan sudah nol | Pinjaman lunas | Loan dan FundRequest menjadi PAID_OFF |

Status Menunggu pemeriksaan ditampilkan sama pada detail dan jadwal cicilan. Catatan provider lama dipertahankan sebagai **Catatan lama**, tanpa tombol konfirmasi atau label menunggu pemeriksaan aktif. Format laporan rinci sebelumnya tetap diterima API untuk kompatibilitas, tetapi halaman baru memakai laporan seluruh sisa cicilan dengan satu klik.

Laporan baru mengirim pemberitahuan aplikasi dan email kepada pengelola dana aktif selain peminjam. Penolakan mengirim alasan ke peminjam; konfirmasi mengirim pembayaran berhasil atau pinjaman lunas. Email memerlukan `EMAIL_MODE=smtp` atau `resend` beserta konfigurasi penyedia yang benar. Riwayat `SENT` menunjukkan server penyedia telah menerima pesan; penerima tetap perlu memeriksa inbox/spam.

## Pencegahan pencatatan ganda

- Pengiriman ulang laporan dengan UUID dan isi sama mengembalikan laporan sebelumnya. UUID yang sama dengan isi berbeda ditolak.
- Satu cicilan hanya boleh mempunyai satu laporan transfer manual yang menunggu pemeriksaan.
- Referensi transfer yang masih pending atau sudah diterima tidak boleh dipakai ulang dalam keluarga yang sama. Referensi pada laporan ditolak dapat digunakan dalam laporan koreksi.
- Konfirmasi berulang terhadap laporan yang sudah diterima tidak menambah kas lagi. Keputusan yang sudah selesai tidak dapat dibalik lewat endpoint konfirmasi/penolakan.
- Pembayaran tidak boleh melampaui sisa cicilan. Penerimaan, ledger, cicilan, audit, notifikasi dan perubahan Loan/FundRequest menjadi PAID_OFF saat sisa seluruh cicilan nol berjalan dalam satu transaksi dengan lock keluarga lalu pinjaman.

Jika ada uang masuk berlebih atau salah konfirmasi, pengelola harus melakukan rekonsiliasi; alur ini tidak menyediakan pembalikan ledger otomatis. Laporan lama dari provider sebelumnya dipertahankan sebagai catatan historis dan tidak dapat dikonfirmasi sebagai transfer baru. Pinjaman legacy tanpa rekonsiliasi tetap perlu diperiksa.

## Pembaruan backend

Terapkan migration `20261009090000_manual_bank_transfers` dengan `npx prisma migrate deploy` pada environment tujuan, generate Prisma Client, lalu restart backend. Migration menambah tabel/kolom/indeks dan mempertahankan data lama. Tidak memerlukan API key bank atau gateway. Pengaturan rekening dilakukan dari aplikasi, bukan `.env`.


## Koreksi pembayaran yang sudah dikonfirmasi

Pengelola dana keluarga, selain peminjam, memilih **Koreksi pembayaran** pada riwayat cicilan. Alasan 5–500 karakter wajib diisi. API `POST /payments/:id/reverse` membuat transaksi kas pengimbang keluar, mempertahankan catatan pembayaran/kas lama, mengembalikan sisa tagihan, dan membuka kembali status Loan/FundRequest menjadi ACTIVE bila sebelumnya lunas. Waktu, petugas, dan alasan koreksi tercatat pada pembayaran dan audit; peminjam menerima pemberitahuan. Uang di bank tidak otomatis dikembalikan. Koreksi ditolak secara atomik bila saldo kas bebas tidak mencukupi atau catatan kas dan pembayaran tidak cocok.

Laporan pembayaran tidak dapat dikirim jika tidak tersedia pengelola dana aktif selain peminjam. Admin wajib menetapkan pemeriksa terlebih dahulu. Pengelola dana terakhir dan pemeriksa independen untuk laporan yang masih menunggu dilindungi saat mengubah peran anggota.
