# Alur WhatsApp dan pembayaran — mode simulasi

Implementasi ini menyiapkan perjalanan anggota dan pengelola dari pengajuan sampai pelunasan. Pesan WhatsApp hanya disimpan sebagai pratinjau; tidak ada koneksi WhatsApp, pemanggilan payment gateway, QRIS yang dapat dibayar, atau transfer uang otomatis.

## Alur pengguna

Anggota mengajukan pinjaman → anggota dan pengelola keluarganya mendapat pratinjau notifikasi → admin menyetujui → anggota mendapat pemberitahuan menunggu pencairan → bendahara mentransfer dana di luar aplikasi dan mencatat pencairan → sistem membuat jadwal → anggota mendapat rincian cicilan → pengingat H-3/hari H berisi tautan halaman cicilan → anggota membuat pembayaran simulasi → pengelola mengonfirmasi simulasi → sistem memperbarui cicilan, kas, dan sisa pinjaman → anggota mendapat konfirmasi → pembayaran terakhir menutup pinjaman.

Keputusan ditolak menghasilkan pemberitahuan beserta alasan kepada peminjam. Pengajuan baru diberitahukan hanya kepada ADMIN/TREASURER aktif dari keluarga terkait, bukan admin pertama di database.

## Batas yang harus diketahui

- Gunakan database pengembangan yang terpisah. Konfirmasi simulasi benar-benar mengubah tabel cicilan, pembayaran, pinjaman, dan kas di database yang dipilih, meskipun tidak memindahkan uang nyata.
- `WHATSAPP_ENABLED=true` membuat startup gagal dengan pesan yang jelas. Pengiriman nyata belum diimplementasikan.
- `WHATSAPP_MODE=simulation` memproses pesan menjadi `SIMULATED`, bukan `SENT`/`DELIVERED`.
- `WHATSAPP_MODE=disabled` membatalkan pesan baru dan menghentikan pemrosesan antrean. Pembaruan status keterlambatan tetap berjalan.
- Tidak ada pengiriman QRIS palsu. Memilih provider `midtrans` mengembalikan layanan belum tersedia, bukan membuat pembayaran berlabel Midtrans dengan payload simulasi.
- Semua endpoint webhook publik lama mengembalikan HTTP 503. Tidak ada callback tanpa verifikasi yang boleh mengubah pembayaran menjadi lunas.
- Konfirmasi simulasi hanya tersedia untuk pengelola berwenang, dengan `NODE_ENV` selain `production` dan `PAYMENT_PROVIDER=sandbox`.
- Belum ada bot chat, penerimaan pesan WA, status diterima/dibaca, atau percobaan kirim ke penyedia nyata.

## Persiapan database dan menjalankan

Arahkan `DATABASE_URL` ke PostgreSQL pengembangan. Jangan menyalin kredensial ke Git atau dokumentasi. Berkas `.env` yang sudah ada tidak diubah oleh implementasi ini.

Di `.env` backend:

```dotenv
NODE_ENV=development
WHATSAPP_ENABLED=false
WHATSAPP_MODE=simulation
REMINDER_HOUR_WIB=9
NOTIFICATION_POLL_MS=30000
PAYMENT_PROVIDER=sandbox
FRONTEND_URL=http://localhost:5173
```

