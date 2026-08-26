import { useState, useEffect, useRef, Fragment } from 'react';
import { Trophy, Lock, Unlock, ChevronLeft, Upload, RotateCcw, X, Plus, Trash2, Shuffle, Camera, FileSpreadsheet, UserCog } from 'lucide-react';
import { supabase } from './supabaseClient';

const ROOM_COUNT = 10;
const PARTICIPANTS_PER_ROOM = 64;
const ROUND_NAMES = ['Babak 64 Besar', 'Babak 32 Besar', 'Babak 16 Besar', 'Perempat Final', 'Semifinal Ruangan', 'Final Ruangan'];
const ADMIN_PIN = 'lrp2026';
const SESSION_DEFAULT = { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 3, 8: 3, 9: 4, 10: 4 };
const STAGE_H = 1990;
const STAGE_W = STAGE_H * 16 / 9;
const HEADER_H = 70;
const BODY_H = STAGE_H - HEADER_H;
const SIDE_BASE = BODY_H / 16;
const NORMAL_COL_W = 261;
const CENTER_COL_W = 390;
const GAP_W = 45;
const SIDE_ROUND_LABELS = ['64 Besar', '32 Besar', '16 Besar', 'Perempat Final', 'Semifinal'];

function buildConnectorPath(fromCount, fromSlotH, gapWidth) {
  const toCount = fromCount / 2;
  let d = '';
  for (let j = 0; j < toCount; j++) {
    const topY = (2 * j) * fromSlotH + fromSlotH / 2;
    const botY = (2 * j + 1) * fromSlotH + fromSlotH / 2;
    const midY = (topY + botY) / 2;
    d += `M0,${topY} H${gapWidth / 2} M${gapWidth / 2},${topY} V${botY} M${gapWidth / 2},${midY} H${gapWidth} `;
  }
  return d.trim();
}

function buildConnectorPathMirrored(fromCount, fromSlotH, gapWidth) {
  const toCount = fromCount / 2;
  let d = '';
  for (let j = 0; j < toCount; j++) {
    const topY = (2 * j) * fromSlotH + fromSlotH / 2;
    const botY = (2 * j + 1) * fromSlotH + fromSlotH / 2;
    const midY = (topY + botY) / 2;
    d += `M${gapWidth},${topY} H${gapWidth / 2} M${gapWidth / 2},${topY} V${botY} M${gapWidth / 2},${midY} H0 `;
  }
  return d.trim();
}

function computeStageLayout() {
  const totalContentW = 10 * NORMAL_COL_W + CENTER_COL_W + 10 * GAP_W;
  const startX = (STAGE_W - totalContentW) / 2;
  let x = startX;
  const matchCols = [];
  const connectors = [];

  for (let r = 0; r <= 4; r++) {
    const matchCount = 16 / Math.pow(2, r);
    const slotH = SIDE_BASE * Math.pow(2, r);
    matchCols.push({ side: 'left', roundIdx: r, x, width: NORMAL_COL_W, matchCount, slotH, label: SIDE_ROUND_LABELS[r] });
    x += NORMAL_COL_W;
    if (r < 4) connectors.push({ side: 'left', x, width: GAP_W, fromCount: matchCount, fromSlotH: slotH, straight: false });
    else connectors.push({ side: 'left', x, width: GAP_W, straight: true });
    x += GAP_W;
  }
  matchCols.push({ side: 'center', roundIdx: 5, x, width: CENTER_COL_W, matchCount: 1, slotH: BODY_H, label: 'Final' });
  x += CENTER_COL_W;
  for (let r = 4; r >= 0; r--) {
    const matchCount = 16 / Math.pow(2, r);
    const slotH = SIDE_BASE * Math.pow(2, r);
    if (r < 4) connectors.push({ side: 'right', x, width: GAP_W, fromCount: matchCount, fromSlotH: slotH, straight: false });
    else connectors.push({ side: 'right', x, width: GAP_W, straight: true });
    x += GAP_W;
    matchCols.push({ side: 'right', roundIdx: r, x, width: NORMAL_COL_W, matchCount, slotH, label: SIDE_ROUND_LABELS[r] });
    x += NORMAL_COL_W;
  }

  return { matchCols, connectors };
}

const STAGE_LAYOUT = computeStageLayout();

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function buildRoundsFromParticipants(participants) {
  const rounds = [];
  const round0 = [];
  for (let i = 0; i < participants.length; i += 2) {
    round0.push({ p1: participants[i], p2: participants[i + 1] || null, winner: null, photo: null, durationSeconds: null, violations: '', pengawasName: '' });
  }
  rounds.push(round0);
  let prevCount = round0.length;
  while (prevCount > 1) {
    const nextCount = prevCount / 2;
    const round = [];
    for (let i = 0; i < nextCount; i++) {
      round.push({ p1: null, p2: null, winner: null, photo: null, durationSeconds: null, violations: '', pengawasName: '' });
    }
    rounds.push(round);
    prevCount = nextCount;
  }
  return rounds;
}

function computeRoomNo(id) {
  const session = SESSION_DEFAULT[id] || 1;
  let roomNo = 0;
  for (let i = 1; i <= id; i++) {
    if ((SESSION_DEFAULT[i] || 1) === session) roomNo++;
  }
  return roomNo;
}

function createEmptyRoom(id) {
  const participants = Array.from({ length: PARTICIPANTS_PER_ROOM }, (_, i) => `Peserta R${id}-${i + 1}`);
  const session = SESSION_DEFAULT[id] || 1;
  const roomNo = computeRoomNo(id);
  return {
    id,
    name: `Ruangan ${roomNo}`,
    session,
    roomNo,
    schools: {},
    participants,
    rounds: buildRoundsFromParticipants(participants),
  };
}

function createInitialData() {
  return {
    rooms: Array.from({ length: ROOM_COUNT }, (_, i) => createEmptyRoom(i + 1)),
    finalStage: { matches: [] },
    settings: { showPengawasToPublic: false },
  };
}

// Heals data saved by earlier versions of this app that didn't have roomNo/schools yet,
// so an old Supabase record still displays and behaves correctly after this update.
function normalizeData(raw) {
  if (!raw || !Array.isArray(raw.rooms)) return raw;
  const sessionCounts = {};
  const rooms = raw.rooms.map(room => {
    const session = room.session || 1;
    sessionCounts[session] = (sessionCounts[session] || 0) + 1;
    const roomNo = sessionCounts[session];
    return { ...room, session, roomNo, schools: room.schools || {}, name: `Ruangan ${roomNo}` };
  });
  const finalStage = raw.finalStage && Array.isArray(raw.finalStage.matches) ? raw.finalStage : { matches: [] };
  const settings = { showPengawasToPublic: false, ...(raw.settings || {}) };
  return { ...raw, rooms, finalStage, settings };
}

function formatDuration(totalSeconds) {
  if (totalSeconds == null) return '';
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getRoomChampion(room) {
  const last = room.rounds[room.rounds.length - 1];
  return (last && last[0] && last[0].winner) || null;
}

function getRoomProgress(room) {
  let total = 0, done = 0;
  room.rounds.forEach(r => {
    total += r.length;
    done += r.filter(m => m.winner).length;
  });
  return { done, total };
}

function getCurrentRoundIndex(room) {
  for (let i = 0; i < room.rounds.length; i++) {
    if (room.rounds[i].some(m => !m.winner)) return i;
  }
  return room.rounds.length - 1;
}

function clearMatch(room, roundIdx, matchIdx) {
  const match = room.rounds[roundIdx][matchIdx];
  match.winner = null;
  if (roundIdx + 1 < room.rounds.length) {
    const nextIdx = Math.floor(matchIdx / 2);
    const isFirst = matchIdx % 2 === 0;
    const nextMatch = room.rounds[roundIdx + 1][nextIdx];
    if (isFirst) nextMatch.p1 = null; else nextMatch.p2 = null;
    clearMatch(room, roundIdx + 1, nextIdx);
  }
}

function applyWinner(room, roundIdx, matchIdx, winnerName) {
  const match = room.rounds[roundIdx][matchIdx];
  if (match.winner === winnerName) return;
  match.winner = winnerName;
  if (roundIdx + 1 < room.rounds.length) {
    const nextIdx = Math.floor(matchIdx / 2);
    const isFirst = matchIdx % 2 === 0;
    const nextMatch = room.rounds[roundIdx + 1][nextIdx];
    if (nextMatch.winner) clearMatch(room, roundIdx + 1, nextIdx);
    if (isFirst) nextMatch.p1 = winnerName; else nextMatch.p2 = winnerName;
  }
}

function simulateRoom(room) {
  const next = clone(room);
  for (let r = 0; r < next.rounds.length; r++) {
    for (let m = 0; m < next.rounds[r].length; m++) {
      const match = next.rounds[r][m];
      if (match.p1 && match.p2 && !match.winner) {
        applyWinner(next, r, m, Math.random() < 0.5 ? match.p1 : match.p2);
      }
    }
  }
  return next;
}

function makeFinalMatch(round, p1, p2) {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, round, p1, p2, winner: null, photo: null, durationSeconds: null, violations: '', pengawasName: '' };
}

function getPengawasPin(session, roomNo) {
  return `s${session}r${roomNo}-2026`;
}

const COLUMN_ALIASES = {
  sesi: ['sesi', 'session'],
  ruangan: ['ruangan', 'room'],
  nama: ['nama', 'name', 'peserta'],
  sekolah: ['sekolah', 'school', 'asal sekolah'],
};

function normalizeRow(raw) {
  const keys = Object.keys(raw);
  function find(aliases) {
    const key = keys.find(k => aliases.includes(String(k).trim().toLowerCase()));
    return key !== undefined ? raw[key] : '';
  }
  return {
    sesi: find(COLUMN_ALIASES.sesi),
    ruangan: find(COLUMN_ALIASES.ruangan),
    nama: find(COLUMN_ALIASES.nama),
    sekolah: find(COLUMN_ALIASES.sekolah),
  };
}

async function parseParticipantWorkbook(arrayBuffer) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = wb.SheetNames.includes('Data Peserta') ? 'Data Peserta' : wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function groupRowsByRoom(rawRows) {
  const rooms = {};
  rawRows.forEach(raw => {
    const row = normalizeRow(raw);
    const roomId = Number(row.ruangan);
    const name = String(row.nama || '').trim();
    if (!roomId || roomId < 1 || roomId > ROOM_COUNT) return;
    if (!name) return;
    if (!rooms[roomId]) rooms[roomId] = { session: null, names: [], schools: {} };
    const sesiVal = Number(row.sesi);
    if (!rooms[roomId].session && sesiVal >= 1 && sesiVal <= 4) rooms[roomId].session = sesiVal;
    rooms[roomId].names.push(name);
    const school = String(row.sekolah || '').trim();
    if (school) rooms[roomId].schools[name] = school;
  });
  return rooms;
}

