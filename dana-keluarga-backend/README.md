# Dana Keluarga Backend

## Commands

```bash
npm install
cp .env.example .env
npx prisma validate
npx prisma generate
npx prisma migrate dev
npm run prisma:seed
npm run dev
npm run build
npm start
```

Production memakai `npx prisma migrate deploy`, bukan `db push`. REST API menggunakan `/health`, `/ready`, `/api/v1/auth/login`, dan `/api/v1/dashboard/summary` pada fondasi awal ini.

Notifikasi menggunakan outbox email dengan retry. Pengiriman nyata memerlukan konfigurasi SMTP atau Resend. Pembayaran cicilan memakai transfer bank manual: peminjam melaporkan transfer dan pengelola dana (TREASURER) keluarga mengonfirmasi mutasi rekening.

## Role dan registrasi

`SUPER_ADMIN` adalah role global pemilik aplikasi dan dibuat melalui `SEED_SUPER_ADMIN_*`. Setelah login, Super Admin membuat keluarga beserta Admin pertama melalui `POST /api/v1/management/families`. Admin keluarga kemudian mendaftarkan user baru melalui `POST /api/v1/management/members` dengan role `MEMBER`, `ADMIN`, atau `TREASURER`. Peran `TREASURER` (Pengelola dana) dapat ditetapkan melalui pengelolaan anggota dan diperlukan untuk mengatur rekening serta memeriksa transfer. Registrasi publik tidak tersedia.

Notifikasi menggunakan outbox email dengan retry. Pengiriman nyata memerlukan konfigurasi SMTP atau Resend. Pembayaran cicilan memakai transfer bank manual: peminjam melaporkan transfer dan pengelola dana (TREASURER) keluarga mengonfirmasi mutasi rekening.

Lihat [panduan Kas Keluarga dan email](../docs/FAMILY_CASH.md) untuk migration, konfigurasi SMTP, dan pengujian. Untuk alur transfer manual dan rekening tujuan, lihat [panduan pembayaran](../docs/PAYMENTS.md).

- `GET /api/v1/notifications`: riwayat pesan berdasarkan hak akses, 50 per halaman (`?page=1`).
- `GET /api/v1/notifications/preferences`: email akun sendiri dan mode pengiriman yang aktif. Tidak ada pengaturan nomor WhatsApp atau PATCH persetujuan email.
- `GET /api/v1/payments/installments/:id`: detail cicilan dan riwayat pembayaran dengan pemeriksaan akses.
- `POST /api/v1/payments/loans/:loanId/installments/:installmentId`: hanya peminjam, melaporkan seluruh sisa cicilan dengan UUID idempotensi dan rekening tujuan. `expectedRemainingAmount` memeriksa bahwa nominal yang dilihat belum berubah; nominal laporan ditentukan server. Format rinci lama tetap diterima untuk kompatibilitas.
- `POST /api/v1/payments/:id/confirm` dan `/:id/reject`: hanya pengelola dana keluarga tersebut yang bukan peminjam. Catatan menerima opsional; penolakan wajib menyertakan alasan minimal 5 karakter.
- `POST /api/v1/payments/webhooks/:provider`: dinonaktifkan (410); tidak ada integrasi gateway. Endpoint simulasi dan rekonsiliasi gateway sudah dihapus.

Worker berjalan di proses server setiap 30 detik. `npm test` memakai mock database dan server HTTP localhost sementara. Build backend dijalankan dengan `npm run build`, kemudian `npm start` memakai `dist/src/server.js`.

## Kotak masuk aplikasi

`GET /api/v1/notifications/inbox?page=1&unread=false` mengembalikan pemberitahuan akun sendiri, 20 per halaman. `GET /api/v1/notifications/inbox/unread-count` menyediakan jumlah untuk badge lonceng. `PATCH /api/v1/notifications/inbox/:id/read` dan `PATCH /api/v1/notifications/inbox/read-all` hanya mengubah status baca milik akun yang login. Hak admin tidak memberi akses menandai kotak masuk akun lain.

