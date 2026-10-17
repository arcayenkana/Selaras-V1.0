/* Pengaturan Selaras.
   Isi dua nilai di bawah dari Supabase (Project Settings > API Keys), lihat README.md langkah 3.
   supabaseUrl : alamat proyek, contoh "https://abcdefgh.supabase.co"
   supabaseKey : kunci publik (Publishable key "sb_publishable_..." atau anon key lama). Aman ditaruh di sini,
                 JANGAN pernah memasukkan secret key atau service_role key.
   Bila dikosongkan, aplikasi tetap jalan di HP masing-masing tanpa peringkat bersama dan tanpa kuis bareng. */
window.SELARAS_CONFIG = {
  supabaseUrl: "",
  supabaseKey: "",
  pollMs: 20000
};
