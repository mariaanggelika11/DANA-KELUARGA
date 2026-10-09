# Dana Keluarga Backend

## Commands

Kode dikelompokkan menurut modul bisnis. Route menangani HTTP, file rules/schemas menangani validasi, dan service menangani transaksi. Validasi kas bersama berada di `cash/cash.schemas.ts`, sehingga route pinjaman tidak bergantung pada route kas. Pengaturan rekening dan koreksi pembayaran masing-masing berada di `payments/bank-account.service.ts` dan `payments/payment-reversal.service.ts`; ekspor service pembayaran tetap kompatibel dengan pemanggil lama. Normalisasi respons dan penanganan kesalahan HTTP berada di `middleware/error-handler.ts`.

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

Jalankan `npm run lint`, `npm run format:check`, dan `npm test` sebelum menggabungkan perubahan. `npm run format` memakai konfigurasi Prettier bersama di root repository. TypeScript memeriksa variabel/parameter yang tidak digunakan. Migration lama dipertahankan sebagai riwayat database dan tidak diformat ulang.

Production memakai `npx prisma migrate deploy`, bukan `db push`. REST API menggunakan `/health`, `/ready`, `/api/v1/auth/login`, dan `/api/v1/dashboard/summary` pada fondasi awal ini.

Notifikasi menggunakan outbox email dengan retry. Pengiriman nyata memerlukan konfigurasi SMTP atau Resend. Pembayaran cicilan memakai transfer bank manual: peminjam melaporkan transfer dan pengelola dana (TREASURER) keluarga mengonfirmasi mutasi rekening.

## Role dan registrasi

`SUPER_ADMIN` adalah role global pemilik aplikasi dan dibuat melalui `SEED_SUPER_ADMIN_*`. Setelah login, Super Admin membuat keluarga beserta Admin pertama melalui `POST /api/v1/management/families`. Admin keluarga kemudian mendaftarkan user baru melalui `POST /api/v1/management/members` dengan role `MEMBER`, `ADMIN`, atau `TREASURER`. Peran `TREASURER` (Pengelola dana) dapat ditetapkan melalui pengelolaan anggota dan diperlukan untuk mengatur rekening serta memeriksa transfer. Registrasi publik tidak tersedia.

`npm run prisma:seed` hanya untuk bootstrap Super Admin dengan identitas pemilik dari konfigurasi lokal. Perintah ini tidak membuat keluarga contoh, keanggotaan, saldo awal, atau transaksi. Super Admin yang sudah ada dengan identitas yang sama dipertahankan tanpa mengubah password; identitas yang dipakai akun lain ditolak. Fixture hanya digunakan oleh pengujian terpisah.

Notifikasi menggunakan outbox email dengan retry. Pengiriman nyata memerlukan konfigurasi SMTP atau Resend. Pembayaran cicilan memakai transfer bank manual: peminjam melaporkan transfer dan pengelola dana (TREASURER) keluarga mengonfirmasi mutasi rekening.

Lihat [panduan Kas Keluarga dan email](../docs/FAMILY_CASH.md) untuk migration, konfigurasi SMTP, dan pengujian. Untuk alur transfer manual dan rekening tujuan, lihat [panduan pembayaran](../docs/PAYMENTS.md).

- `GET /api/v1/notifications`: riwayat pesan berdasarkan hak akses, 50 per halaman (`?page=1`).
- `GET /api/v1/notifications/preferences`: email akun sendiri dan mode pengiriman yang aktif. Tidak ada pengaturan nomor WhatsApp atau PATCH persetujuan email.
- `GET /api/v1/payments/installments/:id`: detail cicilan dan riwayat pembayaran dengan pemeriksaan akses.
- `POST /api/v1/payments/loans/:loanId/installments/:installmentId`: hanya peminjam, melaporkan seluruh sisa cicilan dengan UUID idempotensi dan rekening tujuan. `expectedRemainingAmount` memeriksa bahwa nominal yang dilihat belum berubah; nominal laporan ditentukan server. Format rinci lama tetap diterima untuk kompatibilitas.
- `POST /api/v1/payments/:id/confirm` dan `/:id/reject`: hanya pengelola dana keluarga tersebut yang bukan peminjam. Catatan menerima opsional; penolakan wajib menyertakan alasan minimal 5 karakter.
- `POST /api/v1/payments/webhooks/:provider`: dinonaktifkan (410); tidak ada integrasi gateway. Endpoint simulasi dan rekonsiliasi gateway sudah dihapus.

