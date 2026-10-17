# Selaras

Web app mobile-first untuk program PIKR Bandung: modul kesehatan mental remaja, pre/post-test, kuis bareng (gaya Kahoot), dan peringkat bersama. Situs statis, tanpa build. Data bersama (peringkat dan kuis) memakai Supabase.

## Isi folder

- `index.html`, `style.css`, `app.js`, `content.js`, `tests.js`, `quiz.js`, `qr.js`, `backend.js`
- `config.js` : tempat mengisi URL dan kunci Supabase
- `supabase/schema.sql` : tabel dan fungsi database

## Langkah 1. Deploy ke Vercel lewat GitHub

1. Buat repo GitHub baru, lalu unggah seluruh isi folder ini ke root repo.
2. Di vercel.com pilih Add New > Project, impor repo tadi.
3. Framework Preset: **Other**. Build Command: kosongkan. Output Directory: kosongkan. Tidak perlu environment variable.
4. Deploy. Setiap `git push` ke branch utama otomatis memperbarui situs.

Sampai di sini aplikasi sudah jalan, tetapi tiap HP berdiri sendiri (tanpa peringkat bersama dan tanpa kuis bareng).

## Langkah 2. Siapkan Supabase

1. Daftar di supabase.com, buat project baru (region terdekat, misalnya Singapore).
2. Buka SQL Editor > New query, tempel isi `supabase/schema.sql`, klik Run.
3. Masih di SQL Editor, jalankan baris ini sekali (ganti sandinya, minimal 8 karakter, panjang lebih baik):

   ```sql
   insert into public.sel_settings (k, v) values ('admin_key', 'GANTI-DENGAN-KATA-SANDI-PANJANG')
   on conflict (k) do update set v = excluded.v;
   ```

4. Buka Project Settings > API Keys. Salin **Project URL** dan **Publishable key** (`sb_publishable_...`, atau anon key lama yang berawalan `eyJ`).

## Langkah 3. Hubungkan

Edit `config.js`:

```js
window.SELARAS_CONFIG = {
  supabaseUrl: "https://xxxx.supabase.co",
  supabaseKey: "sb_publishable_xxx",
  pollMs: 20000
};
```

Commit dan push. Vercel deploy ulang otomatis. Kunci publik memang aman ditaruh di sini karena semua tabel dikunci dengan RLS dan hanya bisa diakses lewat fungsi database. **Jangan pernah** memakai secret key atau service_role key.

## Cara memakai kuis bareng

**Host (kader):**
1. Buka Selaras > Kuis bareng > Buat kuis. Isi soal sendiri, atau pakai tombol untuk mengambil soal dari bank modul. Bisa juga impor.
2. Simpan, lalu tekan Mulai. Muncul kode 6 digit dan QR. Tampilkan ke layar proyektor.
3. Tunggu pemain masuk, tekan Mulai kuis, lalu lanjutkan soal demi soal. Ada tombol lewati, keluarkan pemain, dan akhiri.
4. Di akhir, unduh hasil sebagai CSV.

**Pemain:** buka Selaras > Kuis bareng, masukkan kode dan nama panggilan. Atau scan QR, yang langsung membuka `#kuis=KODE` dengan kode terisi.

Cara kerja: skor dihitung server (jawaban benar makin cepat makin tinggi, maksimal 1000, ditambah bonus beruntun sampai 100). Jawaban benar disembunyikan sampai waktu habis atau semua sudah menjawab. Maksimal 200 pemain dan 40 soal per kuis. Kuis dihapus otomatis setelah 24 jam.

## Peringkat lintas perangkat

Setelah Supabase tersambung, poin tiap peserta dikirim ke database dan peringkat kelompok (per segmen) sama di semua HP dan laptop. Tanpa koneksi, poin tetap tersimpan di HP.

## Rekap untuk kader

Buka `https://domain-kamu/#admin=KATA-SANDI-ADMIN`. Tab Rekap muncul di Profil, lengkap dengan unduhan CSV. Jangan bagikan link ini.

## Link per modul dan poster

- Per modul (melewati urutan terkunci): `#emosi`, `#diri`, `#cemas`, `#bully`, `#seksual`, `#dev`
- Kuis: `#kuis` atau `#kuis=123456`
- FAQ PIKR: `#pikr`

Buat QR dari link tersebut dengan generator QR apa saja.

## Batasan dan keamanan

- Skor dan poin dikirim oleh aplikasi di HP peserta, jadi secara teknis bisa dipalsukan. Cocok untuk kegiatan edukasi, bukan untuk lomba berhadiah. Skor kuis sendiri dihitung server.
- URL dan publishable key terlihat publik oleh siapa pun yang membuka situs. Itu normal.
- Soal kuis buatan host tersimpan di perangkat host (localStorage). Ganti browser atau perangkat berarti soal tidak ikut.
- Aplikasi mengecek server tiap sekitar 1 detik selama kuis berlangsung. Paket gratis Supabase cukup untuk satu kelas. Untuk ratusan pemain bersamaan, pantau pemakaian.
- Project Supabase gratis dijeda bila tidak dipakai sekitar seminggu. Buka dashboard dan klik Restore bila itu terjadi.
- Aplikasi tidak meminta nama asli, nomor HP, atau email.

## Sumber materi

Daftar sumber ada di bagian Sumber pada halaman awal.
