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

## Status implementasi

Pengelolaan anggota, kas, pengajuan/persetujuan/pencairan pinjaman, dan jadwal cicilan tersedia. Alur notifikasi WhatsApp serta pembayaran kini memiliki **mode simulasi** dengan antrean persisten, persetujuan penerima, pengingat H-3/hari H, halaman cicilan, dan riwayat pesan.

Pengiriman WhatsApp nyata dan payment gateway belum diaktifkan. Tidak ada QRIS yang dapat dibayar pada mode simulasi. Konfirmasi simulasi hanya tersedia untuk pengelola pada lingkungan pengembangan dan tetap mengubah catatan database pengembangan.

Lihat [panduan WhatsApp dan pembayaran simulasi](docs/whatsapp-simulation.md) untuk migration, konfigurasi, aturan jadwal, pengujian, dan batas implementasi. Migration baru harus diterapkan pada database tujuan sebelum menjalankan kode ini.
