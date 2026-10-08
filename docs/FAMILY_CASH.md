# Kas Keluarga — implementasi dan hasil audit

## Status penerapan (18 September 2026)

Migration `20260918120000_family_cash` sudah diterapkan pada database aplikasi setelah pengguna secara eksplisit meminta pengosongan seluruh data kecuali akun Super Admin. Backup privat dibuat sebelum penghapusan. Semua tabel bisnis dan sesi kosong; satu akun Super Admin dipertahankan tanpa perubahan credential. Pembacaan seluruh 19 model Prisma dan build backend berhasil setelah migration.

Tidak ada deployment website atau pengiriman email nyata. Pengosongan database dilaksanakan atas permintaan eksplisit pengguna. Pengiriman SMTP memerlukan konfigurasi pengelola. Pembayaran online masih sandbox; pencatatan setoran/tarikan bukan transfer bank otomatis.

## Temuan dan arsitektur

Implementasi sebelumnya menggunakan Express/TypeScript, Prisma/PostgreSQL, React, ledger per keluarga, dan snapshot approval Maker → Approver berurutan → Releaser. Ledger belum mempunyai pemilik kontribusi. `/loans` menganggap semua nominal sebagai utang. Pembayaran mensyaratkan seluruh sisa satu cicilan. Notifikasi menggunakan inbox dan outbox WhatsApp simulasi; email belum tersedia. Beberapa nominal dikonversi ke `Number` dan dua form mempunyai parsing Rupiah sendiri.

Implementasi baru memakai kembali `Family`, `FamilyMember`, `LedgerEntry`, `Loan`, `LoanInstallment`, `Payment`, dan tabel approval. Tidak ada tabel saldo mutable terpisah yang bisa menyimpang dari ledger.

| Lapisan/file                                        | Tanggung jawab                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| `backend/src/modules/cash/cash.rules.ts`            | Pemisahan nominal menggunakan BigInt                                   |
| `backend/src/modules/cash/cash.service.ts`          | Kontribusi, permintaan dana, saldo personal, otorisasi dan idempotensi |
| `backend/src/modules/cash/ledger.service.ts`        | Lock keluarga, saldo/cadangan, posting dan snapshot saldo              |
| `backend/src/modules/cash/cash.routes.ts`           | API kas dan validasi input                                             |
| `backend/src/modules/approvals/approval.service.ts` | Snapshot hirarki, cadangan, penolakan, pencairan gabungan              |
| `backend/src/modules/payments/*`                    | Pembayaran sebagian/penuh dan posting pengembalian                     |
| `backend/src/modules/email/email.service.ts`        | Outbox email, adapter SMTP/Resend, claim, retry, simulasi              |
| `backend/src/modules/notifications/*`               | Event inbox/WA/email dan pengingat                                     |
| `frontend/src/features/cash/FamilyCash.tsx`         | Dashboard kas, setoran, preview dan konfirmasi ambil dana              |
| `frontend/src/components/CurrencyInput.tsx`         | Input nominal reusable dengan validasi dan caret                       |
| `frontend/src/lib/currency.ts`                      | Parser, formatter dan validasi tampilan Rupiah                         |

`backend` dan `frontend` pada tabel mengacu pada folder `dana-keluarga-backend` dan `dana-keluarga-frontend`.

## Aturan dan waktu pencatatan

- Saldo kas = seluruh ledger IN − OUT.
- Total kontribusi = ledger CONTRIBUTION milik anggota, bukan seluruh kas masuk.
- Hak kontribusi = kontribusi − WITHDRAWAL.
- Kontribusi tersedia = hak kontribusi − bagian kontribusi pada permintaan PENDING/APPROVED.
- Kas tersedia = saldo kas − total permintaan dana PENDING/APPROVED.
- Utang = pokok pinjaman yang benar-benar dicairkan − pembayaran tercatat.
- Pengembalian pinjaman menambah kas; **tidak** menambah kontribusi personal.

Misalnya kontribusi Runi Rp4 juta dan permintaan Rp6 juta: sistem membuat satu FundRequest, mencadangkan Rp6 juta kas dan Rp4 juta kontribusi Runi, lalu membuat Loan **Rp2 juta**. Selama approval belum ada uang keluar dan belum ada cicilan aktif. Releaser mencatat WITHDRAWAL Rp4 juta dan LOAN_DISBURSEMENT Rp2 juta dalam satu transaction. Penolakan/RETURN membatalkan seluruh permintaan dan melepas cadangan. RETURN menggunakan pengajuan baru untuk mempertahankan snapshot historis.

Jika permintaan ≤ kontribusi tersedia, tarikan langsung dicatat tanpa Loan atau approval pinjaman. Anggota tidak perlu menjadi Maker untuk setoran atau tarikan dananya sendiri. Pinjaman tetap mengikuti assignment Maker/Approver/Releaser yang sudah dikonfigurasi; pemohon/peminjam tidak boleh menyetujui sendiri. Kebijakan lama satu pengajuan/pinjaman aktif per anggota tetap berlaku untuk bagian pinjaman.

