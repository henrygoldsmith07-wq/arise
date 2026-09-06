// appCsvImport.js — importers from other apps' CSV exports.
//
// "Importer from other apps where legally/technically feasible": we import
// the user's own exported file, on their device, at their request — the same
// data they already own, in the neutral portableCsv schema
// (dateISO, exerciseId, reps, weightKg, rpe, ...). No proprietary formats are
// parsed; only plain CSV columns these apps document for export.
//
// Robustness contract (mirrors receipt-csv history): header or headerless,
// loose column matching, unknown exercises are reported not dropped silently,
// and nothing here touches the store — the caller applies the result through
// the same preview/confirm import flow as any other import.

// Column aliases per logical field. Match is case-insensitive, first hit wins.
const ALIASES = {
  date: ['date', 'dateISO', 'day', 'workout date', 'date (yyyy-mm-dd)'],
  exercise: ['exercise', 'exercise name', 'exerciseid', 'exercise id', 'movement', 'lift', 'name', 'title'],
  weight: ['weight', 'weightkg', 'weight (kg)', 'kg', 'load', 'weight_lkg', 'weight (lbs)', 'lbs', 'lb', 'pounds'],
  unit: ['unit', 'units', 'weight unit', 'uom'],
  reps: ['reps', 'rep', 'repetitions', 'reps completed'],
  sets: ['sets', 'set count', 'set'],
  rpe: ['rpe', 'rpe', 'difficulty', 'effort'],
  notes: ['notes', 'note', 'comments'],
};

