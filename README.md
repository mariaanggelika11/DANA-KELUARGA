# Dana Keluarga

Modular monolith untuk pengelolaan kas keluarga: dashboard, ledger, anggota, pinjaman, cicilan, transfer bank manual, notifikasi, audit, dan email.

## Struktur

- `dana-keluarga-frontend`: React + TypeScript + Vite
- `dana-keluarga-backend`: Express + TypeScript + Prisma + PostgreSQL

## Menjalankan

1. Salin `dana-keluarga-backend/.env.example` menjadi `.env` dan isi `DATABASE_URL` serta JWT secrets.
2. Jalankan `cd dana-keluarga-backend && npm install`.
3. Jalankan `npx prisma generate` dan `npx prisma migrate dev`. Pada database baru, isi `SEED_SUPER_ADMIN_*` dengan identitas pemilik aplikasi lalu jalankan `npm run prisma:seed` satu kali untuk membuat Super Admin.
4. Jalankan `npm run dev`.
5. Di terminal lain, jalankan `cd dana-keluarga-frontend && npm install && npm run dev`.

Database baru harus dibuat oleh administrator PostgreSQL bila user tidak memiliki privilege `CREATEDB`:

```sql
CREATE DATABASE dana_keluarga OWNER your_database_user ENCODING 'UTF8';
```

## Status implementasi

Bootstrap hanya membuat akun Super Admin dari konfigurasi lokal. Tidak ada keluarga, anggota, saldo, atau transaksi dummy yang dibuat. Pengulangan dengan identitas Super Admin yang sama tidak mengubah akun atau password. Daftarkan keluarga dan anggota melalui aplikasi.

Notifikasi menggunakan outbox email dengan retry melalui SMTP atau Resend. Pembayaran cicilan dilakukan melalui transfer bank manual yang dilaporkan peminjam dan dikonfirmasi pengelola dana.

Lihat [panduan Kas Keluarga dan email](docs/FAMILY_CASH.md) untuk migration, konfigurasi email, dan pengujian, serta [panduan pembayaran](docs/PAYMENTS.md) untuk alur transfer manual. Fixture pengujian berada di folder tests/scripts, tidak dimuat aplikasi, dan pengujian database menggunakan schema sementara.