function MatchTicket({ p1, p2, winner, onPick, readOnly, label, onDelete, onOpenDetail, photo, durationSeconds, violations }) {
  const playable = !!(p1 && p2) && !readOnly;
  const hasExtra = !!(photo || violations);
  return (
    <div className="ticket">
      {(label || onDelete || onOpenDetail) && (
        <div className="ticket-top">
          <span className="ticket-label">{label}</span>
          <div className="ticket-top-actions">
            {onOpenDetail && (
              <button type="button" className="ticket-detail-btn" onClick={onOpenDetail} aria-label="Detail pertandingan">
                <Camera size={13} />
                {hasExtra && <span className="detail-dot" />}
              </button>
            )}
            {onDelete && (
              <button type="button" className="ticket-del" onClick={onDelete} aria-label="Hapus pertandingan">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="ticket-body">
        <button
          type="button"
          className={'ticket-slot' + (winner && winner === p1 ? ' win' : '') + (winner && winner !== p1 ? ' lose' : '')}
          disabled={!playable || !p1}
          onClick={() => p1 && onPick(p1)}
        >
          {p1 || 'Menunggu…'}
        </button>
        <div className="ticket-vs"><span>VS</span></div>
        <button
          type="button"
          className={'ticket-slot' + (winner && winner === p2 ? ' win' : '') + (winner && winner !== p2 ? ' lose' : '')}
          disabled={!playable || !p2}
          onClick={() => p2 && onPick(p2)}
        >
          {p2 || 'Menunggu…'}
        </button>
      </div>
      {durationSeconds != null && <div className="ticket-duration">⏱ {formatDuration(durationSeconds)}</div>}
    </div>
  );
}

function MatchDetailModal({ match, canEdit, onClose, onUploadPhoto, onSaveDetails, onResetMatch, title }) {
  const initialTotal = match.durationSeconds != null ? match.durationSeconds : null;
  const [durMin, setDurMin] = useState(initialTotal != null ? Math.floor(initialTotal / 60) : '');
  const [durSec, setDurSec] = useState(initialTotal != null ? initialTotal % 60 : '');
  const [violations, setViolations] = useState(match.violations || '');
  const [uploading, setUploading] = useState(false);

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      await onUploadPhoto(file);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  function handleSave() {
    const total = (durMin === '' && durSec === '') ? null : (Number(durMin || 0) * 60 + Number(durSec || 0));
    onSaveDetails(total, violations);
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      {(match.p1 || match.p2) && (
        <p className="modal-matchup">{match.p1 || 'Menunggu…'} <span>vs</span> {match.p2 || 'Menunggu…'}</p>
      )}

      <label className="field-label">Foto Hasil Pertandingan</label>
      {match.photo ? (
        <img src={match.photo} alt="Foto hasil pertandingan" className="match-photo-preview" />
      ) : (
        <div className="photo-placeholder">Belum ada foto</div>
      )}
      {canEdit && (
        <label className="btn btn-ghost sm upload-label">
          <Camera size={13} /> {uploading ? 'Mengunggah…' : (match.photo ? 'Ganti Foto' : 'Unggah Foto')}
          <input type="file" accept="image/*" capture="environment" onChange={handleFile} disabled={uploading} className="hidden-file-input" />
        </label>
      )}

      <label className="field-label">Durasi Permainan (maks. 10 menit)</label>
      {canEdit ? (
        <div className="duration-picker">
          <select className="text-input" value={durMin} onChange={e => setDurMin(e.target.value)}>
            <option value="">mnt</option>
            {Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i} mnt</option>)}
          </select>
          <select className="text-input" value={durSec} onChange={e => setDurSec(e.target.value)}>
            <option value="">dtk</option>
            {Array.from({ length: 60 }, (_, i) => <option key={i} value={i}>{i} dtk</option>)}
          </select>
        </div>
      ) : (
        <p className="modal-hint">{match.durationSeconds != null ? `${formatDuration(match.durationSeconds)} menit` : 'Belum diisi'}</p>
      )}

      <label className="field-label">Catatan Pelanggaran</label>
      {canEdit ? (
        <textarea className="text-area" rows={3} value={violations} onChange={e => setViolations(e.target.value)} placeholder="Kosongkan kalau tidak ada pelanggaran" />
      ) : (
        <p className="modal-hint">{match.violations ? match.violations : 'Tidak ada catatan'}</p>
      )}

      {canEdit && <button type="button" className="btn btn-gold full" onClick={handleSave}>Simpan Detail</button>}
      {canEdit && match.winner && onResetMatch && (
        <button type="button" className="btn btn-ghost full" onClick={onResetMatch}><RotateCcw size={13} /> Reset Hasil Pertandingan Ini</button>
      )}
    </Modal>
  );
}

function PengawasModal({ match, canEdit, onClose, onSave, title }) {
  const [name, setName] = useState(match.pengawasName || '');

  return (
    <Modal title={title} onClose={onClose}>
      {(match.p1 || match.p2) && (
        <p className="modal-matchup">{match.p1 || 'Menunggu…'} <span>vs</span> {match.p2 || 'Menunggu…'}</p>
      )}
      <label className="field-label">Nama Pengawas</label>
      {canEdit ? (
        <input className="text-input" value={name} onChange={e => setName(e.target.value)} placeholder="Nama pengawas pertandingan ini" autoFocus />
      ) : (
        <p className="modal-hint">{match.pengawasName ? match.pengawasName : 'Belum ditentukan'}</p>
      )}
      {canEdit && <button type="button" className="btn btn-gold full" onClick={() => onSave(name.trim())}>Simpan</button>}
    </Modal>
  );
}

function RoomCard({ room, onOpen }) {
  const champion = getRoomChampion(room);
  const { done, total } = getRoomProgress(room);
  const roundIdx = getCurrentRoundIndex(room);
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <button className="room-card" onClick={onOpen} type="button">
      <div className="room-card-top">
        <span className="room-number">{String(room.roomNo).padStart(2, '0')}</span>
        <span className="session-badge">Sesi {room.session}</span>
      </div>
      <h3 className="room-name">{room.name}</h3>
      {champion ? (
        <div className="room-champion"><Trophy size={15} /><span>{champion}</span></div>
      ) : (
        <div className="room-round">{ROUND_NAMES[roundIdx]}</div>
      )}
      <div className="progress-track"><div className="progress-fill" style={{ width: pct + '%' }} /></div>
      <div className="progress-label">{done}/{total} pertandingan</div>
    </button>
  );
}

function StageBox({ p1, p2, winner, school1, school2, pengawasName, onPick, readOnly, showDetail, showPengawasText, photo, durationSeconds, violations, onOpenDetail, onOpenPengawas, center }) {
  const playable = !!(p1 && p2) && !readOnly;
  const hasExtra = !!(photo || violations);
  const isChampion = center && !!winner;
  return (
    <div className={'sbox' + (center ? ' sbox-center' : '') + (isChampion ? ' sbox-champion' : '')}>
      {isChampion && (
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => <span key={i} />)}
        </div>
      )}
      <button
        type="button"
        className={'sbox-row' + (winner && winner === p1 ? ' win' : '') + (winner && winner !== p1 ? ' lose' : '')}
        disabled={!playable || !p1}
        onClick={() => p1 && onPick(p1)}
      >
        <span className="sbox-name">{p1 || '—'}</span>
        <span className={'sbox-school' + (school1 ? '' : ' placeholder')}>{school1 || 'Nama Sekolah'}</span>
      </button>
      <button
        type="button"
        className={'sbox-row' + (winner && winner === p2 ? ' win' : '') + (winner && winner !== p2 ? ' lose' : '')}
        disabled={!playable || !p2}
        onClick={() => p2 && onPick(p2)}
      >
        <span className="sbox-name">{p2 || '—'}</span>
        <span className={'sbox-school' + (school2 ? '' : ' placeholder')}>{school2 || 'Nama Sekolah'}</span>
      </button>
      {showPengawasText && pengawasName && (
        <div className="sbox-pengawas"><UserCog size={center ? 12 : 8} /> {pengawasName}</div>
      )}
      {showDetail && (
        <div className="sbox-icons">
          {onOpenPengawas && (
            <button type="button" className={'sbox-detail' + (pengawasName ? ' has-data' : '')} onClick={onOpenPengawas} aria-label="Nama pengawas">
              <UserCog size={center ? 13 : 9} />
            </button>
          )}
          <button type="button" className={'sbox-detail' + (hasExtra ? ' has-data' : '')} onClick={onOpenDetail} aria-label="Detail pertandingan">
            <Camera size={center ? 13 : 9} />
          </button>
        </div>
      )}
      {showDetail && durationSeconds != null && <span className="sbox-duration">{formatDuration(durationSeconds)}</span>}
    </div>
  );
}

