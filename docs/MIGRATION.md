# Migration approval hierarchy — 16 September 2026

Migration: `20260916090000_approval_hierarchy`.

**Status: sudah diterapkan** pada database yang dikonfigurasi backend dengan `prisma migrate deploy`. `prisma migrate status` melaporkan empat migration selesai dan schema up to date. Tidak ada reset, db push, seed dummy, penghapusan data, atau konversi role lama.

## Audit sebelum dan setelah

| Data | Sebelum | Setelah |
| --- | ---: | ---: |
| User | 5 | 5 |
| Family | 2 | 2 |
| FamilyMember | 5 | 5 |
| Loan | 1 | 1 |
| LoanInstallment | 5 | 5 |
| LedgerEntry | 3 | 3 |
| Payment | 0 | 0 |
| Notification | 0 | 0 |
| AuditLog | 0 | 0 |
| WhatsAppMessage | 0 | 0 |
| RefreshToken | 40 | 40 |

Lima tabel approval baru tersedia, masing-masing 0 baris. Tidak ada petugas keluarga asli yang dipilih otomatis. Pemeriksaan membandingkan isi seluruh baris lama, bukan hanya jumlahnya: semua sama persis, kecuali kolom baru nullable `Loan.approvalRequestId` yang berisi NULL sesuai rencana.

Role keluarga: 2 ADMIN, 2 MEMBER, 1 TREASURER. TREASURER dipertahankan sebagai data legacy, tetapi pendaftaran role baru hanya ADMIN/MEMBER. Hak persetujuan pinjaman harus berasal dari assignment.

## Salinan data

Sebelum penerapan dibuat snapshot seluruh tabel pada transaksi PostgreSQL `REPEATABLE READ READ ONLY`:

- Lokasi privat: `.local-backups/before-approval-1789566922499.json` di root repo, file mode 0600, direktori mode 0700.
- SHA-256: `e22d025eb339f465e72a3ada63e57c27ea99c74ac6b8cf552d992d9f3b0797d1`.
- Direktori diabaikan Git. File mengandung data sensitif aplikasi; jangan dimasukkan commit atau dibagikan.
- Ini adalah **snapshot data JSON**, bukan backup `pg_dump` lengkap. `pg_dump` tidak tersedia pada lingkungan eksekusi ini. DDL yang digunakan tersimpan dalam migration repository.

Untuk deployment produksi berikutnya, siapkan backup PostgreSQL lengkap dan uji restore terlebih dahulu. Dengan `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, dan `PGPASSFILE` dikonfigurasi melalui penyimpanan kredensial yang aman:

```sh
pg_dump --format=custom --file=dana-keluarga-before-migration.dump
pg_restore --list dana-keluarga-before-migration.dump
```

Uji pemulihan ke database terpisah, bukan menimpa database aplikasi. Snapshot JSON di atas memerlukan prosedur import yang memperhatikan urutan foreign key; jangan menganggapnya dapat langsung dipakai oleh `pg_restore`.

## Perubahan database

Migration berjalan dalam satu transaksi. Penambahan mencakup lima tabel approval, enum workflow, foreign key, index lookup, unique reference/urutan, satu policy aktif per keluarga/jenis, check nominal/urutan, dan trigger antiubah riwayat tindakan. `Loan.approvalRequestId` nullable sehingga pinjaman lama tetap dapat dibaca.

Migration tidak mengisi assignment atau menyimpulkan approval historis. Setelah login, Super Admin/Admin keluarga harus mengisi Setup Hirarki untuk pengajuan baru. Restart backend setelah deployment agar proses memakai Prisma Client terbaru; rebuild frontend untuk penyajian produksi.

```sh
cd dana-keluarga-backend
npm run prisma:generate
npm run prisma:validate
npx prisma migrate deploy
npm run build
```

## Temuan transaksi lama yang perlu keputusan pengelola

Satu pinjaman lama berstatus `APPROVED`, nominal Rp5.000.000, memiliki 5 cicilan, `disbursedAt = NULL`, dan tidak ada ledger `LOAN_DISBURSEMENT`. Migration mempertahankannya persis. Persetujuan/pencairan melalui endpoint lama diblokir dengan `LEGACY_WORKFLOW_REQUIRED` karena belum ada snapshot workflow yang dapat dipercaya.

Sebelum memperbaiki transaksi tersebut, pengelola perlu memastikan apakah uang benar-benar pernah ditransfer dan mencocokkan buktinya. Jika sudah ditransfer, rekonsiliasi harus mempertahankan cicilan yang ada dan meninjau pencatatan kas. Jika belum, penanganan jadwal lama dan pengajuan baru perlu keputusan eksplisit. Tidak ada pencairan, pembatalan cicilan, atau riwayat keputusan yang dibuat berdasarkan tebakan.

## Pemeriksaan migration

Seluruh migration diuji terlebih dahulu dalam schema sementara PostgreSQL 16, lalu workflow dijalankan dengan empat petugas fixture. Schema sementara telah dihapus. Setelah penerapan pada schema aplikasi, isi seluruh tabel lama dibandingkan dengan snapshot dan lima tabel baru diperiksa. Tidak ada data fixture yang tertinggal pada schema aplikasi.

Rollback aplikasi tidak otomatis menghapus tabel baru. Pertahankan migration dan riwayat, lalu gunakan migration korektif bila diperlukan; jangan menghapus tabel approval setelah menerima transaksi.
