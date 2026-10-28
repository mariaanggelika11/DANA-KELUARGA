# Dana Keluarga untuk Android dan iOS

React yang sama digunakan oleh web, Android, dan iOS melalui Capacitor 8. Proyek native tersedia di `dana-keluarga-frontend/android` dan `dana-keluarga-frontend/ios`. Identitas awal keduanya `id.danakeluarga.app`; pastikan identitas ini cocok dengan akun penerbit sebelum rilis pertama. Versi awal 0.1.0, build 1.

## Kondisi saat implementasi

Pada 28 Oktober 2026, konfigurasi lokal frontend menunjuk `http://localhost:3000/api/v1`. Backend lokal berstatus development. Konfigurasi `PUBLIC_APP_URL` menunjuk `https://danakeluarga.bulmar.tech`. Pemeriksaan tanpa login membuktikan `/api/v1/auth/me` pada domain publik memberi JSON 401 (API tersedia). `/health` pada domain publik justru mengembalikan HTML frontend, sehingga tidak boleh digunakan sebagai bukti kesehatan backend.

Preflight publik dengan origin `capacitor://localhost` masih mengembalikan `Access-Control-Allow-Origin: https://danakeluarga.bulmar.tech`. Artinya server publik belum menerima origin native. Perubahan backend di repo ini belum diterapkan ke server publik. Ini adalah kondisi sebelum perbaikan HTTP native pada 29 Oktober 2026; lihat catatan terbaru di bawah.

`.env.mobile.local` lokal sudah diarahkan ke API publik yang ditemukan. File ini diabaikan Git. Pada checkout baru, buat dari contoh berikut. Tidak ada akun pengguna yang dipakai untuk pemeriksaan publik.

## Konfigurasi

Di `dana-keluarga-frontend`:

```sh
npm ci
cp .env.mobile.example .env.mobile.local
```

Isi `.env.mobile.local` dengan alamat API, termasuk `/api/v1`:

```dotenv
VITE_API_BASE_URL=https://danakeluarga.bulmar.tech/api/v1
```

Alamat tersebut masuk ke bundel saat build. Setelah menggantinya, build dan sync ulang. Jangan memasukkan secret database, JWT, atau kredensial penerbit ke variabel `VITE_*`. Build mobile menolak URL relatif, HTTP, localhost, dan URL dengan kredensial. Aplikasi memerlukan koneksi internet untuk data dan transaksi; belum mendukung transaksi offline.

Pada `.env` backend server tujuan, pertahankan domain web yang benar dan tambahkan:

```dotenv
MOBILE_APP_ORIGINS=https://localhost,capacitor://localhost
```

Deploy kode backend terbaru, build, lalu restart layanan sesuai pengelola proses server. Pengaturan ini hanya menerima dua origin native yang eksplisit; tidak menggunakan wildcard. Jangan mengubah `FRONTEND_URL` menjadi localhost pada produksi. Perubahan CORS di repo tidak otomatis mengubah server publik.

## Build Android

Siapkan Node.js >=22, JDK 21, Android Studio dan SDK Android API 36. Minimum aplikasi Android API 24 (Android 7). Mesin saat implementasi belum memiliki Java/Android Studio.

```sh
npm run mobile:android
```

Perintah tersebut membangun bundel mobile, melakukan sync, lalu membuka Android Studio. Jalankan pada emulator atau HP dengan USB debugging. Untuk APK debug:

```sh
npm run mobile:apk
```

Hasil: `android/app/build/outputs/apk/debug/app-debug.apk`. Untuk Play Store, gunakan **Generate Signed Bundle / APK** di Android Studio dengan keystore milik penerbit. `npm run mobile:aab` menghasilkan bundle release tetapi belum menyiapkan signing penerbit. Simpan keystore/password secara privat; jangan commit ke repo.

## Build iOS

