// Canonical helpers for Arise's date-only domain values (`YYYY-MM-DD`).
// Product-facing local calendar dates and deterministic engine/study comparisons
// are deliberately separate so timezone/DST cannot change prior-only decisions.

export const DAY_MS = 86400000;

function pad2(value){ return String(value).padStart(2, '0'); }

export function localDateISO(value = new Date()){
  const d = value instanceof Date ? value : new Date(value);
  if(Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function dateISOAtOffset(value, offsetMinutes){
  const d = value instanceof Date ? value : new Date(value);
  const offset = Number(offsetMinutes);
  if(Number.isNaN(d.getTime()) || !Number.isFinite(offset)) return '';
  const shifted = new Date(d.getTime() + offset * 60_000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

export function parseDateOnlyUTC(value){
  if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if(!Number.isFinite(ms)) return NaN;
  // Date.parse normalises some impossible dates rather than rejecting them
  // (for example 2026-02-31 -> 2026-03-03). Round-trip the calendar value so
  // date-only domain fields can never silently move to another day.
  return new Date(ms).toISOString().slice(0, 10) === value ? ms : NaN;
}

export function isDateOnly(value){
  return Number.isFinite(parseDateOnlyUTC(value));
}

export function daysBetweenDateOnly(start, end){
  const a = parseDateOnlyUTC(start);
  const b = parseDateOnlyUTC(end);
  if(!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / DAY_MS);
}

export function dateOnlyFromUTC(ms){
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}
