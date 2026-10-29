// hevyCsvExport.js — Arise sessions → Hevy's own "Export workout data" CSV.
//
// The mirror of hevyCsvImport.js. Henry-style lifters log in Hevy AND Arise;
// importing was one-way, so the two logs drifted apart. This writes the same
// one-row-per-set layout Hevy itself writes:
//   title, start_time, end_time, description, exercise_title, superset_id,
//   exercise_notes, set_index, set_type, weight_kg | weight_lbs, reps,
//   distance_km, duration_seconds, rpe
// Exercise names come back through the import table (inverted, so the round
// trip is exact); a lift Hevy has no mapped name for keeps its Arise name and
// is listed as `customExercises` so the user knows Hevy will treat it as a
// custom exercise. Workouts that were themselves imported from Hevy are left
// out by default, otherwise exporting would send Hevy its own data back as
// duplicates. Pure: it builds text from the history it is given and never
// touches the store, the network or storage (the last-export marker is an
// injected, device-only key).

import { HEVY_EXERCISE_MAP } from './hevyCsvImport.js';

export const HEVY_HEADER = ['title', 'start_time', 'end_time', 'description', 'exercise_title', 'superset_id', 'exercise_notes', 'set_index', 'set_type', 'weight_kg', 'reps', 'distance_km', 'duration_seconds', 'rpe'];

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KG_PER_LB = 0.45359237;
const DEFAULT_MINUTES = 45; // only used when a session never recorded how long it took
const pad = (n) => String(n).padStart(2, '0');

