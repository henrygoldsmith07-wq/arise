// setupNotes.js — per-lift machine / bench setup (seat height, pin, grip, bench
// angle, one free note). Pure and local-first: the data lives in
// gymPrefs.setupNotes[exerciseId] = { seat, pin, grip, angle, note, updatedAt },
// is carried through backup/export and sync merge (newest edit wins per lift),
// and a text snapshot is stamped onto each logged block so a lifter can see
// what they used last time and whether the setup has since changed.
//
// Clearing a note keeps a tiny `{ updatedAt }` entry (a tombstone) so a
// deletion on one device is not undone by an older copy on another device.

export const SETUP_FIELDS = [
  { key: 'seat', label: 'Seat', placeholder: 'e.g. 4', max: 24 },
  { key: 'pin', label: 'Pin / stack', placeholder: 'e.g. pin 3', max: 24 },
  { key: 'grip', label: 'Grip / handles', placeholder: 'e.g. neutral', max: 32 },
  { key: 'angle', label: 'Bench / back angle', placeholder: 'e.g. 30°', max: 24 },
  { key: 'note', label: 'Other', placeholder: 'e.g. strap on pad', max: 120 },
];

const FIELD_KEYS = SETUP_FIELDS.map((f) => f.key);
const MAX_LIFTS = 300;

function cleanText(value, max){
  // Strip control characters (incl. newlines) and collapse whitespace.
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, max);
}

/** Normalise one stored entry; null when it is not an object. */
export function sanitizeSetupEntry(raw){
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for(const f of SETUP_FIELDS){
    const v = cleanText(raw[f.key], f.max);
    if(v) out[f.key] = v;
  }
  const t = Date.parse(raw.updatedAt || '');
  out.updatedAt = Number.isFinite(t) ? new Date(t).toISOString() : new Date(0).toISOString();
  return out;
}

export function isEmptySetup(entry){
  return !entry || FIELD_KEYS.every((k) => !entry[k]);
}

/** Clean a whole setupNotes map (store hydration / import). */
export function sanitizeSetupNotes(raw){
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  let n = 0;
  for(const id of Object.keys(raw)){
    if(n >= MAX_LIFTS) break;
    if(!/^[\w.\-:]{1,80}$/.test(id)) continue;
    const entry = sanitizeSetupEntry(raw[id]);
    if(!entry) continue;
    out[id] = entry;
    n++;
  }
  return out;
}

/** The lift's current setup, or null when none (or cleared). */
export function getSetupNote(gymPrefs, exerciseId){
  const entry = gymPrefs?.setupNotes?.[exerciseId];
  if(!entry || typeof entry !== 'object') return null;
  const clean = sanitizeSetupEntry(entry);
  return isEmptySetup(clean) ? null : clean;
}

const SHORT_LABELS = { seat: 'Seat', pin: 'Pin', grip: 'Grip', angle: 'Angle', note: '' };

/** One-line text for a setup: "Seat 4 · Pin 3 · Grip neutral". */
export function formatSetup(entry){
  if(isEmptySetup(entry)) return '';
  return FIELD_KEYS
    .filter((k) => entry[k])
    .map((k) => (SHORT_LABELS[k] ? `${SHORT_LABELS[k]} ${entry[k]}` : entry[k]))
    .join(' · ');
}

/**
 * Returns the gymPrefs patch that stores `fields` for a lift. An empty form
 * clears the note but keeps a timestamped tombstone. Unchanged content leaves
 * the previous timestamp alone so a no-op save never wins a sync merge.
 */
export function setSetupNote(gymPrefs, exerciseId, fields, nowISO = new Date().toISOString()){
  const prevMap = sanitizeSetupNotes(gymPrefs?.setupNotes);
  const entry = { updatedAt: nowISO };
  for(const f of SETUP_FIELDS){
    const v = cleanText(fields?.[f.key], f.max);
    if(v) entry[f.key] = v;
  }
  const prev = prevMap[exerciseId];
  const same = prev && FIELD_KEYS.every((k) => (prev[k] || '') === (entry[k] || ''));
  if(same) return { setupNotes: prevMap };
  const next = { ...prevMap, [exerciseId]: entry };
  return { setupNotes: next, updatedAt: nowISO };
}

export function clearSetupNote(gymPrefs, exerciseId, nowISO = new Date().toISOString()){
  return setSetupNote(gymPrefs, exerciseId, {}, nowISO);
}

const stamp = (e) => { const t = Date.parse(e?.updatedAt || ''); return Number.isFinite(t) ? t : 0; };
const body = (e) => FIELD_KEYS.map((k) => e?.[k] || '').join('\u0001');

/**
 * Deterministic merge of two setupNotes maps: per lift the newer updatedAt
 * wins; equal stamps break on content so merge(a,b) === merge(b,a).
 */
export function mergeSetupNotes(a, b){
  const left = sanitizeSetupNotes(a), right = sanitizeSetupNotes(b);
  const out = {};
  for(const id of new Set([...Object.keys(left), ...Object.keys(right)])){
    const x = left[id], y = right[id];
    if(!x || !y){ out[id] = x || y; continue; }
    const tx = stamp(x), ty = stamp(y);
    if(tx !== ty) out[id] = tx > ty ? x : y;
    else out[id] = body(x) >= body(y) ? x : y;
  }
  return out;
}

/**
 * Setup the lifter used last time for this lift (text snapshot stamped on the
 * logged block), newest first. Returns { setup, dateISO } or null.
 */
export function lastLoggedSetup(history, exerciseId){
  const list = Array.isArray(history) ? history : [];
  for(let i = list.length - 1; i >= 0; i--){
    const block = (list[i]?.blocks || []).find((b) => b?.exerciseId === exerciseId);
    if(!block) continue;
    return { setup: typeof block.setup === 'string' ? block.setup : '', dateISO: list[i].dateISO || null };
  }
  return null;
}

/**
 * Compare today's setup with what was logged last time. `changed` only when
 * both exist and differ (a lift logged before this feature never "changed").
 */
export function setupDrift(gymPrefs, history, exerciseId){
  const current = formatSetup(getSetupNote(gymPrefs, exerciseId));
  const last = lastLoggedSetup(history, exerciseId);
  const previous = last?.setup || '';
  return { changed: Boolean(current && previous && current !== previous), current, previous, dateISO: last?.dateISO || null };
}

/** Spread into a history block: `{ setup: 'Seat 4 · Pin 3' }` or nothing. */
export function setupField(gymPrefs, exerciseId){
  const setup = formatSetup(getSetupNote(gymPrefs, exerciseId));
  return setup ? { setup } : {};
}
