# Dana Keluarga

Modular monolith untuk pengelolaan kas keluarga: dashboard, ledger, anggota, pinjaman, cicilan, pembayaran, target dana, notifikasi, audit, dan integrasi WhatsApp/payment gateway.

## Struktur

- `dana-keluarga-frontend`: React + TypeScript + Vite
- `dana-keluarga-backend`: Express + TypeScript + Prisma + PostgreSQL

## Menjalankan

1. Salin `dana-keluarga-backend/.env.example` menjadi `.env` dan isi `DATABASE_URL`, JWT secrets, serta seed credentials.
2. Jalankan `cd dana-keluarga-backend && npm install`.
3. Jalankan `npx prisma generate && npx prisma migrate dev && npm run prisma:seed`.
4. Jalankan `npm run dev`.
5. Di terminal lain, jalankan `cd dana-keluarga-frontend && npm install && npm run dev`.

Database baru harus dibuat oleh administrator PostgreSQL bila user tidak memiliki privilege `CREATEDB`:

```sql
CREATE DATABASE dana_keluarga OWNER your_database_user ENCODING 'UTF8';
```

## Status MVP

Schema ledger dan domain utama, precision nominal, seed, health/readiness, auth login, dashboard aggregate, dan UI reference baseline telah disiapkan. Payment gateway dan WhatsApp memerlukan credential/perangkat eksternal sebelum diaktifkan di production. Migration, loan workflow lengkap, RBAC, webhook idempotency, dan test integration adalah tahap berikutnya setelah koneksi PostgreSQL tersedia.
