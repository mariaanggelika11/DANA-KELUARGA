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

Notifikasi menggunakan outbox email dengan retry. Pengiriman nyata memerlukan konfigurasi SMTP; pembayaran online masih sandbox.

## Role dan registrasi

`SUPER_ADMIN` adalah role global pemilik aplikasi dan dibuat melalui `SEED_SUPER_ADMIN_*`. Setelah login, Super Admin membuat keluarga beserta Admin pertama melalui `POST /api/v1/management/families`. Admin keluarga kemudian mendaftarkan user baru melalui `POST /api/v1/management/members` dengan role `MEMBER` atau `ADMIN`. Peran legacy `TREASURER` tetap dipertahankan pada data lama dan tidak ditawarkan pada pendaftaran baru. Registrasi publik tidak tersedia.

Notifikasi menggunakan outbox email dengan retry. Pengiriman nyata memerlukan konfigurasi SMTP; pembayaran online masih sandbox.

Lihat [panduan Kas Keluarga dan email](../docs/FAMILY_CASH.md) untuk migration, konfigurasi SMTP, dan pengujian. Pembayaran online masih menggunakan sandbox.

- `GET /api/v1/notifications`: riwayat pesan berdasarkan hak akses, 50 per halaman (`?page=1`).
- `GET/PATCH /api/v1/notifications/preferences`: nomor dan persetujuan akun sendiri; PATCH menerima `{ "enabled": true }`.
- `GET /api/v1/payments/installments/:id`: detail cicilan dan riwayat pembayaran dengan pemeriksaan akses.
- `POST /api/v1/payments/loans/:loanId/installments/:installmentId`: membuat/menggunakan ulang pembayaran simulasi yang belum kedaluwarsa.
- `POST /api/v1/payments/:id/simulate-success`: khusus pengelola dan non-production, mencatat keberhasilan simulasi secara idempotent.
- `POST /api/v1/payments/webhooks/:provider`: dinonaktifkan (503) sampai adapter dan verifikasi provider tersedia.

Worker berjalan di proses server setiap 30 detik. `npm test` memakai mock database dan server HTTP localhost sementara. Build backend dijalankan dengan `npm run build`, kemudian `npm start` memakai `dist/src/server.js`.

## Kotak masuk aplikasi

`GET /api/v1/notifications/inbox?page=1&unread=false` mengembalikan pemberitahuan akun sendiri, 20 per halaman. `GET /api/v1/notifications/inbox/unread-count` menyediakan jumlah untuk badge lonceng. `PATCH /api/v1/notifications/inbox/:id/read` dan `PATCH /api/v1/notifications/inbox/read-all` hanya mengubah status baca milik akun yang login. Hak admin tidak memberi akses menandai kotak masuk akun lain.

Pemberitahuan dikirim melalui email akun dan dicatat pada inbox aplikasi. Konfigurasi EMAIL_MODE menentukan pengiriman SMTP, simulasi, atau nonaktif.

## Registrasi yang konsisten

Baca [alur registrasi dan hasil audit UI/API](../docs/AUDIT_2026-09-18.md). Endpoint pembuatan akun mewajibkan `email`, `password` dan `confirmPassword`, selain nama dan nomor telepon. Email dipakai untuk masuk. Registrasi tetap dikelola administrator; tidak ada registrasi publik atau pengiriman undangan otomatis.

Super Admin menggunakan `POST /api/v1/management/registrations` dengan `type` `NEW_FAMILY`, `NEW_MEMBER`, atau `EXISTING_MEMBER`. Akun lama hanya memerlukan `existingUserId`, `familyId`, dan `role`; passwordnya tidak diubah. Ketiga jalur dan endpoint kompatibilitas `/management/families`/`members` memakai service transaksi yang sama. Jangan memanggil seed untuk menguji alur registrasi pada database produksi.

## Kas Keluarga

Aturan kontribusi/tarikan/pinjaman, API, pengujian, SMTP, dan status migration terbaru: [panduan Kas Keluarga](../docs/FAMILY_CASH.md). Migration kas sudah diterapkan. Database dikosongkan atas permintaan pengguna dan hanya akun Super Admin dipertahankan. Jangan menjalankan seed jika ingin mempertahankan kondisi kosong.