Saldo lama berjenis OTHER_INCOME/INITIAL_BALANCE tidak diberi pemilik kontribusi secara otomatis. Loan lama tanpa snapshot approval/disbursedAt tetap membutuhkan rekonsiliasi; tidak dipalsukan menjadi pinjaman yang sudah dicairkan.

## API

Semua endpoint membutuhkan login dan keluarga aktif. `familyId` tidak diambil dari body. Super Admin tidak mempunyai bypass transaksi keuangan.

- `GET /api/v1/cash`: saldo keluarga, cadangan, saldo personal, permintaan dan kontribusi. Admin/Bendahara dapat melihat rincian anggota sekeluarga; anggota melihat rincian personal sendiri.
- `POST /api/v1/cash/contributions`: `{ amount: "4000000", purpose: "Setoran September", idempotencyKey: "UUID" }`.
- `POST /api/v1/cash/requests`: payload yang sama ditambah `tenorMonths`. Backend menghitung ulang split dari saldo terkunci.
- `POST /api/v1/loans`: alias alur permintaan dana yang sama, bukan jalan pintas untuk mengabaikan kontribusi. Pengajuan atas nama pemilik kontribusi lain ditolak.
- `POST /api/v1/ledger`: pengelola mencatat pemasukan/pengeluaran umum dengan UUID idempotencyKey; bukan kontribusi personal.
- Endpoint pembuatan pembayaran cicilan menerima `amount` opsional. Kosong berarti seluruh sisa cicilan. Pembayaran sebagian ≤ sisa cicilan. Konfirmasi sandbox tetap khusus pengelola dan tidak tersedia di production.

UUID idempotensi digunakan ulang saat retry formulir yang sama. UUID + payload berbeda ditolak. Permintaan yang berbeda menggunakan UUID baru. Klik submit dicegah di UI; backend tetap menjadi pengaman utama. Payment intent pending digunakan kembali, sedangkan konfirmasi payment SUCCESS tidak mem-posting ulang.

## Database dan concurrency

Migration: `20260918120000_family_cash`.

- Menambahkan LedgerType WITHDRAWAL, owner kontribusi, saldo sebelum/sesudah, dan key idempotensi ledger.
- Menambahkan FundRequest dengan total/tarikan/pinjaman, relasi keluarga/anggota/Loan, indeks serta constraint total = tarikan + pinjaman.
- Menambahkan status sebelum/sesudah pada ApprovalAction; histori approval tetap append-only.
- Menambahkan EmailMessage dan status QUEUED/PROCESSING/SENT/SIMULATED/FAILED/CANCELLED.
- Foreign key gabungan memastikan pemilik kontribusi/permintaan merupakan anggota keluarga terkait.
- Ledger mempunyai trigger append-only. Koreksi harus melalui entry pembalik dan audit, bukan UPDATE/DELETE. Endpoint koreksi baru belum dibuat.
- Saldo sebelum/sesudah data lama tetap NULL: tidak dibuat snapshot historis palsu.

Transaction interaktif memakai batas 15 detik dengan waktu tunggu akuisisi 10 detik; batas bawaan 5 detik terbukti terlalu pendek untuk rangkaian query pada database jarak jauh.

Operasi kas, keputusan approval, dan settlement mengambil lock `Family` sebelum posting. Approval lalu mengambil lock request; settlement mengambil lock Loan. Pengeluaran umum juga menghormati cadangan permintaan dana. Kas dicek ketika submit, approve, dan release. Seluruh posting dan event outbox berada dalam transaction yang sama. Network SMTP dilakukan setelah commit, sehingga kegagalan SMTP tidak membatalkan transaksi uang.

Nominal API adalah string integer kanonis (misalnya `"4000000"`), tetap disimpan sebagai PostgreSQL Decimal(18,2). Input dengan pecahan, nol, negatif, angka JS tidak aman, atau nominal melebihi 9.999.999.999.999.999 ditolak. Perhitungan frontend memakai BigInt; backend memakai BigInt/Prisma.Decimal. Format IDR hanya pada presentation.

## Email

Atur variabel pada `.env` lokal/server, jangan kirim password melalui chat:

```dotenv
EMAIL_MODE=simulation
EMAIL_FROM="Dana Keluarga <notifikasi@domain-anda.example>"
EMAIL_REPLY_TO=
# EMAIL_MODE=smtp (contoh Brevo)
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=login-smtp-brevo
SMTP_PASSWORD=isi-di-server
# EMAIL_MODE=resend
RESEND_API_KEY=isi-di-server
```

