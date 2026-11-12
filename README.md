# ALHUDA_D.NET — Aplikasi Android Admin Hotspot (mode langsung ke router)

Versi ini **tidak butuh server, PHP, atau hosting sama sekali**. Aplikasi
berbicara **langsung ke MikroTik** lewat RouterOS API (TCP) dari dalam HP.
Cukup isi IP/host, port, username, dan password router.

Fitur: Beranda (info MikroTik, hotspot aktif, trafik angka, pendapatan),
Pengguna (lihat/tambah/hasilkan/cepat + profil), Log, Laporan (bulan ini/kemarin),
Peraturan (daftar router, nama aplikasi, logo, tema). Cetak PDF voucher &
bagikan ke WhatsApp tetap ada.

```
ALHUDA_D.NET/
├─ www/                      ← isi aplikasi (HTML/CSS/JS)
├─ plugins/routeros/         ← plugin native (Java) RouterOS API via TCP
├─ resources/                ← icon.png & splash.png
├─ .github/workflows/        ← build APK otomatis di GitHub
├─ capacitor.config.json
├─ package.json
└─ README.md
```

---

## Membuat APK lewat GitHub (tanpa Android Studio)

1. Buat repository baru di github.com (boleh Private).
2. Ekstrak ZIP, lalu unggah **ISI** folder `ALHUDA_D.NET` ke root repo
   (`package.json`, `www`, `plugins`, `.github`, dll harus di root — bukan di
   dalam subfolder).
3. Buka tab **Actions** → workflow **Build APK** jalan otomatis (atau Run workflow).
   Build pertama agak lama (Gradle mengunduh Android SDK + meng-compile plugin native).
4. Setelah centang hijau → buka run → bagian **Artifacts** → unduh
   **`ALHUDA_D.NET-debug-apk`** → ekstrak → `app-debug.apk`.
5. Pasang di HP (izinkan "Install dari sumber tidak dikenal").

> Build via komputer sendiri juga bisa: `npm install && npx cap add android && npx cap sync android`,
> lalu `cd android && ./gradlew assembleDebug`.

---

## Pakai pertama kali (di aplikasi)

Buka **Peraturan → Tambah Router**, isi:
- **Nama Sesi** — bebas, mis. `alhuda`.
- **Nama Hotspot** — mis. `alhuda_d.net` (untuk judul voucher).
- **IP / Host MikroTik** — alamat API router. Jika pakai tunnel seperti di
  Mikhmon Anda, isi host-nya saja, mis. `id-16.tunnel.web.id`.
- **Port API** — default MikroTik `8728`. Jika lewat tunnel, pakai port
  tunnelnya (mis. `7999`).
- **Username / Password** — user API MikroTik Anda.
- **Mata Uang** — mis. `Rp`.
- **Antarmuka Lalu Lintas** — interface untuk grafik trafik, mis. `ether1`
  (pilih interface WAN, bukan port CCTV).

Lalu tekan **Connect**. Kalau hijau "Connected", semua menu aktif. Bisa
menambah beberapa router; pilih lewat dropdown di atas.

### Syarat di MikroTik
- Service **api** harus aktif: `/ip service enable api` (atau lewat Winbox:
  IP → Services → api → enable). Port default 8728.
- User yang dipakai harus punya hak **api** + **read/write** (grup `full`
  paling mudah).
- Jika router di belakang NAT, API harus bisa dijangkau dari internet
  (lewat tunnel/port-forward) — sama seperti yang sudah Anda pakai di Mikhmon.

---

## Catatan

- **Laporan pendapatan** hanya terisi untuk profil bermode **"Remove & Record"**
  atau **"Notice & Record"** (RouterOS mencatat transaksi dari situ).
- **Cetak PDF** memakai dialog cetak sistem (Save as PDF). **Bagikan WA** membuka
  WhatsApp dengan teks voucher.
- Semua data (daftar router + password) disimpan **lokal di HP** — tidak dikirim
  ke mana pun selain langsung ke router Anda. Jaga HP tetap aman.
- Router RouterOS v6 (seperti 6.49) memakai API binari ini (belum ada REST API).
  Aplikasi sudah menangani login v6 maupun v6.43+.

## Ubah Application ID
Default `net.alhudadnet.admin` di `capacitor.config.json`. Ubah **sebelum**
`npx cap add android` bila perlu.
