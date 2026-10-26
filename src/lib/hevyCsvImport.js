// hevyCsvImport.js — Hevy's own "Export workout data" CSV → Arise sessions.
//
// Hevy writes ONE ROW PER SET with columns like:
//   title, start_time, end_time, description, exercise_title, superset_id,
//   exercise_notes, set_index, set_type, weight_kg | weight_lbs, reps,
//   distance_km, duration_seconds, rpe
// The generic app importer (appCsvImport.js) reads `title` as the exercise
// and cannot parse "23 Oct 2026, 18:30", so a Hevy file used to import as
// nothing. This module is the Hevy-aware path: it groups rows into the real
// workouts, drops warm-up sets (they would fake a low working load), maps
// Hevy exercise names to Arise ids through an explicit table (unknown names
// are reported, never guessed), and keeps per-set weight/reps/RPE.
// Local-only: it parses text the user picked; it never touches the store.

/** RFC-4180-ish parser: quoted cells may contain commas, quotes and newlines. */
export function parseCsvRecords(text){
  const src = String(text || '').replace(/^\uFEFF/, '');
  const records = [];
  let rec = [], cur = '', inQ = false;
  for(let i = 0; i < src.length; i++){
    const ch = src[i];
    if(inQ){
      if(ch === '"' && src[i + 1] === '"'){ cur += '"'; i++; }
      else if(ch === '"') inQ = false;
      else cur += ch;
    } else if(ch === '"') inQ = true;
    else if(ch === ','){ rec.push(cur); cur = ''; }
    else if(ch === '\n' || ch === '\r'){
      if(ch === '\r' && src[i + 1] === '\n') i++;
      rec.push(cur); cur = '';
      if(rec.some(c => c.trim() !== '')) records.push(rec);
      rec = [];
    } else cur += ch;
  }
  rec.push(cur);
  if(rec.some(c => c.trim() !== '')) records.push(rec);
  return records;
}

const REQUIRED = ['exercise_title', 'start_time'];