- `disabled` (default): event email tersimpan CANCELLED, tidak dikirim belakangan ketika mode berubah.
- `simulation`: transport JSON Nodemailer, status SIMULATED; tidak keluar ke internet.
- `smtp`: SMTP sebenarnya (mis. Brevo); port 587 memakai STARTTLS wajib, port 465 gunakan SMTP_SECURE=true. Alamat penerima diambil ulang dari akun aktif dan keanggotaan keluarga pada database.
- `resend`: API Resend; `eventKey` dikirim sebagai idempotency key sehingga retry setelah crash tidak mengirim email ganda. `EMAIL_FROM` harus memakai domain yang sudah terverifikasi di Resend.
- Pindah penyedia cukup dengan mengubah `EMAIL_MODE` beserta kredensialnya lalu restart API; email yang masih antre dikirim lewat penyedia baru. `SMTP_FROM` lama tetap dibaca bila `EMAIL_FROM` kosong.
- Email hanya dikirim untuk tagihan, pengajuan pinjaman, dan keputusan approval. Setoran/tarikan kas tetap tercatat di inbox aplikasi dengan status email `CANCELLED`.
- Penolakan permanen (autentikasi SMTP gagal, balasan SMTP 5xx, error Resend 4xx selain 409/429) langsung `FAILED` tanpa retry; penyebabnya tersimpan di riwayat tanpa credential.
- Persetujuan membutuhkan email akun approver, bukan alamat yang diketik dalam form transaksi. Email tugas menyertakan pemohon, tanggal, tujuan, total, tarikan, pinjaman dan tautan approval.
- Worker memakai claim atomik, lease 5 menit, retry exponential hingga 5 percobaan; error tidak menampilkan credential. SENT berarti SMTP menerima email, bukan jaminan email sudah dibaca/masuk inbox. Jika proses mati setelah SMTP menerima, retry dapat menyebabkan email duplikat; Message-ID stabil disediakan. Tidak menjanjikan exactly-once delivery eksternal.
- Pengingat H−3/hari H setelah jam WIB konfigurasi berjalan melalui email. Email tagihan yang sudah lunas dibatalkan sebelum pengiriman.
- Email merupakan satu-satunya kanal pengiriman eksternal. Inbox aplikasi tetap menyimpan riwayat event.

## Pengujian dan penerapan

```sh
# Di backend
npm run build
npm test
npm run prisma:validate
npm run test:cash:integration

# Di frontend
npm run build
npm run lint
npm test
```

`test:cash:integration` memerlukan akses PostgreSQL CREATE/DROP SCHEMA dan membuat schema acak `cash_test_*`. Migration diterapkan hanya ke schema tersebut, fixture menggunakan email `example.invalid`, EMAIL_MODE dipaksa simulation, kemudian schema dihapus pada finally. Jalankan pada lingkungan yang mengizinkan schema uji.

Hasil pengujian: 125 test backend, 25 test utility frontend; integrasi PostgreSQL memeriksa setoran, tarikan < / = / > kontribusi, reservation/rejection, self-approval/tenant denial, approval/release ganda, tarikan bersamaan, pembayaran sebagian/lunas, snapshot ledger dan larangan hard delete, serta email simulasi. Browser Chrome memakai API fixture dan memeriksa login/registrasi, empat lebar layar, navigasi, input nominal/caret/paste, warning saldo dan dialog.

**Status database:** migration telah diterapkan dan Prisma Client dibuat ulang. Restart API yang masih berjalan sebelum perbaikan, lalu login ulang sebagai Super Admin. Jangan menjalankan seed karena akan membuat data contoh kembali. Buat keluarga, anggota, dan hirarki baru melalui aplikasi.


## Pembaruan kanal email saja

Migration `20260918170000_email_only` telah diterapkan. Tabel pesan serta kolom persetujuan WhatsApp dihapus; migration lama dipertahankan sebagai riwayat schema yang tidak boleh diubah. Kode runtime, worker, konfigurasi, dan UI tidak lagi menggunakan WhatsApp. Nomor telepon tetap merupakan kontak akun, bukan kanal notifikasi.

Deduplikasi event sekarang menggunakan `EmailMessage.eventKey`, dan inbox aplikasi dibuat hanya saat event baru dimasukkan. Pencatatan kas tidak bergantung pada keberhasilan SMTP. Menu Pengaturan menampilkan email akun, mode pengiriman, dan riwayat email sesuai scope akses pengguna.

Konfigurasi saat pemeriksaan: `EMAIL_MODE=disabled`, SMTP belum diisi. Untuk email nyata, atur `EMAIL_FROM` dan kredensial penyedia (`SMTP_*` untuk `smtp`, `RESEND_API_KEY` untuk `resend`), lalu ubah `EMAIL_MODE` dan restart API. Jangan memasukkan password SMTP ke repository atau chat. Tidak ada email nyata yang dikirim selama pengujian.