function detectDelimiter(line){
  const counts = [[',', (line.match(/,/g) || []).length], [';', (line.match(/;/g) || []).length], ['\t', (line.match(/\t/g) || []).length]];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

function splitLine(line, delim){
  const out = [];
  let cur = '', inQ = false;
  for(let i = 0; i < line.length; i++){
    const ch = line[i];
    if(inQ){
      if(ch === '"' && line[i + 1] === '"'){ cur += '"'; i++; }
      else if(ch === '"') inQ = false;
      else cur += ch;
    } else if(ch === '"') inQ = true;
    else if(ch === delim){ out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function findColumn(headers, field){
  const list = ALIASES[field] || [];
  const lower = headers.map(h => h.toLowerCase().replace(/[_-]/g, ' ').trim());
  for(const alias of list){
    const i = lower.findIndex(h => h === alias || h.replace(/[_-]/g, ' ') === alias);
    if(i !== -1) return i;
  }
  // substring fallback (weight_kg → weight)
  for(const alias of list){
    const i = lower.findIndex(h => h.includes(alias));
    if(i !== -1) return i;
  }
  return -1;
}

const EXERCISE_NAME_FIXES = { // common renames → Arise ids where unambiguous
  'back squat': 'squat', 'front squat': 'front-squat', 'bench press': 'bench-press',
  'deadlift': 'deadlift', 'overhead press': 'overhead-press', 'ohp': 'overhead-press',
  'pull ups': 'pull-up', 'pullups': 'pull-up', 'chin ups': 'chin-up', 'push ups': 'push-up',
  'pushups': 'push-up', 'barbell row': 'barbell-row', 'bent over row': 'barbell-row',
  'romanian deadlift': 'romanian-deadlift', 'rdl': 'romanian-deadlift', 'lat pulldown': 'lat-pulldown',
};
const PASCAL_TO_ID = (name) => name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Resolve an imported exercise name to an Arise exercise id, or null. */
export function resolveExerciseId(name, byId = null){
  const clean = String(name || '').trim();
  if(!clean) return null;
  const fixed = EXERCISE_NAME_FIXES[clean.toLowerCase()];
  if(fixed && (!byId || byId[fixed])) return fixed;
  const id = PASCAL_TO_ID(clean);
  if(byId && !byId[id]){
    // Try singular/plural and trailing 's' before giving up.
    const alt = id.replace(/s$/, '');
    return byId[alt] ? alt : null;
  }
  return id;
}

function parseWeight(rawCell, unitCell, name){
  const rawText = String(rawCell ?? '');
  const raw = rawText.replace(/[^\d.,-]/g, '').replace(',', '.');
  let n = Number(raw);
  if(!Number.isFinite(n)) return null;
  const unitText = `${rawText} ${unitCell || ''} ${name || ''}`.toLowerCase();
  if(/\b(lb|lbs|pound)/.test(unitText)) n = Math.round(n * 0.4536 * 10) / 10;
  return Math.max(0, n);
}

function normaliseDate(v){
  const s = String(v || '').trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/); // dd/mm/yyyy or mm/dd — ambiguous, prefer day-first
  if(m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/**
 * Parse a gym-app CSV into portable rows.
 * @returns {{ rows: Array, unmappedExercises: string[], skipped: number, totalRows: number }}
 */
export function parseAppCsv(text, { byId = null } = {}){
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if(!lines.length) return { rows: [], unmappedExercises: [], skipped: 0, totalRows: 0 };
  const delim = detectDelimiter(lines[0]);
  let headers = null, start = 0;
  const probe = splitLine(lines[0], delim).map(s => s.toLowerCase());
  const looksLikeHeader = probe.some(h => ALIASES.date.includes(h) || ALIASES.exercise.includes(h) || h === 'weight');
  if(looksLikeHeader){ headers = probe; start = 1; }
  const idx = (f) => headers ? findColumn(headers, f) : -1;
  const idxDate = idx('date'), idxEx = idx('exercise'), idxW = idx('weight'), idxU = idx('unit'), idxR = idx('reps'), idxS = idx('sets'), idxRpe = idx('rpe');
  const rows = [], unmapped = new Set();
  let skipped = 0;
  for(let i = start; i < lines.length; i++){
    const cells = splitLine(lines[i], delim);
    const date = normaliseDate(headers && idxDate >= 0 ? cells[idxDate] : (cells[0] || ''));
    const exName = headers && idxEx >= 0 ? cells[idxEx] : (cells[1] || '');
    const exerciseId = byId ? resolveExerciseId(exName, byId) : (exName ? resolveExerciseId(exName, null) : null);
    if(!exerciseId){
      if(exName) unmapped.add(String(exName));
      skipped++;
      continue;
    }
    const weight = parseWeight(cells[idxW >= 0 ? idxW : 2], idxU >= 0 ? cells[idxU] : '', exName);
    const repsRaw = headers && idxR >= 0 ? cells[idxR] : (cells[3] ?? '');
    const reps = Number(String(repsRaw).replace(/[^\d.]/g, ''));
    if(!date){ skipped++; continue; }
    const expandSets = (reps) => {
      const list = [];
      const nSets = headers && idxS >= 0 ? Math.max(1, Math.min(10, Number(cells[idxS]) || 1)) : 1;
      for(let s = 0; s < nSets; s++) list.push({ reps: Number.isFinite(reps) ? reps : null, weightKg: weight, rpe: idxRpe >= 0 ? String(cells[idxRpe] || '') : '' });
      return list;
    };
    const sets = expandSets(Number(String(repsRaw).replace(/[^\d.]/g, '')));
    if(!sets.some(s => s.reps != null || s.weightKg > 0)){ skipped++; continue; }
    rows.push({ dateISO: date, exerciseId, sets });
  }
  return { rows, unmappedExercises: [...unmapped], skipped, totalRows: lines.length - start };
}

/** Convert parsed rows into Arise history entries (one per day). */
export function rowsToHistory(rows, { byId = null } = {}){
  const byDate = new Map();
  for(const r of rows){
    if(!byDate.has(r.dateISO)) byDate.set(r.dateISO, []);
    byDate.get(r.dateISO).push(r);
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dateISO, list]) => ({
    dateISO,
    title: 'Imported session',
    blocks: list.map(r => ({ exerciseId: r.exerciseId, sets: r.sets.map(s => ({ weightKg: s.weightKg ?? 0, reps: s.reps ?? '', completed: true, rpe: s.rpe || '' })) })),
    note: 'Imported from CSV',
  }));
}