Siapkan Mac dengan Xcode lengkap beserta SDK yang cocok dengan Capacitor 8, simulator, dan akun Apple Developer untuk distribusi. Minimum deployment iOS 15. Proyek memakai Swift Package Manager. Mesin saat implementasi hanya memiliki Command Line Tools, belum Xcode lengkap.

```sh
npm run mobile:ios
```

Di Xcode, pilih target App, atur **Signing & Capabilities → Team**, dan pastikan Bundle Identifier sesuai akun penerbit. Uji dengan simulator/iPhone terlebih dahulu. Untuk TestFlight/App Store: pilih perangkat generik iOS, **Product → Archive**, lalu **Distribute App → App Store Connect**. Sertifikat dan signing tidak disiapkan oleh repo.

## Perubahan mobile

- Ikon dan splash berasal dari logo SVG aplikasi. Regenerasi dengan `npm run mobile:assets`.
- Safe area untuk status bar, notch, dan home indicator; ukuran input HP minimal 16px agar tidak memicu zoom otomatis iOS.
- Tombol kembali Android menutup dialog teratas, lalu menu samping, lalu kembali melalui history aplikasi. Pada halaman awal, aplikasi diminimalkan. Perubahan hirarki yang belum disimpan tetap mengikuti pengaman navigasi aplikasi.
- Backup Android dimatikan; trafik HTTP biasa dan mixed content tidak diaktifkan.
- Penyimpanan sesi mengikuti aplikasi web yang ada (localStorage). Penyimpanan dengan Keychain/Keystore, biometrik, push notification, dan universal links belum diimplementasikan. Tautan email tetap membuka web.

## Validasi dan pekerjaan tersisa

Pemeriksaan frontend, lint, build web/mobile, sinkronisasi kedua platform, dan 271 pengujian backend lulus saat implementasi. Sinkronisasi Capacitor bukan kompilasi native. APK/AAB/IPA belum dihasilkan karena toolchain native belum tersedia. Login ke API produksi dan alur transaksi di perangkat belum diuji.

Sebelum publikasi: terapkan konfigurasi CORS backend, uji login/refresh/logout dan pergantian keluarga, uji navigasi serta dialog (termasuk formulir sibuk), input dengan keyboard terbuka, layar kecil/landscape, pinjaman/cicilan dan hak akses, putus koneksi, serta pemulihan aplikasi dari background pada Android dan iOS. Siapkan kebijakan privasi, deklarasi data, screenshot, akun review, dan kebutuhan penghapusan akun bila berlaku. Sesuaikan penjelasan fitur pinjaman/transfer dengan fungsi aplikasi yang sebenarnya saat peninjauan toko.

Audit dependensi frontend setelah perbaikan kompatibel menyisakan tiga temuan moderate pada alat pengembangan `@capacitor/cli → xcode → uuid`. Tidak diterapkan downgrade paksa atau override lintas major. Dependensi runtime frontend tidak memiliki temuan audit saat pemeriksaan. Tinjau pembaruan CLI sebelum rilis.