Worker berjalan di proses server setiap 30 detik. `npm test` memakai mock database dan server HTTP localhost sementara. Build backend dijalankan dengan `npm run build`, kemudian `npm start` memakai `dist/src/server.js`.

## Kotak masuk aplikasi

`GET /api/v1/notifications/inbox?page=1&unread=false` mengembalikan pemberitahuan akun sendiri, 20 per halaman. `GET /api/v1/notifications/inbox/unread-count` menyediakan jumlah untuk badge lonceng. `PATCH /api/v1/notifications/inbox/:id/read` dan `PATCH /api/v1/notifications/inbox/read-all` hanya mengubah status baca milik akun yang login. Hak admin tidak memberi akses menandai kotak masuk akun lain.

Pemberitahuan dicatat pada inbox aplikasi. Email hanya dikirim untuk tagihan (pengingat H-3/H, pencairan, pembayaran), pengajuan pinjaman, dan persetujuan/penolakan; setoran dan tarikan kas hanya muncul di inbox. `EMAIL_MODE` memilih penyedia: `smtp` (mis. Brevo), `resend`, `simulation`, atau `disabled`. Pindah penyedia cukup dengan mengubah `.env` lalu restart API; lihat [panduan email](../docs/FAMILY_CASH.md#email).

Laporan transfer baru mengirim email kepada pengelola dana aktif selain peminjam. Penolakan laporan mengirim alasan kepada peminjam; penerimaan mengirim pembayaran berhasil atau pinjaman lunas. Inbox dan outbox email dibuat dalam transaksi keuangan yang sama dan menggunakan event key agar pengulangan tindakan tidak menggandakan pemberitahuan. Pengingat cicilan dibatalkan selama transfer menunggu pemeriksaan, termasuk pemeriksaan ulang sebelum email dikirim.

## Memeriksa email nyata

1. Isi `EMAIL_MODE=smtp`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, dan `SMTP_PASSWORD` di `.env` lokal. Pengirim harus diizinkan penyedia. Mode Resend memakai `EMAIL_MODE=resend` dan `RESEND_API_KEY`.
2. Jalankan `npm run email:check` untuk mengecek koneksi TLS dan autentikasi SMTP tanpa mengirim pesan. Pemeriksaan koneksi SMTP tidak memverifikasi domain pengirim; mode Resend tanpa `--to` tidak menguji izin API atau domain.
3. Jalankan `npm run email:check -- --to alamat-akun@example.com` untuk mengirim satu email uji melalui outbox aplikasi ke akun anggota keluarga aktif. Perintah hanya memproses record uji tersebut dan tidak mengubah saldo atau cicilan.
4. Build dan restart API agar worker memakai konfigurasi baru. Periksa record outbox untuk diagnosis operasional; riwayat email tidak ditampilkan pada Pengaturan pengguna. `SENT` berarti server penyedia telah menerima pesan, bukan jaminan pesan masuk inbox. Periksa inbox/spam penerima dan alamat **Dari**, bukan hanya **Balas ke**. Alamat `from` pada keluaran perintah adalah alamat yang diminta aplikasi; penyedia masih dapat menggantinya.

Untuk pengirim `Dana Keluarga <no-reply@bulmar.tech>`, gunakan penyedia yang sudah memverifikasi `bulmar.tech`. Konfigurasi lokal menggunakan `EMAIL_MODE=resend` setelah email uji dari alamat tersebut diterima API Resend. Kunci Resend dengan izin mengirim saja dapat mengirim email, tetapi tidak dapat membaca daftar domain. Konfirmasi alamat **Dari** tetap dilakukan pada email yang diterima.

Jika menggunakan Brevo kembali, autentikasi domain pada halaman **Senders & Domains** di Brevo dan pasang record DNS yang diberikan akun tersebut. DKIM dan DMARC harus terverifikasi; verifikasi domain di Resend tidak berlaku untuk Brevo. Brevo dapat mengganti alamat pengirim domain yang belum diautentikasi menjadi `brevosend.com`, meskipun `EMAIL_FROM` sudah benar. Lihat [ketentuan autentikasi pengirim Brevo](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders).

Record lama `CANCELLED` atau `SIMULATED` tetap menjadi riwayat dan tidak dikirim ulang saat mode berubah. Pesan baru yang sesuai jenisnya memakai pengiriman nyata. Tes otomatis selalu memakai konfigurasi email pengujian dan provider mock, bukan kredensial `.env` lokal.

## Registrasi yang konsisten

Baca [alur registrasi dan hasil audit UI/API](../docs/AUDIT_2026-09-18.md). Endpoint pembuatan akun mewajibkan `email`, `password` dan `confirmPassword`, selain nama dan nomor telepon. Email dipakai untuk masuk. Registrasi tetap dikelola administrator; tidak ada registrasi publik atau pengiriman undangan otomatis.

Setiap akun aktif dapat mengubah password sendiri melalui menu akun di kanan atas → Ubah password pada halaman tersendiri, termasuk Super Admin dan akun tanpa keluarga. `POST /api/v1/auth/password` menerima `currentPassword`, `newPassword`, dan `confirmPassword` (tanpa ID pengguna); password baru harus berbeda, sepanjang 8–128 karakter, dan konfirmasinya harus cocok. Password lama yang salah menghasilkan `400 CURRENT_PASSWORD_INCORRECT` tanpa mengakhiri sesi. Penyimpanan hash Argon2, kenaikan `User.authVersion`, pencabutan seluruh refresh token, dan audit `PASSWORD_CHANGED` berlangsung dalam satu transaksi. Login dan refresh menggunakan kunci baris pengguna yang sama agar sesi yang dicabut tidak diterbitkan kembali. Semua access token lama ditolak setelah perubahan; pengguna harus masuk kembali. Audit tidak menyimpan password atau hash. Pengujian alur ini ada di `scripts/verify-password-change.ts` dan dijalankan bersama pemeriksaan database pada schema sementara.

Super Admin menggunakan `POST /api/v1/management/registrations` dengan `type` `NEW_FAMILY`, `NEW_MEMBER`, atau `EXISTING_MEMBER`. Akun lama hanya memerlukan `existingUserId`, `familyId`, dan `role`; passwordnya tidak diubah. Ketiga jalur dan endpoint kompatibilitas `/management/families`/`members` memakai service transaksi yang sama. Jangan memanggil seed untuk menguji alur registrasi pada database produksi.

## Kas Keluarga

Aturan kontribusi/tarikan/pinjaman, API, pengujian, SMTP, dan status migration terbaru: [panduan Kas Keluarga](../docs/FAMILY_CASH.md). Migration kas sudah diterapkan. Penghapusan data contoh dari kode tidak menghapus data pada database. Jalankan bootstrap hanya jika perlu membuat akun pemilik pada database baru.

- `GET/PUT /api/v1/payments/bank-account`: membaca rekening keluarga; hanya pengelola dana dapat menyimpan versi baru.
- `GET /api/v1/payments/pending?page=1`: antrean transfer keluarga yang perlu diperiksa oleh pengelola dana, tanpa pembayaran pinjamannya sendiri.
- `POST /api/v1/approvals/:id/reassign`: khusus Admin keluarga, mengganti petugas pada tahap aktif dengan alasan dan jejak audit.
- `GET /api/v1/ledger?page=1` dan `GET /api/v1/cash?page=1`: halaman riwayat berisi 20 catatan, tanpa batas total 100 catatan.


## Kontrol kas dan konfigurasi online

Setoran anggota melalui `POST /api/v1/cash/contributions` membuat laporan **PENDING**, tanpa menambah kas atau hak kontribusi. Tujuan transfer memakai versi rekening keluarga. Laporan dilihat melalui `GET /api/v1/cash/contributions?page=1` (anggota: sendiri; Admin/Pengelola: keluarga). Hanya pengelola dana aktif selain penyetor dapat memakai `POST /api/v1/cash/contributions/:id/confirm` atau `/reject`; penolakan memerlukan alasan minimal 5 karakter. Konfirmasi menambah kontribusi dan kas satu kali, termasuk bila permintaan diulang serentak. Setoran lama yang sudah dicatat tetap menjadi riwayat.

Pengelola dana dapat memakai `POST /api/v1/payments/:id/reverse` dengan `{ "reason": "alasan koreksi" }` untuk pembayaran manual yang sudah dikonfirmasi, selain pembayaran sendiri. Koreksi mempertahankan ledger asli dan membuat ledger **REVERSAL OUT**, membuka kembali sisa cicilan dan Loan/FundRequest yang sudah lunas, serta mencatat petugas, waktu, alasan, dan pemberitahuan peminjam. Pengulangan alasan yang sama tidak membuat koreksi kedua. Saldo dan cadangan kas harus cukup; jika tidak, koreksi ditolak tanpa perubahan sebagian. Koreksi catatan bukan pengembalian uang melalui bank.

Perubahan peran dan akses transaksi memakai lock keluarga yang sama; hak terbaru dibaca setelah lock diperoleh. Pengelola dana terakhir tidak dapat diturunkan perannya. Laporan setoran/cicilan ditolak bila tidak ada pengelola aktif lain untuk memeriksa. Perubahan peran juga ditolak jika membuat laporan pengelola yang masih pending tidak memiliki pemeriksa independen.

Ringkasan, Kas, Pinjaman, dan Cicilan dimuat ulang setiap 15 detik saat halaman terlihat, serta saat kembali fokus. Rincian cicilan memakai interval 10 detik dan berhenti selama tindakan berlangsung. Pembaruan menjaga formulir, halaman riwayat, dan kelompok cicilan yang sedang dibuka.

`NODE_ENV=production` menolak JWT contoh/pendek, kunci access dan refresh yang sama, serta URL localhost atau HTTP. Gunakan dua kunci acak terpisah minimal 32 karakter, misalnya keluaran `openssl rand -hex 48` masing-masing. `FRONTEND_URL` harus origin HTTPS frontend sebenarnya; `PUBLIC_APP_URL` opsional menyediakan URL publik tautan email saat frontend lokal masih dipakai. Domain email `bulmar.tech` tidak otomatis menentukan lokasi aplikasi. Konfigurasi lokal memakai `PUBLIC_APP_URL=https://danakeluarga.bulmar.tech`, sesuai alamat website yang dicatat proyek dan masih merespons HTTP 200; `FRONTEND_URL` lokal tetap untuk akses pengembangan. Pada deployment, isi juga `FRONTEND_URL` dengan origin HTTPS tersebut. Selama URL masih localhost, email nyata mengarahkan penerima membuka aplikasi secara manual tanpa tautan localhost; setelah URL publik diatur, tautan pada pesan lama yang masih antre ikut disesuaikan saat dikirim. Setelah kunci JWT lokal diganti dan API direstart, pengguna perlu masuk kembali. Kredensial `.env` tidak diikutkan ke Git.

`npm run test:cash:integration` memakai schema PostgreSQL acak lalu menghapusnya. Pengujian mencakup konfirmasi setoran, larangan pemeriksaan sendiri, pelindungan bendahara, koreksi lunas, idempotensi serentak, dan pencabutan Admin ketika permintaan menunggu lock. Email pada pengujian ini selalu simulasi, tanpa transaksi pada schema aplikasi utama.

## Penutupan gap akses, sesi, dan setoran — 9 Oktober 2026

Registrasi `NEW_MEMBER` dari Admin keluarga mengambil lock keluarga dan memeriksa ulang keanggotaan, peran, serta akun aktif di dalam transaksi. Pencabutan Admin saat permintaan sedang mengantre membuat permintaan ditolak, tanpa akun atau keanggotaan baru.

`AuthSession` menyimpan satu sesi perangkat yang tetap sama selama refresh rotation; access token membawa `sid`. Logout mencabut sesi tersebut beserta seluruh refresh tokennya, termasuk bila refresh bersamaan dengan logout. Access token langsung ditolak setelah logout; sesi perangkat lain tetap berlaku. Logout dapat memakai refresh token ataupun access token yang masih valid. Migration melakukan backfill sesi dari refresh token lama; trigger kompatibilitas mengisi sesi jika backend lama masih membuat token tanpa `sessionId` selama pergantian versi. Access token lama tanpa `sid` ditolak dan dapat diperbarui melalui refresh token yang masih aktif.

`POST /api/v1/auth/forgot-password` menerima `{ "email": "akun@example.com" }` dan memberikan respons identik untuk akun aktif, tidak aktif, dan email tidak terdaftar. Ada batas 5 permintaan per IP dalam 15 menit dan jeda 1 menit per akun. Link dikirim langsung melalui SMTP/Resend sesuai konfigurasi, tanpa bergantung pada keanggotaan keluarga. Mode simulation dan disabled mengembalikan `503 PASSWORD_RESET_UNAVAILABLE` pada endpoint publik karena tidak tersedia pengiriman nyata; keduanya tidak menerbitkan tautan. Token acak 256 bit hanya disimpan sebagai digest SHA-256, berlaku 30 menit dan satu kali pakai. Token dan URL pemulihan tidak disimpan pada inbox keluarga, outbox, atau audit. Kegagalan pengiriman membatalkan token tersebut dan mengembalikan `503 PASSWORD_RESET_DELIVERY_FAILED`, sehingga frontend tidak menampilkan keberhasilan palsu. Token yang dibatalkan tidak menghalangi percobaan ulang; batas per IP tetap berlaku. Email tidak terdaftar dan akun tidak aktif tetap menerima respons generik yang sama. Respons kegagalan penyedia tidak menyertakan alamat penerima, token, atau detail kredensial.

`POST /api/v1/auth/reset-password` menerima `token`, `newPassword`, dan `confirmPassword`. Password 8–128 karakter disimpan dengan Argon2; seluruh sesi, refresh token, serta tautan pemulihan akun dicabut dalam transaksi yang sama dengan audit `PASSWORD_RESET`. Reset serentak hanya memiliki satu pemenang. Perubahan password biasa juga membatalkan tautan pemulihan sebelumnya. Frontend menyediakan **Lupa password?**, halaman pemulihan sendiri, dan menghapus token dari URL setelah membacanya. Tautan memakai `PUBLIC_APP_URL` atau `FRONTEND_URL`; frontend dan API pada alamat tersebut harus sama-sama memakai versi baru sebelum digunakan secara online.

`POST /api/v1/cash/contributions/:id/reverse` menerima `{ "reason": "alasan koreksi" }` (5–500 karakter). Hanya pengelola dana aktif dari keluarga tersebut, selain penyetor, dapat mengoreksi laporan **CONFIRMED**. Laporan menjadi **REVERSED**, sedangkan ledger asli dipertahankan dan ledger **CONTRIBUTION_REVERSAL OUT** mengurangi kas dan kontribusi bersih. Petugas, waktu, alasan serta audit disimpan dan penyetor diberi notifikasi. Pengulangan alasan yang sama idempoten; alasan koreksi yang sudah disimpan tidak dapat diubah.

Koreksi ditolak jika kontribusi sudah ditarik atau dicadangkan, atau kas tidak cukup setelah cadangan. Tidak ada perubahan sebagian; selesaikan pengajuan terkait dan pulihkan dana melalui prosedur keluarga sebelum mencoba kembali. Koreksi tidak melakukan transfer bank. Setoran yang belum terwakili laporan (ledger lama/manual) tidak diubah melalui endpoint ini.

Hak Maker dimuat ulang setiap 15 detik saat halaman Pinjaman/Kas terlihat dan ketika kembali fokus, sehingga perubahan hirarki segera memperbarui tombol pengajuan.

Regresi API/database tercakup dalam `scripts/verify-access-races.ts` dan `scripts/verify-gap-fixes.ts`, dijalankan oleh `npm run test:cash:integration`. Untuk browser nyata ke API/database sementara, jalankan frontend lokal lalu atur `PLAYWRIGHT_MODULE` ke modul Playwright yang tersedia dan jalankan perintah integrasi yang sama; runner menambahkan `scripts/verify-browser-gap-fixes.ts`. Semua email pada pengujian tetap simulation dan schema uji selalu dihapus.

## Bantuan ke Super Admin

Pengguna yang login dapat membuka Panduan → Tanya Super Admin dan mengisi kendala 10–5.000 karakter. `POST /api/v1/support` menerima hanya `{ "message": "..." }`; penerima tetap `aglkamaria086@gmail.com` dan subjek `[Butuh Bantuan] Kendala pengguna Dana Keluarga`. Identitas, peran, dan keluarga aktif diambil dari akun serta sesi pengguna di backend, bukan dari isian formulir. Email dikirim langsung melalui penyedia SMTP/Resend yang sudah dikonfigurasi, dengan Reply-To email akun pengguna. Isi kendala tidak dimasukkan ke inbox keluarga.

Batas pengiriman adalah 5 permintaan per akun dalam 15 menit. Mode disabled/simulation menghasilkan `503 SUPPORT_UNAVAILABLE`; kegagalan penyedia menghasilkan `503 SUPPORT_DELIVERY_FAILED`. Respons sukses berarti penyedia menerima pesan, bukan jaminan masuk inbox. Tidak diperlukan migration database.
