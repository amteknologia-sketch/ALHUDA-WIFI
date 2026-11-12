# ALHUDA_D.NET — Aplikasi Android (APK)
Dayah Al-Huda Malikussaleh · Property Of DAMAS.Media_Centre 2026

Aplikasi Android ini **terhubung langsung ke API MikroTik (10.10.10.1:8728) dari HP**, tanpa server atau hosting.
Menu yang tersedia: Beranda, Informasi, Paket, Wifi, dan Peraturan.

## Cara build APK (GitHub Actions, tanpa install apa pun di laptop)

1. Buka https://github.com dan login. Klik **New repository**, beri nama misalnya `alhuda-dnet-apk`, lalu klik **Create repository**.
2. Ekstrak zip ini. Di halaman repo, klik **uploading an existing file**, lalu seret **seluruh isi** folder `alhuda-apk`
   (termasuk folder `.github`, `www`, `native`, `resources`, `scripts`, `hotspot`, serta file `package.json` dan `capacitor.config.json`). Klik **Commit changes**.
   > Folder `.github` kadang tersembunyi di Windows/HP. Aktifkan *Tampilkan file tersembunyi*.
   > Jika tetap tidak terunggah, buat file manual: **Add file → Create new file**, beri nama `.github/workflows/build-apk.yml`, lalu tempel isinya.
3. Buka tab **Actions**. Workflow **Build APK ALHUDA_D.NET** akan berjalan sendiri (sekitar 4–7 menit).
   Jika tidak berjalan, pilih workflow tersebut lalu klik **Run workflow**.
4. Setelah ada tanda centang hijau, klik nama run tersebut. Di bagian **Artifacts**, unduh **ALHUDA_D.NET-APK**, lalu ekstrak zip-nya untuk mendapatkan file `.apk`.
5. Pindahkan APK ke HP dan buka filenya. Izinkan *Instal dari sumber tidak dikenal* jika diminta.

Setiap kali ada file yang diubah lalu di-commit, APK baru akan dibuat otomatis.

### Build di laptop sendiri (opsional)
Butuh Node.js 20+, JDK 21, dan Android Studio/SDK.
```
npm install
npm run android:add          # membuat folder android + memasang plugin, ikon, splash
cd android && ./gradlew assembleDebug
# hasil: android/app/build/outputs/apk/debug/app-debug.apk
```

## Pengaturan MikroTik (wajib)

**1. Aktifkan API**
```
/ip service set api disabled=no port=8728
```

**2. (Sangat disarankan) Buat user API khusus aplikasi dengan hak terbatas**
```
/user group add name=apk-hotspot policy=read,write,api
/user add name=zakas password=zakas group=apk-hotspot
```
Jika user `zakas` sudah ada sebagai admin penuh, sebaiknya buat user lain (misalnya `apkdnet`).
Setelah itu ganti user/password di **Peraturan → Koneksi MikroTik**, atau ubah nilai bawaannya di `www/assets/backend.js` (`DEF_ROUTER`) sebelum build.

**3. Izinkan HP yang belum login hotspot mengakses API.** Aturan ini dibutuhkan agar tombol HUBUNGKAN di aplikasi bisa dipakai sebelum login:
```
/ip firewall filter add chain=pre-hs-input protocol=tcp dst-port=8728 action=accept comment="APK ALHUDA_D.NET"
```

**4. (Opsional) Halaman login hotspot di router.** Unggah `hotspot/login.html`, `hotspot/alogin.html`, dan folder `hotspot/img/` ke folder hotspot di MikroTik.
Biarkan `var PORTAL = '';` tetap kosong.

## Cara kerja
- **Data bersama disimpan di MikroTik.** Header, banner, pemberitahuan, paket, wifi, kode admin, dan notifikasi ganti username disimpan di **System → Scripts** dengan nama `ALHUDA_CFG_*`, `ALHUDA_BANNER_*`, dan `ALHUDA_NOTIF_*`. Karena itu, perubahan admin dari satu HP langsung terlihat di semua HP. **Jangan hapus script tersebut.**
- **Koneksi router disimpan di masing-masing HP.** IP, port, user, dan password yang diubah di Peraturan hanya berlaku di HP itu.
- **Kode admin bawaan: `Zakas11`.** Kode ini bisa diganti di Peraturan dan langsung berlaku di semua HP.
- **HUBUNGKAN:** aplikasi memeriksa kode, lalu me-login-kan HP ke hotspot lewat API (`/ip hotspot active login`, berdasarkan IP dan MAC HP).
- **Offline:** tampilan dan data terakhir tersimpan di HP. Data diperbarui otomatis saat tersambung ke router, atau dengan tombol ⟳.
- **Kadaluarsa:** dibaca dari komentar user yang dibuat Mikhmon dan validity di profil, atau dari scheduler yang bernama sama dengan user.

## Batas indikator (ubah di `www/assets/app.js`, bagian `LIM`)
| Indikator | Maks | Kuning | Merah |
|---|---|---|---|
| Penggunaan Data user | 500 GB | 400 GB | 450 GB |
| Kadaluarsa | 100% | 70% | 90% |
| Total Data | 30.000 GB | 25.000 GB | 28.000 GB |
| Hotspot Aktif | 100 | 70 | 90 |
| Lalu Lintas | 200 Mbps | 150 Mbps | 180 Mbps |
| Interface Padat | 40 Mbps | 30 Mbps | 35 Mbps |

## Catatan keamanan
User dan password API tersimpan di dalam APK. Siapa pun yang membongkar APK bisa melihatnya.
Karena itu, **jangan pakai akun admin penuh**. Gunakan grup `apk-hotspot` (read, write, api) seperti pada langkah 2.
