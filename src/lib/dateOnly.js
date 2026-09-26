// Canonical date-only helpers.
//
// Training dates are calendar dates, not UTC instants. Converting an instant
// with toISOString().slice(0, 10) can move a workout onto the previous/next
// local day around midnight. Use localDateISO() whenever the product means
// "today" on the user's calendar.

function pad2(value){ return String(value).padStart(2, '0'); }

export function localDateISO(value = new Date()){
  const d = value instanceof Date ? value : new Date(value);
  if(Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Deterministic companion used by tests and any code that already knows the
// target UTC offset. offsetMinutes follows ISO convention: local = UTC + offset.
export function dateISOAtOffset(value, offsetMinutes){
  const d = value instanceof Date ? value : new Date(value);
  const offset = Number(offsetMinutes);
  if(Number.isNaN(d.getTime()) || !Number.isFinite(offset)) return '';
  const shifted = new Date(d.getTime() + offset * 60_000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}