/** True when the header row is Hevy's export format. */
export function isHevyCsv(text){
  const head = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] || '';
  const cols = head.split(',').map(c => c.replace(/"/g, '').trim().toLowerCase());
  return REQUIRED.every(c => cols.includes(c)) && (cols.includes('set_index') || cols.includes('weight_kg') || cols.includes('weight_lbs'));
}

// Hevy's exercise_title → Arise id. Only unambiguous matches; anything else
// is surfaced in `unmappedExercises` so the user can see what was left out.
export const HEVY_EXERCISE_MAP = Object.freeze({
  'bench press (barbell)': 'bench-press-barbell', 'bench press (dumbbell)': 'bench-press-dumbbell',
  'incline bench press (barbell)': 'incline-bench-press', 'incline bench press (dumbbell)': 'incline-dumbbell-press',
  'decline bench press (barbell)': 'decline-bench-press', 'bench press (smith machine)': 'smith-machine-bench-press',
  'close grip bench press (barbell)': 'close-grip-bench-press',
  'chest press (machine)': 'chest-press-machine', 'chest fly (machine)': 'machine-fly',
  'butterfly (pec deck)': 'machine-fly', 'chest fly (dumbbell)': 'dumbbell-fly',
  'cable fly crossovers': 'cable-fly', 'chest fly (cable)': 'cable-fly', 'low cable fly crossovers': 'incline-cable-fly',
  'push up': 'push-up', 'pull up': 'pull-up', 'chin up': 'chin-up', 'chest dip': 'chest-dip',
  'triceps dip': 'dip', 'chest dip (assisted)': 'assisted-dip', 'triceps dip (assisted)': 'assisted-dip',
  'lat pulldown (cable)': 'lat-pulldown', 'lat pulldown (machine)': 'lat-pulldown',
  'lat pulldown - close grip (cable)': 'close-grip-lat-pulldown', 'wide pull up': 'pull-up',
  'seated cable row': 'cable-row', 'seated row (machine)': 'machine-row', 'iso-lateral row (machine)': 'machine-row',
  'bent over row (barbell)': 'barbell-row', 'bent over row (dumbbell)': 'dumbbell-bent-over-row',
  'dumbbell row': 'dumbbell-row', 't bar row': 't-bar-row', 'single arm cable row': 'single-arm-cable-row',
  'face pull': 'face-pull', 'straight arm lat pulldown (cable)': 'straight-arm-pulldown',
  'shoulder press (dumbbell)': 'overhead-press-dumbbell', 'seated shoulder press (dumbbell)': 'seated-dumbbell-press',
  'overhead press (barbell)': 'overhead-press-barbell', 'shoulder press (machine)': 'machine-shoulder-press',
  'shoulder press (machine plates)': 'machine-shoulder-press', 'arnold press (dumbbell)': 'arnold-press',
  'lateral raise (dumbbell)': 'lateral-raise', 'lateral raise (cable)': 'cable-lateral-raise',
  'lateral raise (machine)': 'machine-lateral-raise', 'front raise (dumbbell)': 'front-raise',
  'rear delt reverse fly (dumbbell)': 'bent-over-rear-delt-raise', 'rear delt reverse fly (machine)': 'rear-delt-fly',
  'rear delt reverse fly (cable)': 'cable-rear-delt-fly', 'shrug (dumbbell)': 'dumbbell-shrug', 'shrug (barbell)': 'shrug',
  'bicep curl (dumbbell)': 'bicep-curl', 'bicep curl (cable)': 'cable-curl', 'bicep curl (barbell)': 'barbell-curl',
  'hammer curl (dumbbell)': 'hammer-curl', 'preacher curl (machine)': 'preacher-curl-machine',
  'preacher curl (barbell)': 'preacher-curl', 'ez bar biceps curl': 'ez-bar-curl', 'incline curl (dumbbell)': 'incline-dumbbell-curl',
  'triceps pushdown': 'tricep-pushdown', 'triceps pushdown (cable - straight bar)': 'tricep-pushdown',
  'triceps rope pushdown': 'rope-tricep-pushdown', 'triceps extension (dumbbell)': 'dumbbell-overhead-tricep-extension',
  'overhead triceps extension (cable)': 'overhead-tricep-extension', 'seated dip machine': 'machine-dip',
  'leg press (machine)': 'leg-press', 'leg extension (machine)': 'leg-extension', 'seated leg curl (machine)': 'seated-leg-curl',
  'lying leg curl (machine)': 'lying-leg-curl', 'standing calf raise (machine)': 'standing-calf-raise',
  'seated calf raise (machine)': 'seated-calf-raise', 'calf press (machine)': 'leg-press-calf-raise',
  'squat (barbell)': 'barbell-squat', 'romanian deadlift (barbell)': 'romanian-deadlift', 'hip thrust (barbell)': 'hip-thrust',
  'plank': 'plank', 'hanging leg raise': 'leg-raise', 'hanging knee raise': 'hanging-knee-raise', 'pallof press': 'pallof-press',
});

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

const STOP = new Set(['the', 'a', 'an', 'with', 'on']);
const EQUIP_SYNONYM = { 'machine plates': 'machine', 'plate loaded': 'machine', 'smith': 'smith', 'ez': 'ez', 'ezbar': 'ez' };

/** Light plural stemmer: "curls"→"curl"; never mangles "press" or "cross". */
export function stemToken(w){
  if(w.length <= 3 || /(ss|us)$/.test(w)) return w;
  if(/(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  return w.endsWith('s') ? w.slice(0, -1) : w;
}

/** Order-free token key: "Bench Press (Dumbbell)" and "Dumbbell Bench Press" share one. */
export function exerciseTokenKey(title){
  let t = norm(title).replace(/[()\-_/,]+/g, ' ');
  for(const [from, to] of Object.entries(EQUIP_SYNONYM)) t = t.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
  const toks = t.split(' ').filter(w => w && !STOP.has(w)).map(stemToken);
  return [...new Set(toks)].sort().join(' ');
}

let tokenIndex = null, tokenIndexFor = null;
function indexFor(byId){
  if(tokenIndex && tokenIndexFor === byId) return tokenIndex;
  const idx = new Map();
  for(const [id, ex] of Object.entries(byId)){
    const k = exerciseTokenKey(ex && ex.name);
    if(!k) continue;
    idx.set(k, idx.has(k) ? null : id); // null = ambiguous, never guess
  }
  tokenIndex = idx; tokenIndexFor = byId;
  return idx;
}

/**
 * Hevy name → Arise id (or null). `byId` guards against ids Arise doesn't have.
 * Curated map first; then, only when a library is supplied, an order-free exact
 * name match (unique only), so "Dumbbell Bench Press" lands without guessing.
 */
export function resolveHevyExercise(title, byId = null){
  const id = HEVY_EXERCISE_MAP[norm(title)];
  if(id) return !byId || byId[id] ? id : null;
  if(!byId) return null;
  const idx = indexFor(byId);
  const hit = idx.get(exerciseTokenKey(title));
  if(hit) return hit;
  // Barbell is the implied default for bare library names ("Pendlay Row").
  const bare = exerciseTokenKey(title).split(' ').filter(w => w !== 'barbell').join(' ');
  return /\bbarbell\b/i.test(title) ? (idx.get(bare) || null) : null;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "23 Oct 2026, 18:30" | "2026-10-23 18:30:00" | "Oct 23, 2026, 6:30 PM" → "2026-10-23". Calendar date as written (no timezone shift). */
export function hevyDate(v){
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/);
  if(m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if(m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

const num = (v) => { const n = Number(String(v ?? '').replace(',', '.').trim()); return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null; };

/**
 * Parse a Hevy export.
 * @returns {{ rows: Array<{dateISO, exerciseId, title, workoutKey, sets}>, unmappedExercises: string[],
 *   skipped: number, totalRows: number, warmupsDropped: number, workouts: number, source: 'hevy' }}
 */
export function parseHevyCsv(text, { byId = null } = {}){
  const records = parseCsvRecords(text);
  const empty = { rows: [], unmappedExercises: [], skipped: 0, totalRows: 0, warmupsDropped: 0, workouts: 0, source: 'hevy' };
  if(records.length < 2) return empty;
  const head = records[0].map(c => c.trim().toLowerCase());
  const col = (n) => head.indexOf(n);
  const iTitle = col('title'), iStart = col('start_time'), iEx = col('exercise_title'), iType = col('set_type');
  const iKg = col('weight_kg'), iLb = col('weight_lbs'), iReps = col('reps'), iRpe = col('rpe');
  if(iEx < 0 || iStart < 0) return empty;
  const groups = new Map(); // workoutKey|exerciseTitle (in file order) → row
  const unmapped = new Set();
  let skipped = 0, warmups = 0;
  const workoutKeys = new Set();
  for(const cells of records.slice(1)){
    const exTitle = (cells[iEx] || '').trim();
    const start = (cells[iStart] || '').trim();
    const dateISO = hevyDate(start);
    if(!exTitle || !dateISO){ skipped++; continue; }
    const type = norm(iType >= 0 ? cells[iType] : 'normal');
    if(type === 'warmup'){ warmups++; continue; }
    const exerciseId = resolveHevyExercise(exTitle, byId);
    if(!exerciseId){ unmapped.add(exTitle); skipped++; continue; }
    const kg = iKg >= 0 ? num(cells[iKg]) : null;
    const lb = kg == null && iLb >= 0 ? num(cells[iLb]) : null;
    const weightKg = kg != null ? kg : (lb != null ? Math.round(lb * 0.45359237 * 10) / 10 : null);
    const reps = iReps >= 0 ? num(cells[iReps]) : null;
    if(reps == null && !(weightKg > 0)){ skipped++; continue; } // cardio/timed rows with no load or reps
    const rpe = iRpe >= 0 ? num(cells[iRpe]) : null;
    const workoutKey = `${start}|${iTitle >= 0 ? (cells[iTitle] || '').trim() : ''}`;
    workoutKeys.add(workoutKey);
    const key = `${workoutKey}|${exerciseId}`;
    if(!groups.has(key)) groups.set(key, { dateISO, exerciseId, title: iTitle >= 0 ? (cells[iTitle] || '').trim() : '', workoutKey, sets: [] });
    groups.get(key).sets.push({ reps, weightKg, rpe: rpe == null ? '' : String(rpe) });
  }
  return {
    rows: [...groups.values()], unmappedExercises: [...unmapped], skipped,
    totalRows: records.length - 1, warmupsDropped: warmups, workouts: workoutKeys.size, source: 'hevy',
  };
}

/**
 * Deterministic id for an imported session. Merge keys history by `id`, so an
 * entry without one is dropped silently; a content-derived id also makes
 * re-importing the same file idempotent (same workout → same id → no duplicate).
 */
export function stableImportId(prefix, dateISO, payload){
  let h = 5381;
  const str = JSON.stringify(payload);
  for(let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return `${prefix}-${dateISO}-${h.toString(36)}`;
}

/** Rows from parseHevyCsv → Arise history entries: one per real Hevy workout, titled as in Hevy. */
export function hevyRowsToHistory(rows){
  const byWorkout = new Map();
  for(const r of rows){
    if(!byWorkout.has(r.workoutKey)) byWorkout.set(r.workoutKey, { dateISO: r.dateISO, title: r.title, rows: [] });
    byWorkout.get(r.workoutKey).rows.push(r);
  }
  return [...byWorkout.values()].sort((a, b) => a.dateISO.localeCompare(b.dateISO)).map(w => ({
    id: stableImportId('hevy', w.dateISO, [w.title, w.rows.map(r => [r.exerciseId, r.sets])]),
    dateISO: w.dateISO,
    title: w.title ? `${w.title} (Hevy)` : 'Imported from Hevy',
    blocks: w.rows.map(r => ({ exerciseId: r.exerciseId, sets: r.sets.map(s => ({ weightKg: s.weightKg ?? 0, reps: s.reps ?? '', completed: true, rpe: s.rpe })) })),
    note: 'Imported from Hevy CSV',
  }));
}
