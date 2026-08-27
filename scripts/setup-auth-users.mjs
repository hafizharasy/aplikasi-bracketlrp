// One-time (or re-run-anytime) setup script: creates real Supabase Auth
// accounts — 1 admin + 1 pengawas per room that currently exists in your
// tournament data — with the role/session/roomNo metadata the Edge
// Function and RLS policies rely on.
//
// Because rooms are now created dynamically by admin inside the app
// (Sesi > Tambah Ruangan) rather than fixed in advance, this script reads
// your LIVE room list straight from Supabase instead of assuming a fixed
// count — so it always matches whatever structure admin has actually set
// up, whenever they finish setting it up (e.g. closer to the event day).
// Safe to re-run any time the room structure changes: it only touches
// pengawas accounts for rooms that currently exist, and leaves everything
// else alone.
//
// Run this ONCE per change, locally, from your own computer — never
// deploy it, never commit it with real keys filled in, and never run it
// in a browser. It needs your Supabase SERVICE ROLE key, which can
// bypass all security rules, so treat it like a password.
//
// Usage:
//   1. npm install @supabase/supabase-js  (if not already installed)
//   2. Set the two environment variables below (see README) or edit
//      the constants directly for a one-off run.
//   3. node scripts/setup-auth-users.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'PASTE_YOUR_PROJECT_URL_HERE';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE';

if (SUPABASE_URL.includes('PASTE_') || SERVICE_ROLE_KEY.includes('PASTE_')) {
  console.error('Isi dulu SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY (lihat komentar di atas file ini).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: row, error: readError } = await supabase
  .from('tournament_state')
  .select('data')
  .eq('id', 1)
  .single();

if (readError || !row || !row.data || !Array.isArray(row.data.rooms)) {
  console.error('Gagal membaca data turnamen dari Supabase:', readError?.message || 'data tidak ditemukan.');
  console.error('Pastikan aplikasi sudah pernah dibuka minimal sekali (supaya baris awal tersimpan) dan admin sudah menambahkan ruangan.');
  process.exit(1);
}

const rooms = row.data.rooms;

if (rooms.length === 0) {
  console.log('Belum ada ruangan yang dibuat admin di aplikasi. Tambahkan ruangan dulu lewat Sesi > Tambah Ruangan, baru jalankan script ini.');
  process.exit(0);
}

const accounts = [
  { email: 'admin@lrp2026.internal', password: 'lrp2026', app_metadata: { role: 'admin' } },
];
for (const room of rooms) {
  accounts.push({
    email: `s${room.session}r${room.roomNo}@lrp2026.internal`,
    password: `s${room.session}r${room.roomNo}-2026`,
    app_metadata: { role: 'pengawas', session: room.session, roomNo: room.roomNo },
  });
}

console.log(`Ditemukan ${rooms.length} ruangan di data turnamen. Membuat/memperbarui ${accounts.length} akun (1 admin + ${rooms.length} pengawas)...\n`);

const { data: existingList } = await supabase.auth.admin.listUsers();
const existingUsers = existingList?.users || [];

for (const acc of accounts) {
  const found = existingUsers.find((u) => u.email === acc.email);

  if (found) {
    const { error } = await supabase.auth.admin.updateUserById(found.id, {
      password: acc.password,
      app_metadata: acc.app_metadata,
    });
    console.log((error ? 'GAGAL update ' : 'OK (diperbarui) ') + acc.email, error?.message || '');
  } else {
    const { error } = await supabase.auth.admin.createUser({
      email: acc.email,
      password: acc.password,
      email_confirm: true,
      app_metadata: acc.app_metadata,
    });
    console.log((error ? 'GAGAL buat ' : 'OK (dibuat) ') + acc.email, error?.message || '');
  }
}

console.log('\nSelesai. Kode login di aplikasi:');
console.log('  Admin  -> email: admin@lrp2026.internal   password: lrp2026');
console.log('  Pengawas -> email: s{sesi}r{ruangan}@lrp2026.internal   password: s{sesi}r{ruangan}-2026');
console.log('  (sesuai ruangan yang benar-benar ada sekarang, terdaftar di atas)');
console.log('\nKalau admin menambah/menghapus ruangan lagi nanti, jalankan ulang script ini untuk menyesuaikan akun pengawas.');