function ScaledStage({ baseWidth, baseHeight, children }) {
  const outerRef = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    function update() {
      if (!outerRef.current) return;
      const rect = outerRef.current.getBoundingClientRect();
      const s = Math.min(rect.width / baseWidth, rect.height / baseHeight);
      if (s > 0 && isFinite(s)) setScale(s);
    }
    update();
    const ro = new ResizeObserver(update);
    if (outerRef.current) ro.observe(outerRef.current);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, [baseWidth, baseHeight]);

  return (
    <div ref={outerRef} className="stage-outer">
      <div className="stage-canvas" style={{ width: baseWidth, height: baseHeight, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

function MirrorBracketStage({ room, canEdit, showPengawasText, onPick, onOpenDetail, onOpenPengawas }) {
  const { matchCols, connectors } = STAGE_LAYOUT;
  const schools = room.schools || {};

  return (
    <ScaledStage baseWidth={STAGE_W} baseHeight={STAGE_H}>
      <svg className="stage-svg" width={STAGE_W} height={STAGE_H}>
        {connectors.map((c, i) => {
          if (c.straight) {
            const y = HEADER_H + BODY_H / 2;
            return <line key={i} x1={c.x} y1={y} x2={c.x + c.width} y2={y} stroke="#C7B48A" strokeWidth="2" />;
          }
          const d = c.side === 'left'
            ? buildConnectorPath(c.fromCount, c.fromSlotH, c.width)
            : buildConnectorPathMirrored(c.fromCount, c.fromSlotH, c.width);
          return (
            <g key={i} transform={`translate(${c.x}, ${HEADER_H})`}>
              <path d={d} fill="none" stroke="#C7B48A" strokeWidth="2" />
            </g>
          );
        })}
      </svg>

      {matchCols.map(col => (
        <Fragment key={`${col.side}-${col.roundIdx}`}>
          <div className="stage-col-header" style={{ left: col.x, width: col.width }}>{col.label}</div>
          {Array.from({ length: col.matchCount }, (_, localIdx) => {
            let m, absoluteIdx;
            if (col.side === 'center') {
              absoluteIdx = 0;
              m = room.rounds[5][0];
            } else {
              const half = room.rounds[col.roundIdx].length / 2;
              absoluteIdx = col.side === 'left' ? localIdx : half + localIdx;
              m = room.rounds[col.roundIdx][absoluteIdx];
            }
            const boxY = HEADER_H + localIdx * col.slotH + col.slotH / 2;
            return (
              <div key={localIdx} className="stage-box-wrap" style={{ left: col.x, top: boxY, width: col.width }}>
                <StageBox
                  p1={m.p1}
                  p2={m.p2}
                  school1={schools[m.p1]}
                  school2={schools[m.p2]}
                  pengawasName={m.pengawasName}
                  showPengawasText={showPengawasText}
                  winner={m.winner}
                  showDetail={canEdit}
                  photo={m.photo}
                  durationSeconds={m.durationSeconds}
                  violations={m.violations}
                  readOnly={!canEdit}
                  center={col.side === 'center'}
                  onPick={name => onPick(col.roundIdx, absoluteIdx, name)}
                  onOpenDetail={() => onOpenDetail(col.roundIdx, absoluteIdx)}
                  onOpenPengawas={onOpenPengawas ? () => onOpenPengawas(col.roundIdx, absoluteIdx) : undefined}
                />
              </div>
            );
          })}
        </Fragment>
      ))}
    </ScaledStage>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={'modal-panel' + (wide ? ' wide' : '')} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" onClick={onClose} className="modal-close" aria-label="Tutup"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Bungee&family=Inter:wght@400;500;600;700;800&display=swap');
      .lrp-app, .lrp-app * { box-sizing: border-box; }
      .lrp-app {
        min-height: 100vh;
        background: radial-gradient(circle at 50% 0%, #FFEFCE 0%, #FFFBF2 60%);
        color: #2B2013;
        font-family: 'Inter', system-ui, sans-serif;
        padding-bottom: 40px;
      }
      .lrp-header {
        position: sticky; top: 0; z-index: 20;
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 20px;
        background: rgba(255,251,242,0.88);
        backdrop-filter: blur(8px);
        border-bottom: 1px solid #E9DCC0;
      }
      .brand {
        display: flex; align-items: center; gap: 10px; background: none; border: none;
        cursor: pointer; padding: 0; text-align: left; font-family: inherit;
      }
      .brand-mark { font-size: 26px; display: inline-block; animation: mark-bob 3.5s ease-in-out infinite; }
      @keyframes mark-bob { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
      .brand h1 { font-family: 'Bungee', cursive; font-size: 16px; letter-spacing: 0.5px; margin: 0; color: #C28E12; font-weight: 400; }
      .brand p { margin: 0; font-size: 11px; color: #8D8371; }
      .header-actions { display: flex; align-items: center; gap: 10px; }
      .saving-tag { font-size: 11px; color: #8D8371; }
      .save-error-tag {
        font-size: 11px; color: #D6455C; background: rgba(214,69,92,0.1); border: 1px solid #D6455C;
        padding: 4px 10px; border-radius: 999px; cursor: pointer; max-width: 260px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .admin-toggle {
        display: flex; align-items: center; gap: 6px;
        background: #FFFFFF; border: 1px solid #E9DCC0; color: #2B2013;
        padding: 7px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
        transition: border-color .15s, transform .15s;
      }
      .admin-toggle:hover { border-color: #C28E12; transform: translateY(-1px); }
      .lrp-main { max-width: 980px; margin: 0 auto; padding: 20px 16px 0; }
      .view { display: flex; flex-direction: column; gap: 18px; animation: view-in .4s cubic-bezier(.2,.8,.3,1) both; }
      @keyframes view-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      .hero { text-align: center; padding: 18px 12px 4px; }
      .hero-badge {
        display: inline-block; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
        color: #A6790E; background: rgba(194,142,18,0.12); border: 1px solid #D9BE7E;
        padding: 4px 12px; border-radius: 999px; margin-bottom: 10px;
      }
      .hero h2 { font-family: 'Bungee', cursive; font-size: 28px; margin: 0 0 8px; color: #2B2013; font-weight: 400; }
      .hero p { color: #8D8371; font-size: 13px; margin: 0; }
      .landing {
        min-height: calc(100vh - 40px); justify-content: center; align-items: center; text-align: center; gap: 40px;
        padding: 20px 16px;
      }
      .landing-hero { display: flex; flex-direction: column; align-items: center; gap: 12px; }
      .landing-badge {
        font-family: 'Bungee', cursive; font-size: 12px; letter-spacing: 0.06em; color: #A6790E;
        background: rgba(194,142,18,0.12); border: 1px solid #D9BE7E; padding: 6px 16px; border-radius: 999px;
        animation: badge-shimmer 3s ease-in-out infinite;
      }
      @keyframes badge-shimmer { 0%, 100% { box-shadow: 0 0 0 rgba(194,142,18,0); } 50% { box-shadow: 0 0 18px rgba(194,142,18,0.4); } }
      .bunting { display: flex; justify-content: center; gap: 6px; margin-bottom: 4px; }
      .bunting span {
        width: 0; height: 0; border-left: 9px solid transparent; border-right: 9px solid transparent;
        border-top: 15px solid #C28E12; animation: bunting-sway 3s ease-in-out infinite;
        transform-origin: top center;
      }
      .bunting span:nth-child(3n+2) { border-top-color: #D6293F; animation-delay: 0.2s; }
      .bunting span:nth-child(3n) { border-top-color: #2B2013; animation-delay: 0.4s; }
      .bunting span:nth-child(2n) { animation-delay: 0.6s; }
      @keyframes bunting-sway { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
      .landing-title { font-family: 'Bungee', cursive; font-weight: 400; font-size: 34px; color: #2B2013; margin: 0; line-height: 1.25; position: relative; display: inline-block; }
      .sparkle { position: absolute; font-size: 18px; color: #C28E12; animation: sparkle-twinkle 2s ease-in-out infinite; }
      .sparkle-1 { top: -6px; right: -22px; animation-delay: 0s; }
      .sparkle-2 { bottom: -2px; left: -24px; font-size: 13px; animation-delay: 0.7s; }
      @keyframes sparkle-twinkle { 0%, 100% { opacity: 0.3; transform: scale(0.8) rotate(0deg); } 50% { opacity: 1; transform: scale(1.15) rotate(20deg); } }
      .landing-sub { color: #8D8371; font-size: 14px; margin: 0; max-width: 460px; }
      .landing-credit { color: #A69C89; font-size: 11px; margin: 4px 0 0; letter-spacing: 0.02em; }
      .landing-options { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; }
      .landing-card {
        width: 240px; display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center;
        background: #FFFFFF; border: 1px solid #E9DCC0; border-radius: 18px; padding: 28px 22px; color: #2B2013;
        font-family: inherit; cursor: pointer; transition: transform .2s, border-color .2s, box-shadow .2s;
      }
      .landing-card:hover { transform: translateY(-4px) scale(1.02); border-color: #C28E12; box-shadow: 0 12px 30px rgba(194,142,18,0.18); }
      .landing-card svg { color: #C28E12; }
      .landing-card h3 { margin: 0; font-size: 16px; font-family: 'Bungee', cursive; font-weight: 400; }
      .landing-card p { margin: 0; font-size: 12px; color: #8D8371; line-height: 1.5; }
      .landing-card-alt:hover { border-color: #D6293F; box-shadow: 0 12px 30px rgba(214,41,63,0.16); }
      .landing-card-alt svg { color: #D6293F; }
      .login-card {
        max-width: 360px; margin: 40px auto 0; display: flex; flex-direction: column; align-items: center; gap: 10px;
        text-align: center; background: #FFFFFF; border: 1px solid #E9DCC0; border-radius: 18px; padding: 32px 26px;
      }
      .login-card svg { color: #C28E12; }
      .login-card h2 { font-family: 'Bungee', cursive; font-weight: 400; font-size: 18px; margin: 4px 0 0; color: #2B2013; }
      .login-card .text-input { text-align: center; }
      .toolbar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; align-items: center; }
      .pengawas-toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #8D8371; cursor: pointer; }
      .pengawas-toggle input { accent-color: #C28E12; width: 15px; height: 15px; cursor: pointer; }
      .btn {
        display: inline-flex; align-items: center; gap: 6px;
        border-radius: 10px; padding: 9px 14px; font-size: 13px; font-weight: 600;
        cursor: pointer; border: 1px solid transparent; font-family: inherit;
      }
      .btn.sm { padding: 6px 10px; font-size: 12px; }
      .btn.full { width: 100%; justify-content: center; margin-top: 6px; }
      .btn-gold { background: #C28E12; color: #FFFFFF; }
      .btn-gold:hover { background: #A67609; }
      .btn-gold:disabled { opacity: 0.5; cursor: not-allowed; }
      .btn-ghost { background: transparent; border-color: #E9DCC0; color: #2B2013; }
      .btn-ghost:hover { border-color: #C28E12; }
      .btn-crimson { background: #D6293F; color: #FFFFFF; }
      .btn-crimson:hover { background: #B31F32; }
      .session-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; max-width: 900px; margin: 0 auto; width: 100%; }
      .session-card {
        display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center;
        background: #FFFFFF; border: 1px solid #E9DCC0; border-radius: 18px; padding: 26px 16px;
        cursor: pointer; font-family: inherit; transition: transform .15s, border-color .15s, box-shadow .15s;
      }
      .session-card:hover { transform: translateY(-3px) scale(1.02); border-color: #C28E12; box-shadow: 0 10px 26px rgba(194,142,18,0.16); }
      .session-card-label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #A69C89; font-weight: 700; }
      .session-card-number { font-family: 'Bungee', cursive; font-size: 40px; color: #C28E12; line-height: 1.1; }
      .session-card-sub { font-size: 11px; color: #8D8371; margin-top: 4px; }
      .room-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
      .room-card {
        text-align: left; background: #FFFFFF; border: 1px solid #E9DCC0;
        border-radius: 14px; padding: 14px; cursor: pointer; font-family: inherit; color: #2B2013;
        display: flex; flex-direction: column; gap: 8px; transition: border-color .15s, transform .15s;
      }
      .room-card:hover { border-color: #C28E12; transform: translateY(-2px) scale(1.02); }
      .room-card-top { display: flex; justify-content: space-between; align-items: center; }
      .room-number { font-family: 'Bungee', cursive; font-size: 20px; color: #C28E12; font-weight: 400; }
      .session-badge { font-size: 10px; color: #8D8371; border: 1px solid #E9DCC0; padding: 2px 8px; border-radius: 999px; }
      .room-name { margin: 0; font-size: 14px; font-weight: 700; }
      .room-champion { display: flex; align-items: center; gap: 6px; color: #A6790E; font-size: 12px; font-weight: 600; }
      .room-champion span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .room-round { font-size: 12px; color: #8D8371; }
      .progress-track { height: 5px; border-radius: 999px; background: #E9DCC0; overflow: hidden; }
      .progress-fill { height: 100%; background: linear-gradient(90deg, #D6293F, #C28E12); }
      .progress-label { font-size: 10px; color: #8D8371; }
      .final-teaser {
        display: flex; align-items: center; justify-content: space-between; cursor: pointer;
        background: linear-gradient(120deg, #FDE6E9, #FFFFFF);
        border: 1px solid #D9BE7E; border-radius: 14px; padding: 16px 18px; color: #2B2013; font-family: inherit;
      }
      .final-teaser-text h3 { margin: 0 0 4px; display: flex; align-items: center; gap: 8px; font-size: 15px; color: #A6790E; }
      .final-teaser-text p { margin: 0; font-size: 12px; color: #8D8371; }
      .rotate-180 { transform: rotate(180deg); flex-shrink: 0; }
      .back-btn {
        align-self: flex-start; display: flex; align-items: center; gap: 4px;
        background: none; border: none; color: #8D8371; font-size: 13px; cursor: pointer; padding: 4px 0; font-family: inherit;
      }
      .back-btn:hover { color: #A6790E; }
      .room-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .room-header h2 { font-family: 'Bungee', cursive; font-size: 20px; margin: 0 0 4px; color: #2B2013; font-weight: 400; }
      .room-header p { margin: 0; font-size: 12px; color: #8D8371; }
      .room-header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .room-header-actions select {
        background: #FFFFFF; color: #2B2013; border: 1px solid #E9DCC0;
        border-radius: 8px; padding: 6px 8px; font-size: 12px; font-family: inherit;
      }
      .champion-banner {
        display: flex; align-items: center; gap: 10px; background: rgba(194,142,18,0.12);
        border: 1px solid #D9BE7E; color: #A6790E; padding: 12px 16px; border-radius: 12px; font-size: 14px;
      }
      .champion-banner.gold { background: rgba(194,142,18,0.2); font-size: 16px; }
      .stage-outer {
        width: 100%; aspect-ratio: 16 / 9; position: relative; overflow: hidden;
        background: radial-gradient(ellipse at center, #FFF3DC 0%, #FFE9C2 70%);
        border-radius: 16px; border: 1px solid #E9DCC0;
      }
      .stage-canvas { position: absolute; top: 50%; left: 50%; transform-origin: center center; }
      .stage-svg { position: absolute; top: 0; left: 0; pointer-events: none; }
      .stage-col-header {
        position: absolute; top: 0; height: 46px; box-sizing: border-box;
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.02em; color: #A6790E; text-align: center; padding: 0 4px; line-height: 1.15;
      }
      .stage-box-wrap { position: absolute; transform: translateY(-50%); }
      .sbox { width: 100%; background: #FFFFFF; border: 1px solid #E9DCC0; border-radius: 7px; overflow: hidden; position: relative; }
      .sbox-row {
        display: flex; flex-direction: column; width: 100%; text-align: left; background: none; border: none;
        font-family: inherit; padding: 3px 18px 3px 7px; cursor: pointer; gap: 1px;
      }
      .sbox-name {
        color: #2B2013; font-size: 17px; font-weight: 700; line-height: 1.2;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .sbox-school {
        color: #8D8371; font-size: 11px; font-weight: 600; line-height: 1.2; font-style: italic;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .sbox-school.placeholder { opacity: 0.55; }
      .sbox-row:first-of-type { border-bottom: 1px solid #E9DCC0; }
      .sbox-row:disabled { cursor: default; }
      .sbox-row:not(:disabled):hover { background: rgba(194,142,18,0.1); }
      .sbox-row.win .sbox-name { color: #A6790E; }
      .sbox-row.win { background: rgba(194,142,18,0.14); }
      .sbox-row.lose { opacity: 0.4; }
      .sbox-row.lose .sbox-name { text-decoration: line-through; }
      .sbox-icons { position: absolute; top: 3px; right: 3px; display: flex; align-items: center; gap: 5px; }
      .sbox-detail { background: none; border: none; color: #ACA28D; cursor: pointer; padding: 1px; line-height: 0; }
      .sbox-detail.has-data { color: #A6790E; }
      .sbox-duration { position: absolute; bottom: 2px; right: 4px; font-size: 8px; color: #ACA28D; }
      .sbox-pengawas {
        display: flex; align-items: center; gap: 3px; font-size: 9px; color: #8D8371;
        padding: 4px 18px 4px 7px; border-top: 1px solid #E9DCC0;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .sbox-center .sbox-pengawas { font-size: 12px; padding: 6px 30px 6px 14px; }
      .sbox-center { border-color: #D9BE7E; border-width: 2px; }
      .sbox-center .sbox-name { font-size: 22px; }
      .sbox-center .sbox-school { font-size: 14px; }
      .sbox-center .sbox-row { padding: 8px 30px 8px 14px; }
      .sbox-center .sbox-icons { top: 8px; right: 8px; gap: 8px; }
      .sbox-champion { animation: champion-glow 2.2s ease-in-out infinite; }
      @keyframes champion-glow {
        0%, 100% { box-shadow: 0 0 14px rgba(194,142,18,0.4); }
        50% { box-shadow: 0 0 32px rgba(194,142,18,0.8); }
      }
      .confetti { position: absolute; inset: 0; overflow: hidden; pointer-events: none; border-radius: inherit; z-index: 1; }
      .confetti span { position: absolute; top: -12px; width: 5px; height: 9px; opacity: 0; animation: confetti-fall 2.8s ease-in infinite; }
      .confetti span:nth-child(1) { left: 6%; background: #C28E12; animation-delay: 0s; }
      .confetti span:nth-child(2) { left: 18%; background: #D6293F; animation-delay: 0.35s; }
      .confetti span:nth-child(3) { left: 30%; background: #FFFFFF; animation-delay: 0.7s; border: 1px solid #E9DCC0; }
      .confetti span:nth-child(4) { left: 44%; background: #C28E12; animation-delay: 1.05s; }
      .confetti span:nth-child(5) { left: 58%; background: #D6293F; animation-delay: 0.2s; }
      .confetti span:nth-child(6) { left: 70%; background: #FFFFFF; animation-delay: 0.55s; border: 1px solid #E9DCC0; }
      .confetti span:nth-child(7) { left: 84%; background: #C28E12; animation-delay: 0.9s; }
      .confetti span:nth-child(8) { left: 94%; background: #D6293F; animation-delay: 1.25s; }
      @keyframes confetti-fall {
        0% { transform: translateY(-12px) rotate(0deg); opacity: 1; }
        100% { transform: translateY(160px) rotate(340deg); opacity: 0; }
      }
      .modal-matchup { text-align: center; font-size: 13px; font-weight: 700; color: #2B2013; margin: 0 0 6px; }
      .modal-matchup span { color: #A6790E; font-weight: 600; margin: 0 6px; font-size: 11px; }
      .match-manage-list { display: flex; flex-direction: column; gap: 12px; max-height: 65vh; overflow-y: auto; padding-right: 2px; }
      .match-manage-card {
        background: #FFFFFF; border: 1px solid #E9DCC0; border-radius: 12px; padding: 12px;
        display: flex; flex-direction: column; gap: 6px;
      }
      .match-manage-title { font-size: 11px; font-weight: 700; color: #A6790E; text-transform: uppercase; letter-spacing: 0.03em; }
      .match-manage-pair { display: flex; gap: 8px; }
      .match-manage-pair .text-input { padding: 8px 10px; font-size: 12px; }
      .match-manage-vs { text-align: center; font-size: 10px; color: #A69C89; font-weight: 700; }
      .match-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
      .ticket {
        position: relative; background: #FFFFFF; border: 1px solid #E9DCC0;
        border-radius: 12px; padding: 10px;
      }
      .ticket-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; padding: 0 2px; }
      .ticket-label { font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: #A6790E; font-weight: 700; }
      .ticket-top-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
      .ticket-detail-btn { position: relative; background: none; border: none; color: #8D8371; cursor: pointer; padding: 2px; display: flex; }
      .ticket-detail-btn:hover { color: #A6790E; }
      .detail-dot { position: absolute; top: -2px; right: -3px; width: 7px; height: 7px; border-radius: 50%; background: #D6293F; border: 1.5px solid #FFFFFF; }
      .ticket-del { background: none; border: none; color: #8D8371; cursor: pointer; padding: 2px; }
      .ticket-del:hover { color: #D6293F; }
      .ticket-duration { margin-top: 6px; font-size: 10px; color: #8D8371; text-align: center; }
      .match-photo-preview { width: 100%; max-height: 220px; object-fit: cover; border-radius: 10px; margin-bottom: 8px; display: block; }
      .photo-placeholder { width: 100%; padding: 22px 10px; text-align: center; border: 1px dashed #E9DCC0; border-radius: 10px; color: #8D8371; font-size: 12px; margin-bottom: 8px; }
      .hidden-file-input { display: none; }
      .upload-label { cursor: pointer; margin-bottom: 4px; }
      .template-link { color: #A6790E; text-decoration: underline; }
      .modal-divider { text-align: center; font-size: 11px; color: #8D8371; margin: 10px 0; position: relative; }
      .modal-divider::before, .modal-divider::after { content: ''; position: absolute; top: 50%; width: 40%; height: 1px; background: #E9DCC0; }
      .modal-divider::before { left: 0; }
      .modal-divider::after { right: 0; }
      .import-preview { display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto; margin: 4px 0; }
      .import-preview-row {
        display: flex; justify-content: space-between; font-size: 11px; padding: 6px 10px;
        border-radius: 6px; background: #FFFFFF; border: 1px solid #E9DCC0; color: #8D8371;
      }
      .import-preview-row.ok { border-color: #2F7A45; color: #2B2013; }
      .import-preview-row.warn { border-color: #D9BE7E; color: #A6790E; }
      .import-preview-row.missing { opacity: 0.5; }
      .ticket-body { display: flex; align-items: center; gap: 8px; }
      .ticket-slot {
        flex: 1; min-width: 0; background: #FFF8EA; border: 1px solid #E9DCC0; color: #2B2013;
        padding: 10px 8px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center;
      }
      .ticket-slot:disabled { cursor: default; opacity: 0.55; }
      .ticket-slot:not(:disabled):hover { border-color: #C28E12; }
      .ticket-slot.win { background: rgba(194,142,18,0.16); border-color: #C28E12; color: #A6790E; }
      .ticket-slot.lose { opacity: 0.4; text-decoration: line-through; }
      .ticket-vs {
        flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; background: #D6293F;
        display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 800; color: #FFFFFF;
      }
      .qualifier-strip { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
      .qualifier-chip {
        flex-shrink: 0; min-width: 140px; background: #FFFFFF; border: 1px solid #E9DCC0;
        border-radius: 10px; padding: 8px 12px; display: flex; flex-direction: column; gap: 2px;
      }
      .qualifier-chip.ready { border-color: #D9BE7E; }
      .qualifier-room { font-size: 10px; color: #8D8371; }
      .qualifier-name { font-size: 12px; font-weight: 700; color: #2B2013; }
      .qualifier-chip.ready .qualifier-name { color: #A6790E; }
      .empty-state { text-align: center; padding: 30px 16px; color: #8D8371; font-size: 13px; }
      .empty-state p { margin: 4px 0; }
      .modal-overlay {
        position: fixed; inset: 0; background: rgba(43,32,19,0.45); backdrop-filter: blur(3px);
        display: flex; align-items: center; justify-content: center; z-index: 50; padding: 16px;
      }
      .modal-panel { background: #FFFFFF; border: 1px solid #E9DCC0; border-radius: 16px; width: 100%; max-width: 380px; max-height: 88vh; overflow-y: auto; }
      .modal-panel.wide { max-width: 520px; }
      .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid #E9DCC0; }
      .modal-header h3 { margin: 0; font-size: 15px; color: #2B2013; font-family: 'Bungee', cursive; font-weight: 400; }
      .modal-close { background: none; border: none; color: #8D8371; cursor: pointer; }
      .modal-body { padding: 18px; display: flex; flex-direction: column; gap: 10px; }
      .modal-hint { font-size: 12px; color: #8D8371; margin: 0; line-height: 1.5; }
      .text-input, .text-area {
        width: 100%; background: #FFFBF2; border: 1px solid #E9DCC0; color: #2B2013;
        border-radius: 8px; padding: 10px 12px; font-size: 13px; font-family: inherit;
      }
      .text-area { resize: vertical; }
      .text-input:focus, .text-area:focus { outline: none; border-color: #C28E12; }
      .error-text { color: #D6455C; font-size: 12px; margin: 0; }
      .field-label { font-size: 11px; color: #8D8371; font-weight: 600; margin-top: 4px; }
      .duration-picker { display: flex; gap: 8px; }
      .duration-picker select { flex: 1; }
      .pengawas-name-input { width: 180px; }
      .round-quick { display: flex; gap: 6px; }
      .chip-btn {
        background: #FFFFFF; border: 1px solid #E9DCC0; color: #2B2013;
        padding: 6px 12px; border-radius: 999px; font-size: 12px; cursor: pointer; font-family: inherit;
      }
      .chip-btn.active { border-color: #C28E12; color: #A6790E; background: rgba(194,142,18,0.12); }
      .confirm-actions { display: flex; gap: 10px; margin-top: 6px; }
      .confirm-actions .btn { flex: 1; justify-content: center; }
      .loading-state {
        min-height: 60vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 10px; color: #8D8371; font-size: 13px;
      }
      .loading-mark { font-size: 36px; animation: loading-bounce 1s ease-in-out infinite; }
      @keyframes loading-bounce { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-8px) scale(1.08); } }
      .spin { animation: lrp-spin 1s linear infinite; }
      @keyframes lrp-spin { to { transform: rotate(360deg); } }
      @media (max-width: 480px) {
        .hero h2 { font-size: 22px; }
        .ticket-body { flex-direction: column; }
        .ticket-vs { width: 26px; height: 26px; }
        .bracket-scroll { max-height: 62vh; padding: 12px; }
        .session-grid { gap: 8px; }
        .session-card { padding: 16px 6px; }
        .session-card-number { font-size: 28px; }
        .session-card-sub { font-size: 9px; }
      }
    `}</style>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [view, setView] = useState('landing');
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [activeSession, setActiveSession] = useState(null);

  const [role, setRole] = useState('public'); // 'public' | 'pengawas' | 'admin'
  const [pengawasRoomId, setPengawasRoomId] = useState(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [saveError, setSaveError] = useState('');
  const sessionRestoreAttempted = useRef(false);

  const [detailTarget, setDetailTarget] = useState(null); // { scope: 'room', roomId, roundIdx, matchIdx } | { scope: 'final', matchId }
  const [pengawasTarget, setPengawasTarget] = useState(null); // same shape as detailTarget

  const [bulkTarget, setBulkTarget] = useState(null);
  const [draftParticipants, setDraftParticipants] = useState(null);
  const [draftPengawasNames, setDraftPengawasNames] = useState(null);
  const [bulkText, setBulkText] = useState('');
  const [importFileRows, setImportFileRows] = useState(null);
  const [importFileError, setImportFileError] = useState('');

  const [showNewMatch, setShowNewMatch] = useState(false);
  const [newRound, setNewRound] = useState('Semifinal');
  const [newP1, setNewP1] = useState('');
  const [newP2, setNewP2] = useState('');

  const [confirmState, setConfirmState] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let loaded = null;
      try {
        const { data: row, error } = await supabase.from('tournament_state').select('data').eq('id', 1).single();
        if (error) throw error;
        if (row && row.data && Object.keys(row.data).length > 0) loaded = row.data;
      } catch (e) {
        loaded = null;
      }
      if (!alive) return;
      if (loaded) {
        const normalized = normalizeData(loaded);
        setData(normalized);
        setLoading(false);
      } else {
        const initial = createInitialData();
        setData(initial);
        setLoading(false);
        try { await supabase.from('tournament_state').upsert({ id: 1, data: initial }); } catch (e) {}
      }
    })();
    return () => { alive = false; };
  }, []);

  // Lock pengawas to their own room: if they ever land on the dashboard (all-rooms list),
  // bounce them straight back to their assigned room. Admin and public are unaffected.
  useEffect(() => {
    if (role === 'pengawas' && (view === 'dashboard' || view === 'session')) {
      setView('room');
      setActiveRoomId(pengawasRoomId);
    }
  }, [role, view, pengawasRoomId]);

  // Restore a real Supabase Auth session (admin/pengawas staying logged in across
  // refreshes), once tournament data is available so a pengawas's session+roomNo
  // can be resolved to an actual room id. Runs only once.
  useEffect(() => {
    if (!data || sessionRestoreAttempted.current) return;
    sessionRestoreAttempted.current = true;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData && sessionData.session;
        if (!session) return;
        const meta = session.user.app_metadata || {};
        if (meta.role === 'admin') {
          setRole('admin');
        } else if (meta.role === 'pengawas') {
          const room = data.rooms.find(r => r.session === meta.session && r.roomNo === meta.roomNo);
          if (room) {
            setRole('pengawas');
            setPengawasRoomId(room.id);
            setActiveRoomId(room.id);
            if (view === 'landing') setView('room');
          }
        }
      } catch (e) {
        // no valid session to restore; stay public
      }
    })();
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live sync: reflect changes made by other admins/devices instantly, no refresh needed
  useEffect(() => {
    const channel = supabase
      .channel('tournament_state_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tournament_state', filter: 'id=eq.1' }, payload => {
        if (payload.new && payload.new.data) setData(normalizeData(payload.new.data));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function persist(newData) {
    const previous = data;
    setData(newData);
    setSaving(true);
    setSaveError('');
    try {
      const { data: fnData, error } = await supabase.functions.invoke('update-match', { body: { newData } });
      if (error || !fnData || fnData.ok !== true) {
        const message = (fnData && fnData.error) || (error && error.message) || 'Gagal menyimpan perubahan.';
        setSaveError(message);
        setData(previous); // roll back the optimistic update since the write was rejected
      }
    } catch (e) {
      setSaveError('Gagal menyimpan: koneksi bermasalah atau sesi berakhir. Coba login ulang.');
      setData(previous);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !data) {
    return (
      <div className="lrp-app">
        <GlobalStyle />
        <div className="loading-state"><span className="loading-mark">🎪</span><span>Memuat data turnamen…</span></div>
      </div>
    );
  }

  const activeRoom = data.rooms.find(r => r.id === activeRoomId) || null;
  const isAdmin = role === 'admin';
  function canEditRoom(roomId) {
    return role === 'admin' || (role === 'pengawas' && pengawasRoomId === roomId);
  }

  const qualifiers = data.rooms
    .filter(r => getRoomChampion(r))
    .map(r => ({ room: r, name: getRoomChampion(r), display: `${getRoomChampion(r)} (${r.name})` }));

  const finalPoolSet = new Set([
    ...qualifiers.map(q => q.display),
    ...data.finalStage.matches.map(m => m.winner).filter(Boolean),
  ]);
  const finalPool = Array.from(finalPoolSet);

  const champion = (() => {
    const finalMatch = [...data.finalStage.matches].reverse().find(m => m.round.trim().toLowerCase() === 'final' && m.winner);
    return finalMatch ? finalMatch.winner : null;
  })();

  function openRoom(room) {
    setActiveRoomId(room.id);
    setActiveSession(room.session);
    setView('room');
  }

  function openSession(session) {
    setActiveSession(session);
    setView('session');
  }

  function handlePick(roundIdx, matchIdx, winnerName) {
    if (!activeRoom || !canEditRoom(activeRoom.id)) return;
    const next = clone(data);
    const room = next.rooms.find(r => r.id === activeRoom.id);
    applyWinner(room, roundIdx, matchIdx, winnerName);
    persist(next);
  }

  function handleSimulate() {
    if (!activeRoom) return;
    const next = clone(data);
    const idx = next.rooms.findIndex(r => r.id === activeRoom.id);
    next.rooms[idx] = simulateRoom(next.rooms[idx]);
    persist(next);
  }

  async function handleLogin() {
    const email = loginEmail.trim();
    const password = loginPassword;
    if (!email || !password) {
      setLoginError(true);
      return;
    }
    setAuthLoading(true);
    const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password });
    setAuthLoading(false);
    if (error || !signInData || !signInData.session) {
      setLoginError(true);
      return;
    }
    const meta = signInData.session.user.app_metadata || {};
    if (meta.role === 'admin') {
      setRole('admin');
      setPengawasRoomId(null);
      setView('dashboard');
    } else if (meta.role === 'pengawas') {
      const target = data.rooms.find(r => r.session === meta.session && r.roomNo === meta.roomNo);
      if (!target) {
        setLoginError(true);
        await supabase.auth.signOut();
        return;
      }
      setRole('pengawas');
      setPengawasRoomId(target.id);
      setActiveRoomId(target.id);
      setView('room');
    } else {
      setLoginError(true);
      await supabase.auth.signOut();
      return;
    }
    setLoginEmail('');
    setLoginPassword('');
    setLoginError(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut({ scope: 'local' });
    setRole('public');
    setPengawasRoomId(null);
    setView('landing');
  }

  function getDetailMatch() {
    if (!detailTarget) return null;
    if (detailTarget.scope === 'room') {
      const room = data.rooms.find(r => r.id === detailTarget.roomId);
      return room ? room.rounds[detailTarget.roundIdx][detailTarget.matchIdx] : null;
    }
    return data.finalStage.matches.find(m => m.id === detailTarget.matchId) || null;
  }

  function getPengawasMatch() {
    if (!pengawasTarget) return null;
    if (pengawasTarget.scope === 'room') {
      const room = data.rooms.find(r => r.id === pengawasTarget.roomId);
      return room ? room.rounds[pengawasTarget.roundIdx][pengawasTarget.matchIdx] : null;
    }
    return data.finalStage.matches.find(m => m.id === pengawasTarget.matchId) || null;
  }

  function detailCanEdit() {
    if (!detailTarget) return false;
    if (detailTarget.scope === 'room') return canEditRoom(detailTarget.roomId);
    return isAdmin;
  }

  async function handleUploadPhoto(file) {
    if (!detailTarget) return;
    const folder = detailTarget.scope === 'room' ? `ruangan-${detailTarget.roomId}` : 'babak-lanjutan';
    const path = `${folder}/${Date.now()}-${file.name}`;
    try {
      const { error: upErr } = await supabase.storage.from('match-photos').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('match-photos').getPublicUrl(path);
      const next = clone(data);
      if (detailTarget.scope === 'room') {
        const room = next.rooms.find(r => r.id === detailTarget.roomId);
        room.rounds[detailTarget.roundIdx][detailTarget.matchIdx].photo = urlData.publicUrl;
      } else {
        const m = next.finalStage.matches.find(mm => mm.id === detailTarget.matchId);
        m.photo = urlData.publicUrl;
      }
      persist(next);
    } catch (e) {
      console.error('Gagal mengunggah foto', e);
    }
  }

  function handleSaveDetails(durationSeconds, violations) {
    if (!detailTarget) return;
    const next = clone(data);
    let match;
    if (detailTarget.scope === 'room') {
      const room = next.rooms.find(r => r.id === detailTarget.roomId);
      match = room.rounds[detailTarget.roundIdx][detailTarget.matchIdx];
    } else {
      match = next.finalStage.matches.find(mm => mm.id === detailTarget.matchId);
    }
    match.durationSeconds = durationSeconds;
    match.violations = violations;
    persist(next);
    setDetailTarget(null);
  }

  function doBulkImport() {
    const names = bulkText.split('\n').map(s => s.trim()).filter(Boolean);
    const run = () => {
      const next = clone(data);
      if (bulkTarget === 'global') {
        for (let r = 0; r < ROOM_COUNT; r++) {
          const slice = names.slice(r * 64, r * 64 + 64);
          const participants = Array.from({ length: 64 }, (_, i) => slice[i] || `Peserta R${r + 1}-${i + 1}`);
          next.rooms[r].participants = participants;
          next.rooms[r].rounds = buildRoundsFromParticipants(participants);
        }
      } else {
        const idx = next.rooms.findIndex(r => r.id === bulkTarget);
        const participants = Array.from({ length: 64 }, (_, i) => names[i] || `Peserta R${bulkTarget}-${i + 1}`);
        next.rooms[idx].participants = participants;
        next.rooms[idx].rounds = buildRoundsFromParticipants(participants);
      }
      persist(next);
      setBulkTarget(null);
      setBulkText('');
      setConfirmState(null);
    };
    const targets = bulkTarget === 'global' ? data.rooms : data.rooms.filter(r => r.id === bulkTarget);
    const hasProgress = targets.some(r => r.rounds.some(rd => rd.some(m => m.winner)));
    if (hasProgress) {
      setConfirmState({
        message: 'Ruangan tujuan sudah memiliki hasil pertandingan. Impor akan menghapus progres tersebut. Lanjutkan?',
        onConfirm: run,
      });
    } else {
      run();
    }
  }

  async function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setImportFileError('');
    setImportFileRows(null);
    try {
      const buf = await file.arrayBuffer();
      const rawRows = await parseParticipantWorkbook(buf);
      const grouped = groupRowsByRoom(rawRows);
      if (Object.keys(grouped).length === 0) {
        setImportFileError('Tidak ada data yang terbaca. Pastikan file punya kolom "sesi", "ruangan", dan "nama" yang terisi.');
        return;
      }
      setImportFileRows(grouped);
    } catch (err) {
      console.error(err);
      setImportFileError('Gagal membaca file. Pastikan formatnya .xlsx, .xls, atau .csv.');
    } finally {
      e.target.value = '';
    }
  }

  function applyImportFile() {
    if (!importFileRows) return;
    const roomIds = Object.keys(importFileRows).map(Number);
    const run = () => {
      const next = clone(data);
      roomIds.forEach(roomId => {
        const group = importFileRows[roomId];
        const idx = next.rooms.findIndex(r => r.id === roomId);
        if (idx === -1) return;
        const names = group.names.slice(0, 64);
        const participants = Array.from({ length: 64 }, (_, i) => names[i] || `Peserta R${roomId}-${i + 1}`);
        next.rooms[idx].participants = participants;
        next.rooms[idx].rounds = buildRoundsFromParticipants(participants);
        if (group.session) next.rooms[idx].session = group.session;
        if (group.schools && Object.keys(group.schools).length > 0) {
          next.rooms[idx].schools = { ...(next.rooms[idx].schools || {}), ...group.schools };
        }
      });
      persist(next);
      setBulkTarget(null);
      setImportFileRows(null);
      setConfirmState(null);
    };
    const targets = data.rooms.filter(r => roomIds.includes(r.id));
    const hasProgress = targets.some(r => r.rounds.some(rd => rd.some(m => m.winner)));
    if (hasProgress) {
      setConfirmState({
        message: 'Beberapa ruangan tujuan sudah memiliki hasil pertandingan. Impor akan menghapus progres tersebut. Lanjutkan?',
        onConfirm: run,
      });
    } else {
      run();
    }
  }

  function createFinalMatch() {
    if (!newP1 || !newP2 || newP1 === newP2) return;
    const next = clone(data);
    next.finalStage.matches.push(makeFinalMatch(newRound.trim() || 'Semifinal', newP1, newP2));
    persist(next);
    setShowNewMatch(false);
    setNewP1('');
    setNewP2('');
    setNewRound('Semifinal');
  }

  function pickFinalWinner(matchId, winnerName) {
    if (!isAdmin) return;
    const next = clone(data);
    const match = next.finalStage.matches.find(m => m.id === matchId);
    match.winner = winnerName;
    persist(next);
  }

  function deleteFinalMatch(matchId) {
    const next = clone(data);
    next.finalStage.matches = next.finalStage.matches.filter(m => m.id !== matchId);
    persist(next);
  }

  function requestResetRoom() {
    if (!activeRoom) return;
    setConfirmState({
      message: `Semua peserta & hasil pertandingan di ${activeRoom.name} (Sesi ${activeRoom.session}) akan dihapus dan diatur ulang. Ruangan lain tidak terpengaruh. Yakin?`,
      onConfirm: () => {
        const next = clone(data);
        const idx = next.rooms.findIndex(r => r.id === activeRoom.id);
        next.rooms[idx] = createEmptyRoom(activeRoom.id);
        persist(next);
        setConfirmState(null);
      },
    });
  }

  function requestResetMatch(scope, roomId, roundIdx, matchIdx, finalMatchId) {
    setConfirmState({
      message: 'Hasil pertandingan ini akan dihapus (termasuk hasil babak setelahnya yang berasal dari sini, kalau ada). Yakin?',
      onConfirm: () => {
        const next = clone(data);
        if (scope === 'room') {
          const room = next.rooms.find(r => r.id === roomId);
          clearMatch(room, roundIdx, matchIdx);
        } else {
          const m = next.finalStage.matches.find(mm => mm.id === finalMatchId);
          if (m) m.winner = null;
        }
        persist(next);
        setConfirmState(null);
        setDetailTarget(null);
      },
    });
  }

  function openManageParticipants() {
    if (!activeRoom) return;
    setDraftParticipants(activeRoom.participants.map(n => ({ name: n, school: (activeRoom.schools && activeRoom.schools[n]) || '' })));
    setDraftPengawasNames(activeRoom.rounds[0].map(m => m.pengawasName || ''));
    setView('manage');
  }

  function saveManageChanges() {
    if (!draftParticipants || !activeRoom) return;
    const next = clone(data);
    const room = next.rooms.find(r => r.id === activeRoom.id);
    const oldNames = room.participants.slice();
    const newSchools = {};
    draftParticipants.forEach((p, i) => {
      const newName = (p.name || '').trim() || `Peserta R${room.id}-${i + 1}`;
      const oldName = oldNames[i];
      if (oldName !== newName) {
        room.participants[i] = newName;
        room.rounds.forEach(round => round.forEach(m => {
          if (m.p1 === oldName) m.p1 = newName;
          if (m.p2 === oldName) m.p2 = newName;
          if (m.winner === oldName) m.winner = newName;
        }));
      }
      if (p.school && p.school.trim()) newSchools[newName] = p.school.trim();
    });
    room.schools = newSchools;
    if (draftPengawasNames) {
      draftPengawasNames.forEach((name, i) => {
        if (room.rounds[0][i]) room.rounds[0][i].pengawasName = (name || '').trim();
      });
    }
    persist(next);
    setDraftParticipants(null);
    setDraftPengawasNames(null);
    setView('room');
  }

  function updateSession(roomId, session) {
    const next = clone(data);
    const room = next.rooms.find(r => r.id === roomId);
    room.session = Number(session);
    persist(next);
  }

  function toggleShowPengawasToPublic(value) {
    const next = clone(data);
    next.settings = { ...(next.settings || {}), showPengawasToPublic: value };
    persist(next);
  }

  function savePengawasName(name) {
    if (!pengawasTarget) return;
    const next = clone(data);
    let match;
    if (pengawasTarget.scope === 'room') {
      const room = next.rooms.find(r => r.id === pengawasTarget.roomId);
      match = room.rounds[pengawasTarget.roundIdx][pengawasTarget.matchIdx];
    } else {
      match = next.finalStage.matches.find(mm => mm.id === pengawasTarget.matchId);
    }
    match.pengawasName = name;
    persist(next);
    setPengawasTarget(null);
  }

  function renderLanding() {
    return (
      <div className="view landing">
        <div className="bunting" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => <span key={i} />)}
        </div>
        <div className="landing-hero">
          <div className="landing-badge">🎪 MCR &amp; LRP 2026</div>
          <h1 className="landing-title">Selamat Datang di LRP 2026<span className="sparkle sparkle-1">✦</span><span className="sparkle sparkle-2">✦</span></h1>
          <p className="landing-sub">640 peserta &middot; 10 ruangan &middot; 4 sesi &middot; satu panggung juara</p>
          <p className="landing-credit">HIMAPSTIKA &amp; HIMADIKMA · Universitas Negeri Surabaya</p>
        </div>
        <div className="landing-options">
          <button type="button" className="landing-card" onClick={() => setView('dashboard')}>
            <Trophy size={30} />
            <h3>Lihat Bracket</h3>
            <p>Pantau hasil pertandingan tiap ruangan secara langsung — untuk peserta &amp; wali murid.</p>
          </button>
          <button type="button" className="landing-card landing-card-alt" onClick={() => setView('login')}>
            <Lock size={30} />
            <h3>Login Panitia</h3>
            <p>Untuk pengawas ruangan &amp; admin — kelola hasil pertandingan dan data peserta.</p>
          </button>
        </div>
      </div>
    );
  }

  function renderLogin() {
    return (
      <div className="view">
        <button type="button" className="back-btn" onClick={() => setView('landing')}><ChevronLeft size={16} /> Kembali</button>
        <div className="login-card">
          <Lock size={26} />
          <h2>Login Panitia</h2>
          <p className="modal-hint">
            Admin: <strong>admin@lrp2026.internal</strong>, password <strong>lrp2026</strong>.<br />
            Pengawas: <strong>s{'{sesi}'}r{'{ruangan}'}@lrp2026.internal</strong>, contoh <strong>s1r1@lrp2026.internal</strong> untuk Sesi 1 Ruangan 1 — password sama dengan kode ruangannya (<strong>s1r1-2026</strong>).<br />
            Ini persis akun yang dibuat lewat <code>setup-auth-users.mjs</code>.
          </p>
          <input
            type="email"
            value={loginEmail}
            onChange={e => { setLoginEmail(e.target.value); setLoginError(false); }}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            className="text-input"
            placeholder="Email"
            autoFocus
          />
          <input
            type="password"
            value={loginPassword}
            onChange={e => { setLoginPassword(e.target.value); setLoginError(false); }}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            className="text-input"
            placeholder="Password"
          />
          {loginError && <p className="error-text">Email atau password salah, coba lagi.</p>}
          <button type="button" className="btn btn-gold full" onClick={handleLogin} disabled={authLoading}>
            {authLoading ? 'Memeriksa…' : 'Masuk'}
          </button>
        </div>
      </div>
    );
  }

  function renderDashboard() {
    const doneRooms = qualifiers.length;
    const sessions = [1, 2, 3, 4];
    return (
      <div className="view">
        <button type="button" className="back-btn" onClick={() => setView('landing')}><ChevronLeft size={16} /> Beranda</button>

        <section className="hero">
          <div className="hero-badge">🎪 Turnamen 1 Lawan 1</div>
          <h2>LRP Bracket 2026</h2>
          <p>640 peserta &middot; 10 ruangan &middot; 4 sesi &middot; setiap ruangan menghasilkan 1 juara ke babak lanjutan</p>
        </section>

        {isAdmin && (
          <div className="toolbar">
            <button type="button" className="btn btn-gold" onClick={() => setBulkTarget('global')}><Upload size={15} /> Impor 640 Peserta</button>
            <label className="pengawas-toggle">
              <input
                type="checkbox"
                checked={!!(data.settings && data.settings.showPengawasToPublic)}
                onChange={e => toggleShowPengawasToPublic(e.target.checked)}
              />
              Tampilkan nama pengawas ke publik
            </label>
          </div>
        )}

        <div className="session-grid">
          {sessions.map(s => {
            const roomsInSession = data.rooms.filter(r => r.session === s);
            const doneInSession = roomsInSession.filter(r => getRoomChampion(r)).length;
            return (
              <button key={s} type="button" className="session-card" onClick={() => openSession(s)}>
                <span className="session-card-label">Sesi</span>
                <span className="session-card-number">{s}</span>
                <span className="session-card-sub">{roomsInSession.length} ruangan &middot; {doneInSession}/{roomsInSession.length} juara</span>
              </button>
            );
          })}
        </div>

        <section className="final-teaser" onClick={() => setView('final')}>
          <div className="final-teaser-text">
            <h3><Trophy size={18} /> Babak Lanjutan</h3>
            <p>{doneRooms}/10 ruangan sudah punya juara{champion ? ` · Juara Umum: ${champion}` : ''}</p>
          </div>
          <ChevronLeft size={18} className="rotate-180" />
        </section>
      </div>
    );
  }

  function renderSessionRooms() {
    const roomsInSession = data.rooms.filter(r => r.session === activeSession);
    return (
      <div className="view">
        <button type="button" className="back-btn" onClick={() => setView('dashboard')}><ChevronLeft size={16} /> Semua Sesi</button>
        <section className="hero">
          <div className="hero-badge">Sesi {activeSession}</div>
          <h2>Ruangan Sesi {activeSession}</h2>
          <p>{roomsInSession.length} ruangan berlangsung di sesi ini</p>
        </section>
        <div className="room-grid">
          {roomsInSession.map(room => (
            <RoomCard key={room.id} room={room} onOpen={() => openRoom(room)} />
          ))}
        </div>
      </div>
    );
  }

  function renderRoom() {
    if (!activeRoom) return null;
    const champ = getRoomChampion(activeRoom);
    const canEdit = canEditRoom(activeRoom.id);
    return (
      <div className="view">
        {role !== 'pengawas' && (
          <button type="button" className="back-btn" onClick={() => setView('session')}><ChevronLeft size={16} /> Ruangan Sesi {activeRoom.session}</button>
        )}

        <div className="room-header">
          <div>
            <h2>{activeRoom.name}</h2>
            <p>
              Sesi {activeRoom.session} &middot; 64 peserta
              {role === 'pengawas' && pengawasRoomId === activeRoom.id ? ' · kamu masuk sebagai pengawas ruangan ini' : ''}
            </p>
          </div>
          {isAdmin && (
            <div className="room-header-actions">
              <select value={activeRoom.session} onChange={e => updateSession(activeRoom.id, e.target.value)}>
                {[1, 2, 3, 4].map(s => <option key={s} value={s}>Sesi {s}</option>)}
              </select>
              <button type="button" className="btn btn-ghost sm" onClick={openManageParticipants}><Plus size={13} /> Kelola Peserta</button>
              <button type="button" className="btn btn-ghost sm" onClick={() => setBulkTarget(activeRoom.id)}><Upload size={13} /> Impor</button>
              <button type="button" className="btn btn-ghost sm" onClick={handleSimulate}><Shuffle size={13} /> Simulasikan</button>
              <button type="button" className="btn btn-ghost sm" onClick={requestResetRoom}><RotateCcw size={13} /> Reset Ruangan</button>
            </div>
          )}
        </div>

        {champ && (
          <div className="champion-banner">🥇 Juara Ruangan: <strong>{champ}</strong></div>
        )}

        <MirrorBracketStage
          room={activeRoom}
          canEdit={canEdit}
          showPengawasText={isAdmin || (role === 'pengawas' && pengawasRoomId === activeRoom.id) || !!(data.settings && data.settings.showPengawasToPublic)}
          onPick={(ri, mi, winnerName) => handlePick(ri, mi, winnerName)}
          onOpenDetail={(ri, mi) => setDetailTarget({ scope: 'room', roomId: activeRoom.id, roundIdx: ri, matchIdx: mi })}
          onOpenPengawas={(ri, mi) => setPengawasTarget({ scope: 'room', roomId: activeRoom.id, roundIdx: ri, matchIdx: mi })}
        />
      </div>
    );
  }

  function renderManage() {
    if (!activeRoom || !draftParticipants || !draftPengawasNames) return null;
    function updateDraft(i, field, value) {
      setDraftParticipants(prev => prev.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));
    }
    function updatePengawasDraft(i, value) {
      setDraftPengawasNames(prev => prev.map((n, idx) => (idx === i ? value : n)));
    }
    return (
      <div className="view">
        <button type="button" className="back-btn" onClick={() => { setDraftParticipants(null); setDraftPengawasNames(null); setView('room'); }}><ChevronLeft size={16} /> Batal, Kembali</button>
        <div className="room-header">
          <div>
            <h2>Kelola Peserta</h2>
            <p>{activeRoom.name} &middot; Sesi {activeRoom.session} &middot; isi peserta &amp; pengawas per pertandingan, atau pakai impor massal</p>
          </div>
          <button type="button" className="btn btn-ghost sm" onClick={() => setBulkTarget(activeRoom.id)}><Upload size={13} /> Impor Massal</button>
        </div>
        <div className="match-manage-list">
          {Array.from({ length: 32 }, (_, i) => {
            const p1 = draftParticipants[i * 2];
            const p2 = draftParticipants[i * 2 + 1];
            return (
              <div key={i} className="match-manage-card">
                <div className="match-manage-title">Pertandingan {i + 1}</div>
                <div className="match-manage-pair">
                  <input
                    className="text-input"
                    value={p1.name}
                    onChange={e => updateDraft(i * 2, 'name', e.target.value)}
                    placeholder={`Nama peserta ${i * 2 + 1}`}
                  />
                  <input
                    className="text-input"
                    value={p1.school}
                    onChange={e => updateDraft(i * 2, 'school', e.target.value)}
                    placeholder="Nama sekolah"
                  />
                </div>
                <div className="match-manage-vs">vs</div>
                <div className="match-manage-pair">
                  <input
                    className="text-input"
                    value={p2.name}
                    onChange={e => updateDraft(i * 2 + 1, 'name', e.target.value)}
                    placeholder={`Nama peserta ${i * 2 + 2}`}
                  />
                  <input
                    className="text-input"
                    value={p2.school}
                    onChange={e => updateDraft(i * 2 + 1, 'school', e.target.value)}
                    placeholder="Nama sekolah"
                  />
                </div>
                <label className="field-label">Nama Pengawas Pertandingan Ini</label>
                <input
                  className="text-input"
                  value={draftPengawasNames[i]}
                  onChange={e => updatePengawasDraft(i, e.target.value)}
                  placeholder="Nama pengawas"
                />
              </div>
            );
          })}
        </div>
        <button type="button" className="btn btn-gold full" onClick={saveManageChanges}>Simpan Semua Perubahan</button>
      </div>
    );
  }

  function renderFinal() {
    return (
      <div className="view">
        <button type="button" className="back-btn" onClick={() => setView('dashboard')}><ChevronLeft size={16} /> Semua Ruangan</button>

        <div className="room-header">
          <div>
            <h2>Babak Lanjutan</h2>
            <p>Juara dari 10 ruangan bertemu di sini</p>
          </div>
          {isAdmin && (
            <button type="button" className="btn btn-gold sm" onClick={() => setShowNewMatch(true)}><Plus size={14} /> Buat Pertandingan</button>
          )}
        </div>

        {champion && (
          <div className="champion-banner gold">🏆 Juara Umum: <strong>{champion}</strong></div>
        )}

        <div className="qualifier-strip">
          {data.rooms.map(room => {
            const c = getRoomChampion(room);
            return (
              <div key={room.id} className={'qualifier-chip' + (c ? ' ready' : '')}>
                <span className="qualifier-room">Sesi {room.session} · {room.name}</span>
                <span className="qualifier-name">{c || 'Belum ada juara'}</span>
              </div>
            );
          })}
        </div>

        {data.finalStage.matches.length === 0 ? (
          <div className="empty-state">
            <p>Belum ada pertandingan di babak lanjutan.</p>
            {isAdmin && <p>Tekan "Buat Pertandingan" setelah cukup ruangan punya juara.</p>}
          </div>
        ) : (
          <div className="match-grid">
            {data.finalStage.matches.map(m => (
              <MatchTicket
                key={m.id}
                p1={m.p1}
                p2={m.p2}
                winner={m.winner}
                readOnly={!isAdmin}
                label={m.round}
                photo={m.photo}
                durationSeconds={m.durationSeconds}
                violations={m.violations}
                onDelete={isAdmin ? () => deleteFinalMatch(m.id) : undefined}
                onPick={winnerName => pickFinalWinner(m.id, winnerName)}
                onOpenDetail={isAdmin ? () => setDetailTarget({ scope: 'final', matchId: m.id }) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="lrp-app">
      <GlobalStyle />
      {view !== 'landing' && (
        <header className="lrp-header">
          <button type="button" className="brand" onClick={() => setView('landing')}>
            <span className="brand-mark">🎪</span>
            <div>
              <h1>LRP Bracket</h1>
              <p>Manajemen turnamen 1 lawan 1</p>
            </div>
          </button>
          <div className="header-actions">
            {saving && <span className="saving-tag">Menyimpan…</span>}
            {saveError && (
              <span className="save-error-tag" onClick={() => setSaveError('')} title="Klik untuk menutup">⚠ {saveError}</span>
            )}
            <button type="button" className="admin-toggle" onClick={() => (role === 'public' ? setView('login') : handleLogout())}>
              {role === 'public' ? <Lock size={15} /> : <Unlock size={15} />}
              {role === 'admin' && 'Admin'}
              {role === 'pengawas' && (() => {
                const r = data && data.rooms.find(rm => rm.id === pengawasRoomId);
                return r ? `Pengawas Sesi ${r.session} · ${r.name}` : 'Pengawas';
              })()}
              {role === 'public' && 'Publik'}
            </button>
          </div>
        </header>
      )}

      <main className="lrp-main">
        {view === 'landing' && renderLanding()}
        {view === 'login' && renderLogin()}
        {view === 'dashboard' && renderDashboard()}
        {view === 'session' && renderSessionRooms()}
        {view === 'room' && renderRoom()}
        {view === 'manage' && renderManage()}
        {view === 'final' && renderFinal()}
      </main>

      {detailTarget && getDetailMatch() && (
        <MatchDetailModal
          match={getDetailMatch()}
          canEdit={detailCanEdit()}
          title={detailTarget.scope === 'room' ? `Detail Pertandingan — ${(data.rooms.find(r => r.id === detailTarget.roomId) || {}).name || ''} (Sesi ${(data.rooms.find(r => r.id === detailTarget.roomId) || {}).session || ''})` : 'Detail Pertandingan — Babak Lanjutan'}
          onClose={() => setDetailTarget(null)}
          onUploadPhoto={handleUploadPhoto}
          onSaveDetails={handleSaveDetails}
          onResetMatch={detailTarget.scope === 'room'
            ? () => requestResetMatch('room', detailTarget.roomId, detailTarget.roundIdx, detailTarget.matchIdx)
            : () => requestResetMatch('final', null, null, null, detailTarget.matchId)}
        />
      )}

      {pengawasTarget && getPengawasMatch() && (
        <PengawasModal
          match={getPengawasMatch()}
          canEdit={isAdmin}
          title={pengawasTarget.scope === 'room' ? `Nama Pengawas — ${(data.rooms.find(r => r.id === pengawasTarget.roomId) || {}).name || ''} (Sesi ${(data.rooms.find(r => r.id === pengawasTarget.roomId) || {}).session || ''})` : 'Nama Pengawas — Babak Lanjutan'}
          onClose={() => setPengawasTarget(null)}
          onSave={savePengawasName}
        />
      )}

      {bulkTarget !== null && (
        <Modal
          title={bulkTarget === 'global' ? 'Impor 640 Peserta' : `Impor Peserta — ${(data.rooms.find(r => r.id === bulkTarget) || {}).name || ''} (Sesi ${(data.rooms.find(r => r.id === bulkTarget) || {}).session || ''})`}
          onClose={() => { setBulkTarget(null); setBulkText(''); setImportFileRows(null); setImportFileError(''); }}
          wide
        >
          {bulkTarget === 'global' && (
            <>
              <label className="field-label">Impor dari File Excel/CSV (disarankan)</label>
              <p className="modal-hint">
                File butuh kolom "sesi", "ruangan", dan "nama" — cocok buat daftar yang sudah disusun per sesi & ruangan.{' '}
                <a href="/template-peserta-lrp.xlsx" download className="template-link">Unduh template kosong</a>
              </p>
              <label className="btn btn-ghost sm upload-label">
                <FileSpreadsheet size={13} /> Pilih File (.xlsx / .xls / .csv)
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} className="hidden-file-input" />
              </label>
              {importFileError && <p className="error-text">{importFileError}</p>}
              {importFileRows && (
                <div className="import-preview">
                  {Array.from({ length: ROOM_COUNT }, (_, i) => i + 1).map(roomId => {
                    const group = importFileRows[roomId];
                    const ok = group && group.names.length === 64;
                    return (
                      <div key={roomId} className={'import-preview-row' + (!group ? ' missing' : ok ? ' ok' : ' warn')}>
                        <span>Ruangan {roomId}</span>
                        <span>{group ? `${group.names.length} nama · Sesi ${group.session || (data.rooms.find(r => r.id === roomId) || {}).session || '?'}` : 'tidak ada data'}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {importFileRows && (
                <button type="button" className="btn btn-gold full" onClick={applyImportFile}>Terapkan dari File</button>
              )}
              <div className="modal-divider">atau tempel manual</div>
            </>
          )}
          <p className="modal-hint">
            {bulkTarget === 'global'
              ? 'Tempel hingga 640 nama (1 nama per baris). Nama akan dibagi otomatis ke 10 ruangan sesuai urutan, 64 nama per ruangan.'
              : 'Tempel 64 nama untuk ruangan ini (1 nama per baris).'}
          </p>
          <textarea
            className="text-area"
            rows={8}
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
            placeholder={'Nama Peserta 1\nNama Peserta 2\nNama Peserta 3\n...'}
          />
          <p className="modal-hint">{bulkText.split('\n').map(s => s.trim()).filter(Boolean).length} nama terdeteksi</p>
          <button type="button" className="btn btn-ghost full" onClick={doBulkImport}>Simpan dari Teks</button>
        </Modal>
      )}

      {showNewMatch && (
        <Modal title="Buat Pertandingan Baru" onClose={() => { setShowNewMatch(false); setNewP1(''); setNewP2(''); setNewRound('Semifinal'); }}>
          <label className="field-label">Nama Babak</label>
          <div className="round-quick">
            {['Semifinal', 'Final'].map(r => (
              <button key={r} type="button" className={'chip-btn' + (newRound === r ? ' active' : '')} onClick={() => setNewRound(r)}>{r}</button>
            ))}
          </div>
          <input className="text-input" value={newRound} onChange={e => setNewRound(e.target.value)} placeholder="Nama babak" />

          <label className="field-label">Peserta 1</label>
          <select className="text-input" value={newP1} onChange={e => setNewP1(e.target.value)}>
            <option value="">Pilih peserta…</option>
            {finalPool.map(name => <option key={name} value={name} disabled={name === newP2}>{name}</option>)}
          </select>

          <label className="field-label">Peserta 2</label>
          <select className="text-input" value={newP2} onChange={e => setNewP2(e.target.value)}>
            <option value="">Pilih peserta…</option>
            {finalPool.map(name => <option key={name} value={name} disabled={name === newP1}>{name}</option>)}
          </select>

          <button type="button" className="btn btn-gold full" disabled={!newP1 || !newP2 || newP1 === newP2} onClick={createFinalMatch}>Buat Pertandingan</button>
        </Modal>
      )}

      {confirmState && (
        <Modal title="Konfirmasi" onClose={() => setConfirmState(null)}>
          <p className="modal-hint">{confirmState.message}</p>
          <div className="confirm-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmState(null)}>Batal</button>
            <button type="button" className="btn btn-crimson" onClick={confirmState.onConfirm}>Ya, Lanjutkan</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