Pemberitahuan dicatat pada inbox aplikasi. Email hanya dikirim untuk tagihan (pengingat H-3/H, pencairan, pembayaran), pengajuan pinjaman, dan persetujuan/penolakan; setoran dan tarikan kas hanya muncul di inbox. `EMAIL_MODE` memilih penyedia: `smtp` (mis. Brevo), `resend`, `simulation`, atau `disabled`. Pindah penyedia cukup dengan mengubah `.env` lalu restart API; lihat [panduan email](../docs/FAMILY_CASH.md#email).

Laporan transfer baru mengirim email kepada pengelola dana aktif selain peminjam. Penolakan laporan mengirim alasan kepada peminjam; penerimaan mengirim pembayaran berhasil atau pinjaman lunas. Inbox dan outbox email dibuat dalam transaksi keuangan yang sama dan menggunakan event key agar pengulangan tindakan tidak menggandakan pemberitahuan. Pengingat cicilan dibatalkan selama transfer menunggu pemeriksaan, termasuk pemeriksaan ulang sebelum email dikirim.

## Memeriksa email nyata

1. Isi `EMAIL_MODE=smtp`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, dan `SMTP_PASSWORD` di `.env` lokal. Pengirim harus diizinkan penyedia. Mode Resend memakai `EMAIL_MODE=resend` dan `RESEND_API_KEY`.
2. Jalankan `npm run email:check` untuk mengecek koneksi TLS dan autentikasi SMTP tanpa mengirim pesan.
3. Jalankan `npm run email:check -- --to alamat-akun@example.com` untuk mengirim satu email uji melalui outbox aplikasi ke akun anggota keluarga aktif. Perintah hanya memproses record uji tersebut dan tidak mengubah saldo atau cicilan.
4. Build dan restart API agar worker memakai konfigurasi baru. Buka **Pengaturan → Riwayat pengiriman email**. `SENT` berarti server penyedia telah menerima pesan, bukan jaminan pesan masuk inbox. Periksa inbox/spam penerima.

Record lama `CANCELLED` atau `SIMULATED` tetap menjadi riwayat dan tidak dikirim ulang saat mode berubah. Pesan baru yang sesuai jenisnya memakai pengiriman nyata. Tes otomatis selalu memakai konfigurasi email pengujian dan provider mock, bukan kredensial `.env` lokal.

## Registrasi yang konsisten

Baca [alur registrasi dan hasil audit UI/API](../docs/AUDIT_2026-09-18.md). Endpoint pembuatan akun mewajibkan `email`, `password` dan `confirmPassword`, selain nama dan nomor telepon. Email dipakai untuk masuk. Registrasi tetap dikelola administrator; tidak ada registrasi publik atau pengiriman undangan otomatis.

Super Admin menggunakan `POST /api/v1/management/registrations` dengan `type` `NEW_FAMILY`, `NEW_MEMBER`, atau `EXISTING_MEMBER`. Akun lama hanya memerlukan `existingUserId`, `familyId`, dan `role`; passwordnya tidak diubah. Ketiga jalur dan endpoint kompatibilitas `/management/families`/`members` memakai service transaksi yang sama. Jangan memanggil seed untuk menguji alur registrasi pada database produksi.

## Kas Keluarga

Aturan kontribusi/tarikan/pinjaman, API, pengujian, SMTP, dan status migration terbaru: [panduan Kas Keluarga](../docs/FAMILY_CASH.md). Migration kas sudah diterapkan. Database dikosongkan atas permintaan pengguna dan hanya akun Super Admin dipertahankan. Jangan menjalankan seed jika ingin mempertahankan kondisi kosong.

- `GET/PUT /api/v1/payments/bank-account`: membaca rekening keluarga; hanya pengelola dana dapat menyimpan versi baru.
- `GET /api/v1/payments/pending?page=1`: antrean transfer keluarga yang perlu diperiksa oleh pengelola dana, tanpa pembayaran pinjamannya sendiri.
- `POST /api/v1/approvals/:id/reassign`: khusus Admin keluarga, mengganti petugas pada tahap aktif dengan alasan dan jejak audit.
- `GET /api/v1/ledger?page=1` dan `GET /api/v1/cash?page=1`: halaman riwayat berisi 20 catatan, tanpa batas total 100 catatan.
