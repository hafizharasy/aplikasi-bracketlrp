# LRP Bracket 2026 — Versi Mandiri (Supabase)

Versi standalone dari tournament bracket LRP: 10 ruangan × 64 peserta, single elimination, sampai babak lanjutan (semifinal & final). Tampilan dan semua logic-nya sama persis seperti versi Claude sebelumnya — yang beda cuma penyimpanan datanya, sekarang pakai database Supabase sungguhan, jadi bisa di-deploy dan diakses di luar Claude sepenuhnya.

## 1. Bikin project Supabase

1. Daftar/login di https://supabase.com (gratis)
2. Bikin project baru, tunggu provisioning selesai (~2 menit)
3. Buka **SQL Editor** di sidebar → **New query**
4. Copy-paste seluruh isi `supabase/schema.sql`, klik **Run**
5. Buka **Settings > API**, catat dua hal ini:
   - **Project URL**
   - **anon public** key

## 2. Setup di komputer

```bash
npm install
cp .env.example .env
```

Isi `.env` dengan URL & key dari langkah sebelumnya:

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxxxx...
```

## 3. Coba jalan lokal

```bash
npm run dev
```

Buka http://localhost:5173 — coba masuk mode Admin (PIN default `lrp2026`, bisa diganti di `src/App.jsx`), impor beberapa nama, dan klik-klik pertandingan buat mastiin datanya kesimpan (cek juga tabel `tournament_state` di Supabase Table Editor, isinya harus berubah).

## 4. Deploy supaya bisa diakses panitia lain

Paling gampang pakai **Vercel** atau **Netlify** (gratis buat project seukuran ini):

1. Push folder ini ke repo GitHub baru
2. Import repo itu di vercel.com (atau netlify.com)
3. Waktu diminta environment variables, isi `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` sama seperti isi `.env`
4. Deploy — nanti dapet link publik yang bisa dibagikan ke semua panitia

## Kalau mau lanjut pakai Claude Code

Folder ini sudah siap dipakai dengan Claude Code untuk pengembangan lanjutan (nambah fitur, ubah struktur babak final, dsb). Command yang sebelumnya kamu temukan pas dipakai di sini:

```bash
npx plugins add supabase-community/supabase-plugin
```

Ini menyambungkan Claude Code langsung ke project Supabase-mu (bisa query database, bikin migration baru, dll) tanpa bolak-balik manual antara SQL Editor dan terminal.

## Yang berubah dari versi Claude

- Penyimpanan: Claude `window.storage` → tabel `tournament_state` di Supabase
- **Bonus**: sekarang ada live sync — kalau satu admin ubah hasil pertandingan, semua orang yang lagi buka app langsung lihat perubahannya tanpa refresh (pakai Supabase Realtime)
- Semua logic bracket (64 besar → final ruangan → babak lanjutan), tampilan, PIN admin, impor massal, dan tombol simulasi — persis sama seperti sebelumnya

## Fitur baru: peran Pengawas & detail pertandingan

Sekarang ada 3 level akses:

| Peran | Cara masuk | Bisa apa |
|---|---|---|
| **Publik** | tanpa login (default) | lihat semua bracket & detail pertandingan (foto/durasi/catatan), read-only |
| **Pengawas** | masukkan kode ruangan, format `r1-2026`, `r2-2026`, … `r10-2026` | untuk ruangan itu saja: tentuin pemenang, unggah foto hasil, isi durasi permainan, catat pelanggaran |
| **Admin** | PIN `lrp2026` | semua yang bisa Pengawas (di semua ruangan) + kelola sesi, impor massal, simulasi, babak lanjutan, reset |

Kode pengawas tinggal dikasih tau ke tiap pengawas ruangan (misal ditulis di kertas di mejanya): ruangan 1 pakai `r1-2026`, ruangan 2 pakai `r2-2026`, dst. Field PIN di aplikasi sama untuk admin maupun pengawas — sistem otomatis kenali dari kode yang diketik. Pola ini didefinisikan di fungsi `getPengawasPin` dalam `src/App.jsx` kalau mau diubah jadi kode custom per ruangan.

Setiap pertandingan sekarang punya ikon kamera kecil di pojok kartu — klik itu untuk buka detail: foto hasil (pengawas ambil lewat kamera HP), durasi permainan (menit), dan catatan pelanggaran. Titik merah kecil muncul di ikon itu kalau sudah ada foto atau catatan pelanggaran, jadi gampang dipindai sekilas.

Babak lanjutan (semifinal/final) pakai detail pertandingan yang sama, tapi cuma Admin yang bisa mengisinya — pengawas memang sengaja dibatasi hanya untuk ruangan yang jadi tanggung jawabnya.

## Fitur baru: impor peserta dari Excel/CSV

Selain tempel teks manual, sekarang ada cara impor yang lebih cocok buat daftar peserta yang sudah disusun panitia per sesi & ruangan:

1. Buka modal impor (tombol "Impor 640 Peserta" di dashboard, mode Admin), lalu klik **"Unduh template kosong"** — ini file Excel siap pakai, 640 baris sudah otomatis terisi kolom `sesi` dan `ruangan` sesuai pembagian default, tinggal isi kolom `nama`.
2. Isi kolom `nama` di sheet "Data Peserta" (satu nama per baris, urutan baris = urutan seed di bracket). Sheet "Petunjuk" di file yang sama berisi panduan lengkapnya.
3. Simpan file (`.xlsx`), lalu di aplikasi klik **"Pilih File"** dan unggah file itu.
4. Aplikasi langsung menampilkan pratinjau per ruangan (jumlah nama terbaca & sesi terdeteksi) sebelum diterapkan — kalau ada ruangan yang jumlah namanya bukan 64, itu ditandai supaya bisa dicek dulu.
5. Klik **"Terapkan dari File"** untuk menyimpan semuanya sekaligus ke 10 ruangan.

Format kolom yang dikenali (nama kolom tidak case-sensitive): `sesi`/`session`, `ruangan`/`room`, `nama`/`name`/`peserta`. File CSV dengan kolom yang sama juga didukung, tidak harus Excel.

Fitur tempel teks manual (yang lama) tetap ada di bawahnya untuk perbaikan cepat satu ruangan tanpa perlu bikin ulang file Excel.

## Catatan keamanan

PIN admin dan kode pengawas cuma proteksi ringan di tampilan, bukan otorisasi sungguhan — dan tabel Supabase serta bucket foto-nya sengaja dibuat bisa dibaca & ditulis publik (lewat anon key) supaya perilakunya konsisten dengan itu. Siapa pun yang tahu kodenya (atau membaca kode sumber aplikasi) bisa menulis lewat anon key, sama seperti versi sebelumnya. Kalau nanti butuh keamanan lebih serius (misal cuma akun panitia tertentu yang boleh ubah data atau unggah foto), tinggal bilang — bisa ditambah Supabase Auth dan policy yang lebih ketat.

## Fitur baru: halaman Selamat Datang, login terpusat, dan bracket kupu-kupu

Struktur navigasi sekarang:

1. **Halaman Selamat Datang** (tampilan pertama dibuka) — dua pilihan besar: **Lihat Bracket** (publik, buat peserta/wali murid) dan **Login Panitia** (pengawas & admin).
2. **Lihat Bracket** → daftar 10 ruangan → pilih satu → tampilan bracket ruangan itu, read-only.
3. **Login Panitia** → masukkan PIN admin (`lrp2026`) atau kode ruangan pengawas (`r1-2026` dst) di satu kolom yang sama, sistem otomatis kenali. Admin diarahkan ke dashboard; pengawas langsung diarahkan ke ruangannya sendiri (tapi tetap bisa lihat ruangan lain secara read-only lewat dashboard).

**Pembagian sesi juga sudah diperbaiki** sesuai struktur LRP yang sebenarnya: Sesi 1 = Ruangan 1-3 (3 ruangan), Sesi 2 = Ruangan 4-5 (2 ruangan), Sesi 3 = Ruangan 6-7 (2 ruangan), Sesi 4 = Ruangan 8-10 (3 ruangan).

**Tampilan bracket per ruangan** sekarang berbentuk kupu-kupu, fix di rasio 16:9, tanpa geser — cocok ditampilkan di proyektor/layar/TV maupun laptop:
- 32 peserta jalur kiri, 32 peserta jalur kanan, keduanya mengerucut ke satu kotak **Final** di tengah
- Semua 64 nama & 63 pertandingan kelihatan sekaligus, tanpa perlu scroll
- Ikon kamera kecil di tiap kotak untuk buka detail (foto/durasi/pelanggaran) — sama seperti sebelumnya
- Karena sangat padat, di layar HP yang kecil teks otomatis mengecil mengikuti skala — browser tetap bisa di-pinch zoom untuk baca detail nama. Kalau ini kurang nyaman di HP, kasih tahu aku, bisa dibuatkan mode alternatif khusus mobile.

Geometri bracket ini (posisi tiap kotak & garis penghubung) sudah aku verifikasi lewat simulasi program terpisah sebelum ditulis ke kode — memastikan jalur kiri dan kanan sama-sama presisi bertemu di tengah.

## Batasan yang perlu diketahui

Data tersimpan sebagai satu baris JSON, jadi kalau dua admin nulis hasil di detik yang persis sama, yang terakhir nulis yang menang (last-write-wins) — sama seperti karakteristik versi Claude sebelumnya, bukan regresi baru.

## Revisi terbaru: penomoran ruangan, kunci akses, reset granular, kelola peserta

- **Ruangan diberi nomor ulang per sesi.** Sesi 1 & 2 masing-masing punya Ruangan 1-3, Sesi 3 & 4 masing-masing punya Ruangan 1-2 (total tetap 10 ruangan). Kode akses pengawas ikut berubah formatnya jadi `s{sesi}r{ruangan}-2026` — contoh `s1r1-2026` untuk Sesi 1 Ruangan 1, `s3r2-2026` untuk Sesi 3 Ruangan 2.
- **Detail pertandingan (foto/durasi/pelanggaran) disembunyikan dari publik.** Ikon kamera di tiap kotak cuma muncul untuk pengawas ruangan itu dan admin — peserta/wali murid cuma lihat hasil bracket-nya saja.
- **Pengawas dikunci ke ruangannya sendiri.** Setelah login, pengawas tidak bisa pindah ke ruangan lain atau lihat dashboard semua ruangan — otomatis diarahkan balik kalau mencoba. Hanya admin yang bisa melihat & mengelola semua ruangan sekaligus.
- **Reset jadi granular.** Tombol reset semua ruangan sekaligus sudah dihapus. Sekarang ada "Reset Ruangan" (di halaman ruangan, admin) yang cuma me-reset satu ruangan itu, dan "Reset Hasil Pertandingan Ini" (di modal detail pertandingan) yang cuma membatalkan hasil satu pertandingan spesifik.
- **Kelola Peserta**, menu baru khusus admin untuk mengisi nama satu per satu (selain impor massal yang sudah ada) — cocok kalau panitia mau menyusun sendiri siapa lawan siapa berdasarkan pertimbangan kualifikasi peserta.
- **Nama sekolah** kini tampil di bawah nama peserta di bracket. Diisi admin lewat Kelola Peserta satu-satu, atau lewat kolom "sekolah" (opsional) di template Excel/CSV impor massal. Pengawas ruangan tidak bisa mengubah nama peserta maupun sekolah — itu murni wewenang admin.

## Level Penuh: RLS terkunci dengan Supabase Auth beneran

Ini perubahan yang lebih besar dari update-update sebelumnya, jadi dibaca pelan-pelan ya. Yang berubah secara arsitektur:

- Tabel `tournament_state` sekarang **tidak bisa ditulis langsung** oleh siapa pun dari browser, sekalipun sudah login. Satu-satunya jalan menulis adalah lewat **Edge Function** (`update-match`) yang jalan di server Supabase.
- Login sekarang pakai **akun Supabase Auth beneran** (bukan lagi PIN yang cuma dicek di JavaScript), tapi **kode yang diketik pengguna tetap sama persis** seperti sebelumnya (`lrp2026` untuk admin, `s1r1-2026` dst untuk pengawas) — jadi tidak ada yang perlu diajarkan ulang ke panitia.
- Edge Function itu memeriksa identitas si pemanggil dari sesi login-nya, dan khusus untuk pengawas, **memastikan perubahan yang dikirim cuma menyentuh ruangan miliknya sendiri** — dicoba tulis ke ruangan lain akan ditolak, bukan cuma disembunyikan di tampilan. Logika pemeriksaan ini sudah aku uji terpisah dengan 8 skenario (termasuk skenario "pengawas nyoba nyelundupin perubahan ke ruangan lain") sebelum ditulis ke Edge Function-nya.
- Bonus: karena sekarang pakai sesi login beneran, admin/pengawas **tidak perlu login ulang setiap refresh halaman** — sesinya tersimpan otomatis oleh Supabase.

### Langkah setup (urutannya penting)

**1. Jalankan ulang `supabase/schema.sql`** di SQL Editor (yang ini aman dijalankan ulang meskipun sudah pernah pakai versi lama — otomatis menghapus policy tulis publik yang lama).

**2. Install Supabase CLI** (kalau belum ada) dan login:
```bash
npm install -g supabase
supabase login
```

**3. Hubungkan folder proyek ke project Supabase kamu:**
```bash
supabase link --project-ref xxxxxxxxxxxxx
```
(`xxxxxxxxxxxxx` ada di URL dashboard Supabase kamu, atau di Settings > General.)

**4. Deploy Edge Function-nya:**
```bash
supabase functions deploy update-match
```

**5. Buat 11 akun (1 admin + 10 pengawas).** Ini dijalankan SATU KALI di komputer kamu sendiri, TIDAK PERNAH di-commit ke GitHub atau dijalankan di browser, karena butuh **Service Role key** (kunci paling berkuasa, beda dari anon key biasa — ada di Settings > API > `service_role`, bukan yang `anon public`):
```bash
cd scripts
npm install @supabase/supabase-js
SUPABASE_URL="https://xxxxx.supabase.co" SUPABASE_SERVICE_ROLE_KEY="isi-service-role-key-di-sini" node setup-auth-users.mjs
```
Setelah ini jalan sukses, kode login admin/pengawas langsung bisa dipakai — **sama persis** seperti kode yang sudah kamu pakai sekarang.

**6. Update `App.jsx`** seperti biasa (timpa di GitHub, Vercel auto-deploy).

### Kalau mau ubah/tambah pengawas nanti

Jalankan lagi `scripts/setup-auth-users.mjs` — script ini aman dijalankan berkali-kali, otomatis mendeteksi akun yang sudah ada dan cuma memperbarui passwordnya kalau perlu.

### Kalau ada yang gagal simpan

Sekarang kalau penyimpanan gagal (misalnya sesi kadaluarsa, atau — seharusnya tidak terjadi lewat aplikasi normal — ada percobaan menulis ke ruangan yang bukan miliknya), muncul badge merah kecil di header aplikasi menjelaskan alasannya, dan perubahan yang gagal otomatis dibatalkan di tampilan (tidak diam-diam hilang tanpa pemberitahuan seperti sebelumnya).


