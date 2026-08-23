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

-- Catatan keamanan: policy di bawah membuat tabel bisa dibaca & ditulis oleh
-- siapa pun yang punya anon key (sama seperti PIN admin di aplikasi: proteksi
-- ringan di sisi tampilan, bukan otorisasi sungguhan). Ini sengaja dibuat
-- terbuka supaya perilakunya sama seperti versi sebelumnya. Kalau nanti mau
-- membatasi hanya panitia yang login yang bisa menulis, ganti policy update
-- di bawah supaya mensyaratkan auth.role() = 'authenticated' dan aktifkan
-- Supabase Auth.

create policy "Public can read tournament state"
  on public.tournament_state for select
  using (true);

create policy "Public can update tournament state"
  on public.tournament_state for update
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

-- sama seperti tabel di atas: dibuat terbuka (anon key bisa baca & unggah)
-- supaya konsisten dengan model keamanan ringan yang dipakai aplikasi ini
create policy "Public read match photos"
  on storage.objects for select
  using (bucket_id = 'match-photos');

create policy "Public upload match photos"
  on storage.objects for insert
  with check (bucket_id = 'match-photos');

create policy "Public update match photos"
  on storage.objects for update
  using (bucket_id = 'match-photos');