// First Hevy name listed for an Arise id wins; the table is written with the
// most common Hevy spelling first, and the order is part of the contract.
const ID_TO_HEVY = (() => {
  const out = {};
  for(const [title, id] of Object.entries(HEVY_EXERCISE_MAP)){
    if(out[id]) continue;
    out[id] = title.replace(/(^|[\s(\-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }
  return out;
})();

/** Hevy's name for an Arise exercise id; `custom` is true when Hevy has no mapped name for it. */
export function hevyNameFor(exerciseId, byId = null){
  if(ID_TO_HEVY[exerciseId]) return { name: ID_TO_HEVY[exerciseId], custom: false };
  const name = byId && byId[exerciseId] && byId[exerciseId].name;
  return { name: name || String(exerciseId), custom: true };
}

/** Local "23 Oct 2026, 18:30" (the format Hevy writes and hevyDate() reads). */
export function formatHevyTime(date){
  return `${pad(date.getDate())} ${MONTH[date.getMonth()]} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function sessionWindow(entry){
  const [y, m, d] = String(entry.dateISO || '').split('-').map(Number);
  let start = new Date(y, m - 1, d, 12, 0, 0);
  const t = entry.startedAt ? new Date(entry.startedAt) : null;
  // The logged day is the source of truth; the clock time is only trusted when it falls on that day.
  if(t && !Number.isNaN(t.getTime()) && t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d) start = t;
  let minutes = Number(entry.durationMinutes);
  if(!(minutes > 0) && entry.finishedAt && entry.startedAt){
    minutes = Math.round((Date.parse(entry.finishedAt) - Date.parse(entry.startedAt)) / 60000);
  }
  if(!(minutes > 0 && minutes < 600)) minutes = DEFAULT_MINUTES;
  return { start, end: new Date(start.getTime() + minutes * 60000), estimatedEnd: !(Number(entry.durationMinutes) > 0) };
}

const numText = (n) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '');

function cell(value){
  let text = String(value ?? '').replace(/"/g, '""');
  if(/^[=+\-@\t]/.test(text)) text = `'${text}`; // spreadsheet formula injection guard
  return `"${text}"`;
}

/** A set Hevy should see: done (not skipped/undone) with reps or a load. */
export function exportableSet(set){
  if(!set || set.skipped || set.completed === false) return false;
  const reps = Number(set.reps), kg = Number(set.weightKg) || Number(set.assistedKg) || 0;
  return reps > 0 || kg > 0;
}

/** Entries that may go to Hevy under the chosen options, with why the rest were held back. */
export function selectForHevy(history, { since = null, until = null, includeHevyOrigin = false } = {}){
  const picked = [];
  let fromHevy = 0;
  for(const h of Array.isArray(history) ? history : []){
    if(!h || typeof h !== 'object' || !Array.isArray(h.blocks)) continue;
    if(h.deletedAt) continue;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(h.dateISO || ''))) continue;
    if(since && h.dateISO < since) continue;
    if(until && h.dateISO > until) continue;
    if(!includeHevyOrigin && (/^hevy-/.test(String(h.id || '')) || /Imported from Hevy/i.test(String(h.note || '')))){ fromHevy++; continue; }
    if(!h.blocks.some(b => (b.sets || []).some(exportableSet))) continue;
    picked.push(h);
  }
  picked.sort((a, b) => a.dateISO.localeCompare(b.dateISO) || String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
  return { entries: picked, fromHevy };
}

/**
 * Build the export.
 * @returns {{ csv, filename, workouts, sets, exercises, customExercises: string[],
 *   fromHevy, firstDate, lastDate }}
 */
export function buildHevyExport(history, { byId = null, units = 'kg', since = null, until = null, includeHevyOrigin = false, todayISO = null } = {}){
  const unit = units === 'lb' ? 'lb' : 'kg';
  const { entries, fromHevy } = selectForHevy(history, { since, until, includeHevyOrigin });
  const header = HEVY_HEADER.map(c => (c === 'weight_kg' && unit === 'lb' ? 'weight_lbs' : c));
  const lines = [header.map(cell).join(',')];
  const exerciseIds = new Set(), custom = new Set();
  let setCount = 0;
  for(const h of entries){
    const { start, end } = sessionWindow(h);
    const title = String(h.title || 'Arise workout').replace(/\s*\(hevy\)$/i, '');
    const description = String(h.note || '').replace(/^Imported from Hevy CSV$/i, '').trim();
    for(const b of h.blocks){
      const sets = (b.sets || []).filter(exportableSet);
      if(!sets.length) continue;
      const { name, custom: isCustom } = hevyNameFor(b.exerciseId, byId);
      exerciseIds.add(b.exerciseId);
      if(isCustom) custom.add(name);
      sets.forEach((s, i) => {
        const kg = Number(s.weightKg) || (/assisted/.test(String(b.exerciseId)) ? Number(s.assistedKg) || 0 : 0);
        const shown = unit === 'lb' ? Math.round(kg / KG_PER_LB * 10) / 10 : kg;
        const rpe = s.rpe === '' || s.rpe == null ? '' : numText(Number(s.rpe));
        lines.push([
          title, formatHevyTime(start), formatHevyTime(end), description, name, '', '', i,
          s.failed ? 'failure' : 'normal', kg > 0 ? numText(shown) : '', Number(s.reps) > 0 ? Number(s.reps) : '', '', '', rpe,
        ].map(cell).join(','));
        setCount++;
      });
    }
  }
  const stamp = todayISO || (entries.length ? entries[entries.length - 1].dateISO : 'empty');
  return {
    csv: lines.join('\n') + '\n',
    filename: `arise-for-hevy-${stamp}.csv`,
    workouts: entries.length, sets: setCount, exercises: exerciseIds.size, customExercises: [...custom],
    fromHevy,
    firstDate: entries.length ? entries[0].dateISO : null, lastDate: entries.length ? entries[entries.length - 1].dateISO : null,
  };
}

const addDays = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

export const HEVY_RANGES = Object.freeze([
  { id: 'since-last', label: 'Since my last export' },
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
  { id: 'all', label: 'Everything' },
]);

/** Start date (inclusive) for a range preset; null = no lower bound. 'since-last' falls back to everything when never exported. */
export function rangeStart(rangeId, todayISO, lastExportISO = null){
  if(rangeId === '30') return addDays(todayISO, -29);
  if(rangeId === '90') return addDays(todayISO, -89);
  if(rangeId === 'since-last') return lastExportISO ? addDays(lastExportISO, 1) : null;
  return null;
}

const MARK_KEY = 'arise.hevyExport.v1';

/** Device-only marker of the newest day already exported (never synced, never in backups). */
export function readExportMark(storage = (typeof localStorage !== 'undefined' ? localStorage : null)){
  try{
    const v = storage?.getItem(MARK_KEY) || '';
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }catch{ return null; }
}

export function writeExportMark(lastDateISO, storage = (typeof localStorage !== 'undefined' ? localStorage : null)){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(lastDateISO || '')) return false;
  try{ storage?.setItem(MARK_KEY, lastDateISO); return true; }catch{ return false; }
}
