-- Jalankan semua isi file ini di Supabase Dashboard > SQL Editor > New query > Run

create table if not exists public.tournament_state (
  id integer primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- baris tunggal yang menyimpan seluruh state turnamen (10 ruangan + babak lanjutan)
insert into public.tournament_state (id, data)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

alter table public.tournament_state enable row level security;

-- ============================================================
-- LEVEL PENUH: RLS terkunci, akses tulis lewat Edge Function
-- ============================================================
-- Baca (SELECT) tetap terbuka untuk siapa saja — ini yang membuat fitur
-- "Lihat Bracket" bisa diakses publik tanpa login.
--
-- Tulis (UPDATE) TIDAK diberi policy sama sekali di sini secara sengaja.
-- Tanpa policy, RLS menolak semua percobaan tulis langsung dari client,
-- termasuk dari akun yang sudah login. Satu-satunya jalan menulis adalah
-- lewat Edge Function `update-match`, yang memverifikasi identitas
-- (lewat sesi Supabase Auth pemanggil) dan — untuk pengawas — memastikan
-- perubahan yang diajukan cuma menyentuh ruangan yang jadi tanggung
-- jawabnya, sebelum menulis pakai service role key (yang melewati RLS).
--
-- Kalau sebelumnya sudah pernah menjalankan skema versi lama, baris di
-- bawah ini menghapus policy tulis publik yang lama.
drop policy if exists "Public can update tournament state" on public.tournament_state;

create policy "Public can read tournament state"
  on public.tournament_state for select
  using (true);

-- aktifkan realtime supaya semua admin/perangkat yang buka app langsung
-- lihat update tanpa perlu refresh
alter publication supabase_realtime add table public.tournament_state;

-- ============================================================
-- Storage bucket untuk foto hasil pertandingan (diisi pengawas)
-- ============================================================

insert into storage.buckets (id, name, public)
values ('match-photos', 'match-photos', true)
on conflict (id) do nothing;

-- Baca tetap publik (biar foto bisa ditampilkan ke siapa saja yang lihat
-- bracket), tapi unggah/ubah sekarang wajib login (akun admin atau pengawas
-- asli) — bukan lagi terbuka untuk siapa saja yang tahu anon key.
drop policy if exists "Public upload match photos" on storage.objects;
drop policy if exists "Public update match photos" on storage.objects;

create policy "Public read match photos"
  on storage.objects for select
  using (bucket_id = 'match-photos');

create policy "Authenticated users can upload match photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'match-photos');

create policy "Authenticated users can update match photos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'match-photos');
