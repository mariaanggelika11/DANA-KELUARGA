# Dana Keluarga Frontend

React, TypeScript, dan Vite. Data aplikasi berasal dari REST API melalui `src/lib/api-client.ts`; aplikasi tidak memuat fixture pengujian.

## Menjalankan

```bash
npm install
cp .env.example .env
npm run dev
```

Isi `VITE_API_BASE_URL` dengan alamat API. Untuk pengembangan lokal, nilai default adalah `http://localhost:3000/api/v1`; build produksi memakai `/api/v1` bila variabel tidak diisi. Lihat README backend untuk menjalankan API.

## Struktur kode

- `src/App.tsx`: sesi akun, navigasi, dan penghubung halaman.
- `src/features`: tampilan berdasarkan fitur, seperti kas, pinjaman, cicilan, anggota, dan persetujuan.
- `src/components`: komponen bersama, formulir, dialog, feedback, dan tata letak.
- `src/hooks/useFinancialData.ts`: pembacaan data keuangan, penanganan respons yang terlambat, dan pembaruan latar belakang.
- `src/lib`: API client, format nominal/tanggal, dan label status.
- `src/types`: kontrak data API dan navigasi.
- `tests` dan `scripts/audit-ui.cjs`: pengujian terpisah; fixture browser tidak mengakses transaksi database.

Tambahkan halaman melalui komponen fitur dan hubungkan ke App. Gunakan API client bersama agar pembaruan sesi, timeout, dan pesan kesalahan tetap konsisten. Pertahankan status formulir serta halaman yang sedang dibuka ketika data dimuat ulang.

## Pemeriksaan

```bash
npm run build
npm run lint
npm run format:check
npm test
```

Gunakan `npm run format` untuk merapikan kode dengan konfigurasi Prettier bersama di root repository. TypeScript memeriksa variabel dan parameter yang tidak digunakan. Pengujian browser fixture terdokumentasi dalam `../docs/AUDIT_2026-09-18.md`; pengujian tersebut tidak menggantikan E2E browser ke API dan database.

## Sesi dan pemulihan password

Menu akun → Ubah password mengubah password dengan password lama. **Lupa password?** pada halaman masuk mengirim tautan email dan membuka halaman tersendiri (`?view=reset-password&token=...`); token dibaca ke memori lalu dihapus dari URL. Token tidak disimpan pada localStorage. Pemulihan berhasil mengakhiri seluruh sesi akun dan mengembalikan pengguna ke halaman masuk. Tautan harus membuka frontend yang sudah memakai kode baru; API pada deployment tersebut juga harus diperbarui.

Pengelola dana dapat mengoreksi setoran yang dikonfirmasi melalui **Kas → Laporan setoran → Koreksi setoran**. Alasan diwajibkan dan dialog konfirmasi menjelaskan perubahan kas/kontribusi serta bahwa tidak ada transfer bank otomatis.

`scripts/audit-gap-fixes.cjs` memeriksa UI dengan API fixture pada 1440/390/320 px, termasuk refresh hak Maker setelah focus/polling. Jalankan dengan `PLAYWRIGHT_MODULE` menunjuk modul Playwright yang tersedia, `AUDIT_BASE_URL` menunjuk frontend localhost, serta `CHROME_PATH` bila lokasi Chrome berbeda. E2E nyata ke API/PostgreSQL tersedia melalui runner integrasi backend ketika modul Playwright diberikan.
