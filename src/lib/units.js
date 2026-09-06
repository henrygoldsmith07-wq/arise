// units.js — display-side weight localization.
//
// The canonical store, engine, and progression math are ALL in kilograms —
// changing that would corrupt every historical comparison. This module localizes
// the READ side only: what the user sees in Progress and summaries. Logging
// inputs remain kg (documented limitation; a full lb input mode needs its own
// migration round).
//
//   fmtWeight(102.5, 'lb') → "225.5 lb"
//   fmtWeight(102.5, 'kg') → "102.5 kg"
//   fmtWeight(null, 'lb')  → "—"

export const LB_PER_KG = 2.2046226218;

export function kgToLb(kg){
  return Number(kg) * LB_PER_KG;
}

export function lbToKg(lb){
  return Number(lb) / LB_PER_KG;
}

/**
 * Format a canonical kg value for display in the user's unit preference.
 * Rounds to one decimal (plate precision), trims a trailing .0.
 */
export function fmtWeight(kg, units = 'kg'){
  // Careful: Number(null) === 0 and Number('') === 0 — missing data must
  // render as an em dash, never as a legitimate zero.
  if(kg === null || kg === undefined || kg === '') return '—';
  const n = Number(kg);
  if(!Number.isFinite(n)) return '—';
  const shown = units === 'lb' ? kgToLb(n) : n;
  const rounded = Math.round(shown * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${units}`;
}
