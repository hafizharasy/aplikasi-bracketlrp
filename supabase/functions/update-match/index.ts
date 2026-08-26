// Edge Function: update-match
//
// All writes to the tournament (room results, room details, admin actions)
// go through this function instead of writing to the table directly. This is
// what makes the RLS upgrade meaningful: the table itself has NO client-writable
// policy, so the only way to change data is through here, where we verify who
// the caller really is (via their Supabase Auth session) and — for pengawas —
// that the change they're proposing stays inside their own assigned room.
//
// Deploy with: supabase functions deploy update-match

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Same logic verified standalone in test-edge-validator.mjs before being placed here.
function validateWrite(currentData, newData, callerRole, callerSession, callerRoomNo) {
  if (callerRole === 'admin') return { ok: true };
  if (callerRole !== 'pengawas') return { ok: false, error: 'Forbidden: unknown role' };

  const ownRoomIdx = currentData.rooms.findIndex(
    (r) => r.session === callerSession && r.roomNo === callerRoomNo
  );
  if (ownRoomIdx === -1) return { ok: false, error: 'Forbidden: room not found for this pengawas' };

  if (!newData.rooms || newData.rooms.length !== currentData.rooms.length) {
    return { ok: false, error: 'Forbidden: room list shape changed' };
  }

  for (let i = 0; i < currentData.rooms.length; i++) {
    if (i === ownRoomIdx) continue;
    if (JSON.stringify(currentData.rooms[i]) !== JSON.stringify(newData.rooms[i])) {
      return { ok: false, error: `Forbidden: modified room index ${i}, not your assigned room` };
    }
  }

  if (JSON.stringify(currentData.finalStage) !== JSON.stringify(newData.finalStage)) {
    return { ok: false, error: 'Forbidden: modified babak lanjutan' };
  }

  if (JSON.stringify(currentData.settings) !== JSON.stringify(newData.settings)) {
    return { ok: false, error: 'Forbidden: modified settings' };
  }

  const oldRoom = currentData.rooms[ownRoomIdx];
  const newRoom = newData.rooms[ownRoomIdx];
  const lockedFields = ['id', 'name', 'session', 'roomNo', 'schools', 'participants'];
  for (const f of lockedFields) {
    if (JSON.stringify(oldRoom[f]) !== JSON.stringify(newRoom[f])) {
      return { ok: false, error: `Forbidden: cannot change room.${f}` };
    }
  }

  // pengawasName is recorded per match, but stays admin-only to set — even the
  // room's own pengawas may not change it (they may still change winner, photo,
  // durationSeconds, and violations on their own matches).
  if (!oldRoom.rounds || !newRoom.rounds || oldRoom.rounds.length !== newRoom.rounds.length) {
    return { ok: false, error: 'Forbidden: rounds shape changed' };
  }
  for (let r = 0; r < oldRoom.rounds.length; r++) {
    const oldRound = oldRoom.rounds[r];
    const newRound = newRoom.rounds[r];
    if (!newRound || oldRound.length !== newRound.length) {
      return { ok: false, error: 'Forbidden: rounds shape changed' };
    }
    for (let m = 0; m < oldRound.length; m++) {
      const oldPengawas = oldRound[m] ? oldRound[m].pengawasName || '' : '';
      const newPengawas = newRound[m] ? newRound[m].pengawasName || '' : '';
      if (oldPengawas !== newPengawas) {
        return { ok: false, error: 'Forbidden: pengawasName is admin-only' };
      }
    }
  }

  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized: no session' }, 401);

  // client scoped to the CALLER's own JWT, only used to find out who they are
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Unauthorized: invalid session' }, 401);

  const meta = userData.user.app_metadata || {};
  const callerRole = meta.role;
  const callerSession = meta.session;
  const callerRoomNo = meta.roomNo;

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }
  const newData = body?.newData;
  if (!newData || !Array.isArray(newData.rooms)) {
    return json({ error: 'Invalid payload: missing newData.rooms' }, 400);
  }

  // service-role client: bypasses RLS, but only used AFTER the checks above/below
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: row, error: readErr } = await adminClient
    .from('tournament_state')
    .select('data')
    .eq('id', 1)
    .single();
  if (readErr || !row) return json({ error: 'Could not read current state' }, 500);

  const result = validateWrite(row.data, newData, callerRole, callerSession, callerRoomNo);
  if (!result.ok) return json({ error: result.error }, 403);

  const { error: writeErr } = await adminClient
    .from('tournament_state')
    .update({ data: newData, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (writeErr) return json({ error: 'Write failed' }, 500);

  return json({ ok: true });
});