Jalankan dari direktori backend setelah memastikan target database:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev
```

Migration `20260911090000_whatsapp_simulation` menambah persetujuan WA pada pengguna, tabel outbox, enum status, dan indeks unik parsial untuk satu pembayaran `PENDING` per cicilan. Jika ada pembayaran pending ganda dari kode lama, migration sengaja gagal agar data ditinjau terlebih dahulu; tidak ada pembersihan atau pembatalan data otomatis.

Periksa duplikasi sebelum menerapkan migration pada database yang sudah berisi data:

```sql
SELECT "installmentId", COUNT(*)
FROM "Payment"
WHERE "status" = 'PENDING'
GROUP BY "installmentId"
HAVING COUNT(*) > 1;
```

Frontend, dari direktori frontend:

```bash
npm install
npm run dev
```

`npm run build && npm start` di backend memakai `dist/src/server.js`, sesuai hasil TypeScript. `FRONTEND_URL` harus menunjuk alamat frontend yang benar agar tautan notifikasi bisa dibuka. URL lokal hanya dapat diakses dari perangkat yang sesuai; akses dari ponsel memerlukan alamat yang dapat dijangkau ponsel.

## Nomor utama pengirim

Nomor utama DANA KELUARGA ditentukan melalui `WHATSAPP_SENDER_PHONE` di `.env` backend, dalam format internasional `62...`. Pengaturan ini mencatat identitas pengirim yang direncanakan untuk seluruh keluarga; bukan nomor tujuan pengingat. Nomor asli disimpan di konfigurasi lokal, bukan contoh konfigurasi.

Variabel ini belum menghubungkan akun WhatsApp dan belum digunakan untuk mengirim pesan dalam mode simulasi. Saat adapter nyata dibuat, nomor pengirim yang terdaftar pada penyedia harus cocok dengan konfigurasi ini. `Phone Number ID` dari penyedia adalah ID terpisah dari nomor telepon.

## Persetujuan dan akses

Menu **Notifikasi** adalah kotak masuk pribadi dengan filter Semua/Belum dibaca, penanda baca, dan tautan ke rincian. Lonceng serta sidebar menampilkan jumlah belum dibaca dari server. Menu **Pengaturan** menampilkan nomor akun, pilihan persetujuan, serta riwayat WhatsApp dengan status, alasan pembatalan/kegagalan, dan jumlah percobaan. Notifikasi aplikasi tetap dibuat walaupun WhatsApp tidak disetujui; status dibaca tidak berarti pesan WA diterima/dibaca.

- Setiap orang menyetujui notifikasi untuk akunnya sendiri. Admin tidak dapat menyetujui atas nama orang lain melalui endpoint ini.
- Persetujuan berlaku pada akun di seluruh keluarga yang diikutinya.
- Tidak ada persetujuan bawaan. Jika belum menyetujui saat kejadian, pesan dicatat sebagai `CANCELLED`; persetujuan berikutnya tidak mengaktifkan kembali pesan lama.
- Menonaktifkan persetujuan membatalkan pesan akun yang masih mengantre/diproses. Sebelum pemrosesan, sistem memeriksa kembali persetujuan, akun aktif, dan keanggotaan aktif di keluarga tujuan.
- Anggota melihat pesan miliknya. Admin/bendahara melihat pesan keluarga aktif pada sesi. SUPER_ADMIN melihat seluruh keluarga.
- Tautan `/?installment=<id>` mempertahankan tujuan setelah login. ID dalam URL tidak memberikan akses; server tetap memeriksa pemilik/keluarga/peran.
- Peran dan keanggotaan diperiksa kembali di database pada setiap permintaan terautentikasi agar token lama tidak mempertahankan hak yang sudah dicabut.

## Aturan jadwal

- Jadwal dibuat ketika pencairan dicatat, bukan saat persetujuan.
- Cicilan pertama satu bulan setelah tanggal pencairan dalam WIB.
- Tanggal akhir bulan disesuaikan ke hari terakhir bulan pendek, dengan tetap memakai tanggal pencairan sebagai acuan bulan berikutnya. Contoh: 31 Januari → 28 Februari → 31 Maret.
- Pembagian nominal memakai bilangan rupiah bulat; selisih pembulatan dibagi sehingga total seluruh cicilan tetap sama dengan pokok.
- Penjadwal memeriksa H-3 dan hari H mulai pukul 09.00 WIB secara default. Bukan mengirim tepat pada detik 09.00; mengikuti interval worker.
- Pengingat hanya untuk pinjaman aktif dengan sisa cicilan positif dan status belum lunas.
- Satu kejadian pengingat per cicilan/tanggal/tahap, meskipun worker berjalan berulang atau beberapa instance aktif.
- Cicilan lewat hari jatuh tempo ditandai `OVERDUE`. Tidak ada pesan penagihan lanjutan otomatis; bendahara menindaklanjuti lewat dashboard.
- Jika server mati sepanjang hari pengingat, pesan hari tersebut tidak dikirim terlambat pada hari berikutnya.
- Pembayaran lunas membatalkan pengingat yang belum selesai diproses. Worker juga mengecek ulang cicilan sebelum menyelesaikan simulasi.

## Antrean dan keandalan

Notifikasi kejadian ditulis dalam transaksi database yang sama dengan perubahan pinjaman/pembayaran. Dengan demikian, transaksi yang gagal tidak meninggalkan pemberitahuan keberhasilan. Pemrosesan antrean dijalankan terpisah sehingga kegagalan pemrosesan WA tidak membatalkan transaksi yang sudah tersimpan.

Status:

| Status | Arti |
| --- | --- |
| `QUEUED` | Menunggu worker atau jadwal percobaan ulang |
| `PROCESSING` | Sedang diproses oleh worker yang berhasil mengklaim pesan |
| `SIMULATED` | Simulasi selesai; tidak ada pesan nyata terkirim |
| `FAILED` | Gagal setelah maksimal tiga percobaan pemrosesan |
| `CANCELLED` | Tidak memiliki persetujuan/akses, cicilan lunas, atau pengingat sudah tidak relevan |

Klaim memakai update bersyarat. Klaim yang tertinggal setelah proses berhenti dipulihkan setelah lima menit. Kegagalan dicoba ulang setelah satu menit, lalu dua menit, sampai batas tiga percobaan. Tidak ada tombol kirim ulang manual pada versi ini. Riwayat dipaginasi 50 pesan per halaman.

Pembayaran simulasi kedaluwarsa setelah 30 menit. Membuka halaman menghitung status kedaluwarsa; pembuatan pembayaran berikutnya menandai intent lama kedaluwarsa dan membuat yang baru. Permintaan bersamaan dikunci per pinjaman. Konfirmasi berulang tidak menggandakan pemasukan atau pesan. Pelunasan dua cicilan bersamaan diserialisasi untuk menghitung penutupan pinjaman dengan benar.

## Skenario uji manual

1. Siapkan keluarga, anggota Rani, admin/bendahara, dan saldo kas pengembangan yang cukup.
2. Login sebagai Rani serta pengelola, buka Pengaturan, aktifkan persetujuan masing-masing sebelum membuat pengajuan.
3. Ajukan Rp3.000.000 selama enam bulan. Periksa pratinjau pengajuan untuk Rani dan pengelola di keluarga yang sama.
4. Setujui pengajuan. Pastikan status menunggu pencairan dan belum ada jadwal.
5. Catat pencairan setelah konfirmasi. Pastikan enam cicilan terbentuk, kas berkurang satu kali, dan rincian jadwal muncul pada pesan.
6. Buka Cicilan → Lihat pembayaran. Salin URL dan coba buka sesudah logout/login; tujuan cicilan tetap tersedia. Login sebagai anggota lain harus ditolak.
7. Buat pembayaran simulasi. Anggota tidak memiliki tombol konfirmasi berhasil. Login sebagai pengelola untuk mengonfirmasi dari halaman cicilan yang sama.
8. Periksa cicilan lunas, kas bertambah Rp500.000, sisa pinjaman Rp2.500.000, dan pesan konfirmasi dengan cicilan berikutnya. Tunggu maksimal interval worker, lalu tekan Perbarui di Pengaturan untuk riwayat WA, atau buka Notifikasi untuk kotak masuk.
9. Ulangi permintaan konfirmasi yang sama: tidak boleh ada transaksi kas/pesan tambahan.
10. Ulangi hingga cicilan terakhir: status pinjaman `PAID_OFF`, pesan akhir menyebut lunas.
11. Di database pengujian, siapkan cicilan belum lunas jatuh tempo hari ini atau tiga hari lagi. Jalankan server setelah jam pengingat atau atur `REMINDER_HOUR_WIB=0` khusus pengujian. Periksa pengingat tunggal meskipun worker berjalan berulang.
12. Uji penolakan pengajuan, pencabutan persetujuan, cicilan sudah dibayar, nomor tidak valid, pembayaran kedaluwarsa, serta akses keluarga lain.

## Pengujian otomatis dan batas validasi

Backend:

```bash
npm test
npm run build
npx prisma validate
```

Frontend:

```bash
npm run lint
npm run build
```

Pengujian mencakup kalender, konfigurasi, pemilihan penerima, persetujuan, worker, settlement simulasi, serta API HTTP dengan JWT. Seluruh akses Prisma pada test diganti mock, dan setup test memaksa kredensial dummy agar `.env` proyek tidak digunakan. Test HTTP memerlukan izin membuka server localhost sementara.

Test tersebut belum membuktikan perilaku migration, penguncian transaksi, atau rollback pada PostgreSQL nyata. Jalankan uji manual di database pengembangan sebelum aktivasi. Tidak ada uji pengiriman WhatsApp atau pembayaran QRIS nyata. Pemeriksaan browser Chrome dengan API mock mencakup akun/logout, sidebar, kotak masuk, panduan, dan tampilan pada lebar 320, 390, 768, serta 1440 piksel. Pemeriksaan ini tidak menggunakan akun atau backend nyata.

## Sebelum integrasi nyata

Konfirmasikan klasifikasi penggunaan kas pinjaman keluarga dengan Meta/penyedia resmi. Setelah sesuai, implementasikan adapter WhatsApp resmi beserta template, autentikasi, status pengiriman, dan pengelolaan kredensial. Untuk pembayaran, implementasikan pembuatan invoice gateway serta callback yang memverifikasi identitas pengirim, provider, referensi, nominal, dan status transaksi. Gunakan server HTTPS persisten dan lakukan pengujian sandbox gateway sebelum production.


## Navigasi dan bantuan

Hamburger di kiri logo membuka/menutup sidebar pada desktop maupun ponsel. Pada ponsel, sidebar ditutup setelah memilih halaman, menyentuh area luar, atau menekan Escape. Menu akun dipindahkan ke kanan atas dan dapat ditutup dengan klik di luar atau Escape. Keluar tetap membersihkan sesi lokal jika permintaan server gagal atau melebihi delapan detik.

Tombol **Butuh bantuan?** membuka panduan aplikasi: kas, pinjaman, cicilan, notifikasi, akun, serta petunjuk khusus pengelola dan penanganan kendala. Halaman aktif disimpan pada query URL sehingga tetap terbuka setelah refresh.

Kotak masuk menggunakan tabel `Notification` yang sudah ada, sehingga perubahan navigasi dan status baca ini tidak memerlukan migration baru. Notifikasi untuk aktivitas baru dibuat atomik bersama outbox; pesan duplikat tidak membuat kotak masuk ganda. Riwayat outbox lama tidak otomatis disalin ke kotak masuk.