Referensi: [Capacitor](https://capacitorjs.com/docs), [alur pengembangan](https://capacitorjs.com/docs/basics/workflow), [panduan peninjauan Apple](https://developer.apple.com/app-store/review/guidelines/).

## Pemeriksaan Android 29 Oktober 2026

Android Studio telah terpasang. Java bawaan Android Studio adalah 25, yang gagal menjalankan Gradle 8.14.3 proyek ini (`Unsupported class file major version 69`). Temurin JDK 21 dipasang di `~/Library/Java/JavaVirtualMachines/temurin-21.jdk` dengan checksum arsip resmi terverifikasi. SDK Platform 36 dan Build Tools 35 berhasil dipasang melalui Gradle menggunakan lisensi SDK yang sudah diterima.

`./gradlew assembleDebug` dengan JDK 21 berhasil (123 tasks); APK debug tersedia di `dana-keluarga-frontend/android/app/build/outputs/apk/debug/app-debug.apk`. Ini menggantikan status APK belum dihasilkan pada catatan implementasi sebelumnya. Status iOS dan konfigurasi CORS publik tetap belum berubah.

Untuk menjalankan ulang di Android Studio: buka folder `dana-keluarga-frontend/android`, pilih Gradle JDK 21 pada Settings → Build, Execution, Deployment → Build Tools → Gradle apabila diperlukan, tunggu Gradle Sync, lalu pilih emulator `Medium_Phone_API_37.0`, konfigurasi `app`, dan klik Run ▶. SDK dan lokasi JDK untuk komputer ini disimpan hanya dalam file lokal yang diabaikan Git.

APK debug berhasil dipasang dan MainActivity dibuka pada emulator `Medium_Phone_API_37.0` (`emulator-5554`). Screenshot memperlihatkan halaman login Dana Keluarga. Belum dilakukan login atau transaksi pada akun pengguna.

## Perbaikan koneksi Android/iOS 29 Oktober 2026

Error login pada emulator terkonfirmasi berasal dari preflight CORS `https://localhost` yang ditolak server publik. Konfigurasi `plugins.CapacitorHttp.enabled = true` kini mengaktifkan transport HTTP native bawaan Capacitor untuk fetch/XHR Android dan iOS. HTTPS dan autentikasi API tetap digunakan; server publik tidak diubah. Konfigurasi CORS backend tetap tersedia untuk akses melalui WebView biasa, tetapi tidak lagi menjadi penghalang transport native ini.

APK baru berhasil dibangun, dipasang ulang, dan dibuka di emulator. Verifikasi langsung dari WebView: GET `/api/v1/auth/me` tanpa token menghasilkan JSON 401 `UNAUTHORIZED`; POST `/api/v1/auth/login` dengan objek kosong menghasilkan JSON 400 `INVALID_INPUT`. Kedua respons membuktikan permintaan mencapai API dan dapat dibaca aplikasi. Tidak memakai kredensial pengguna atau melakukan transaksi. Login dengan akun nyata tetap perlu dicoba pengguna. Konfigurasi iOS sudah disinkronkan tetapi belum diuji pada perangkat/simulator iOS.

## Preview lokal melalui Safari iPhone

Jalankan API lokal pada port 3000, lalu dari frontend jalankan `npm run dev:lan`. Vite menampilkan alamat Network yang harus dibuka melalui Safari iPhone pada jaringan yang sama. Mode LAN memaksa API menjadi `/api/v1` dan memproksikannya ke `127.0.0.1:3000`, sehingga browser HP tidak mencoba mengakses localhost miliknya sendiri. Mode web/mobile lainnya mempertahankan konfigurasi API sebelumnya.

Pada 29 Oktober 2026 alamat Mac adalah `http://172.20.10.13:5173/` (dapat berubah saat pindah jaringan). Frontend memberi HTTP 200, proxy `/api/v1/auth/me` memberi JSON 401 tanpa login, dan readiness backend menyatakan database siap. API preview sesi ini dijalankan dengan `tsx -e 'import { app } from "./src/app"; app.listen(3000, "127.0.0.1");'` dari folder backend, tanpa worker notifikasi. Backend menggunakan database server sesuai `.env` yang sudah ada; transaksi pengujian tetap memengaruhi data tersebut. Worker email tidak dijalankan pada preview ini.

UUID kunci idempotensi memiliki fallback `crypto.getRandomValues` agar Safari pada HTTP LAN dapat membuka aplikasi walaupun `crypto.randomUUID` hanya tersedia pada secure context. Fallback tetap menghasilkan UUID v4 dengan entropi kriptografis. Pengujian UUID, build, dan lint frontend lulus (27 pengujian). Ini preview web lokal, bukan pemasangan binary iOS. Mac dan kedua proses server harus tetap hidup selama pengujian.
