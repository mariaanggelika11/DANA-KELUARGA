# Business V2 — audit dan cakupan implementasi

Sumber: spesifikasi meeting 13 September 2026 dan tambahan menu Setup Hirarki oleh Super Admin.

Prioritas tahap ini: konfigurasi hirarki approval pinjaman per keluarga, Maker → Approver berurutan → Releaser, snapshot konfigurasi pada pengajuan, jejak keputusan dan perubahan konfigurasi, serta migrasi database tanpa menghapus riwayat.

| Area | Kondisi awal | Kebutuhan |
| --- | --- | --- |
| Approval | Satu keputusan oleh ADMIN/TREASURER atau bypass Super Admin | Assignment eksplisit dan urutan approval per keluarga |
| Pencairan | Role organisasi yang sama bisa approve dan cairkan | Releaser berbeda dari maker dan semua approver |
| Konfigurasi | Belum ada | Setup Hirarki Super Admin; Admin keluarga mengelola keluarga sendiri |
| Riwayat | approvedBy terakhir pada Loan | Request, langkah, action, versi kebijakan, audit |
| Data lama | Pinjaman/ledger/role TREASURER | Dipertahankan; tidak menebak actor atau pemilik dana |
| Tabungan/accounting | Ledger kas keluarga | Rekening anggota dan double-entry adalah tahap V2 terpisah |
| Email | Belum tersedia | SMTP/outbox adalah tahap V2 terpisah |
| Multikeluarga | Login memilih membership pertama | Sudah ditambah pilihan keluarga aktif untuk akun dengan beberapa membership |

Tidak ada konversi otomatis TREASURER, reset database, atau penghapusan ledger lama. Implementasi tahap ini tidak boleh diklaim memenuhi seluruh definition of done Business V2.


Hasil tahap ini: [panduan approval dan API](APPROVAL_WORKFLOW.md), [laporan migration serta temuan data lama](MIGRATION.md). Menu konfigurasi dan inbox menggunakan modul terpisah dari App.tsx. Navigasi lama berbasis query tetap dipertahankan; migrasi penuh React Router, tabungan anggota, double-entry, email primer, reporting keuangan V2 dan penanganan ulang transaksi legacy belum termasuk penyelesaian tahap ini.
