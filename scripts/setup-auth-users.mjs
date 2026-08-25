// One-time setup script: creates the 11 real Supabase Auth accounts
// (1 admin + 10 pengawas, one per room) with the role/session/roomNo
// metadata the Edge Function and RLS policies rely on.
//
// Run this ONCE, locally, from your own computer — never deploy it,
// never commit it with real keys filled in, and never run it in a
// browser. It needs your Supabase SERVICE ROLE key, which can bypass
// all security rules, so treat it like a password.
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

// Same session/room counts as SESSION_DEFAULT in src/App.jsx (3-3-2-2).
const SESSION_ROOM_COUNTS = { 1: 3, 2: 3, 3: 2, 4: 2 };

const accounts = [
  { email: 'admin@lrp2026.internal', password: 'lrp2026', app_metadata: { role: 'admin' } },
];
for (const session of [1, 2, 3, 4]) {
  for (let roomNo = 1; roomNo <= SESSION_ROOM_COUNTS[session]; roomNo++) {
    accounts.push({
      email: `s${session}r${roomNo}@lrp2026.internal`,
      password: `s${session}r${roomNo}-2026`,
      app_metadata: { role: 'pengawas', session, roomNo },
    });
  }
}

console.log(`Membuat/memperbarui ${accounts.length} akun...\n`);

for (const acc of accounts) {
  const { data: existing } = await supabase.auth.admin.listUsers();
  const found = existing?.users?.find((u) => u.email === acc.email);

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

console.log('\nSelesai. Kode akses login di aplikasi TETAP SAMA seperti sebelumnya:');
console.log('  Admin: lrp2026');
console.log('  Pengawas: s{sesi}r{ruangan}-2026, contoh s1r1-2026, s3r2-2026, dst.');
