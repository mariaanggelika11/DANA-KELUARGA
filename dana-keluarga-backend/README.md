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

Isi credential PostgreSQL, JWT, seed admin, payment provider, dan WhatsApp hanya melalui `.env`. Versi ini hanya memproses pratinjau WhatsApp; koneksi/session WhatsApp nyata belum tersedia.

## Role dan registrasi

`SUPER_ADMIN` adalah role global pemilik aplikasi dan dibuat melalui `SEED_SUPER_ADMIN_*`. Setelah login, Super Admin membuat keluarga beserta Admin pertama melalui `POST /api/v1/management/families`. Admin keluarga kemudian mendaftarkan user baru melalui `POST /api/v1/management/members` dengan role `MEMBER` atau `TREASURER`. Registrasi publik tidak tersedia.

## WhatsApp dan pembayaran simulasi

Baca [panduan lengkap](../docs/whatsapp-simulation.md). Gunakan database pengembangan terpisah, jalankan `npx prisma generate` dan `npx prisma migrate deploy`, lalu `npm run dev`. Pengaturan default: `WHATSAPP_ENABLED=false`, `WHATSAPP_MODE=simulation`, `PAYMENT_PROVIDER=sandbox`.

- `GET /api/v1/notifications`: riwayat pesan berdasarkan hak akses, 50 per halaman (`?page=1`).
- `GET/PATCH /api/v1/notifications/preferences`: nomor dan persetujuan akun sendiri; PATCH menerima `{ "enabled": true }`.
- `GET /api/v1/payments/installments/:id`: detail cicilan dan riwayat pembayaran dengan pemeriksaan akses.
- `POST /api/v1/payments/loans/:loanId/installments/:installmentId`: membuat/menggunakan ulang pembayaran simulasi yang belum kedaluwarsa.
- `POST /api/v1/payments/:id/simulate-success`: khusus pengelola dan non-production, mencatat keberhasilan simulasi secara idempotent.
- `POST /api/v1/payments/webhooks/:provider`: dinonaktifkan (503) sampai adapter dan verifikasi provider tersedia.

Worker berjalan di proses server setiap 30 detik. `npm test` memakai mock database dan server HTTP localhost sementara. Build backend dijalankan dengan `npm run build`, kemudian `npm start` memakai `dist/src/server.js`.

## Kotak masuk aplikasi

`GET /api/v1/notifications/inbox?page=1&unread=false` mengembalikan pemberitahuan akun sendiri, 20 per halaman. `GET /api/v1/notifications/inbox/unread-count` menyediakan jumlah untuk badge lonceng. `PATCH /api/v1/notifications/inbox/:id/read` dan `PATCH /api/v1/notifications/inbox/read-all` hanya mengubah status baca milik akun yang login. Hak admin tidak memberi akses menandai kotak masuk akun lain.

Kotak masuk tetap menerima aktivitas baru walaupun persetujuan WhatsApp dimatikan. Status baca aplikasi terpisah dari status pengiriman WhatsApp. Tabel `Notification` yang sudah ada digunakan tanpa migration tambahan.
