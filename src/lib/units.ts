// units.ts — display-side weight localization.
//
// The canonical store, engine, and progression math are ALL in kilograms —
// changing that would corrupt every historical comparison. This module localizes
// the UI boundary only: what the user sees and enters. Canonical storage stays
// kg, so changing display units never rewrites history or changes engine math.
//
//   fmtWeight(102.5, 'lb') → "225.5 lb"
//   fmtWeight(102.5, 'kg') → "102.5 kg"
//   fmtWeight(null, 'lb')  → "—"
//
// TypeScript notes: the first strict-TS slice (Z step 9 — see ADR 0010).
// `Unit` is a branded string union so a raw user preference string cannot
// reach the formatter un-checked; call sites pass `units === 'lb' ? 'lb' : 'kg'`.

export const LB_PER_KG = 2.2046226218;

export type Unit = 'kg' | 'lb';

export interface WeightLike {
  weightKg?: number | string | null;
}

export function kgToLb(kg: number): number {
  return kg * LB_PER_KG;
}

export function lbToKg(lb: number): number {
  return lb / LB_PER_KG;
}

/** Narrow an arbitrary preference value to a Unit (defaults to 'kg'). */
export function asUnit(value: unknown): Unit {
  return value === 'lb' ? 'lb' : 'kg';
}

/**
 * Format a canonical kg value for display in the user's unit preference.
 * Rounds to one decimal (plate precision), trims a trailing .0.
 */
export function fmtWeight(kg: number | string | null | undefined, units: Unit = 'kg'): string {
  // Careful: Number(null) === 0 and Number('') === 0 — missing data must
  // render as an em dash, never as a legitimate zero.
  if (kg === null || kg === undefined || kg === '') return '—';
  const n = Number(kg);
  if (!Number.isFinite(n)) return '—';
  const shown = units === 'lb' ? kgToLb(n) : n;
  const rounded = Math.round(shown * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${units}`;
}


/**
 * Convert a canonical kg value into the bare number shown in an editable
 * weight field. Two decimals are enough to round-trip normal gym loads while
 * avoiding long floating-point tails in lb mode.
 */
export function weightInputValue(kg: number | string | null | undefined, units: Unit = 'kg'): string {
  if (kg === null || kg === undefined || kg === '') return '';
  const n = Number(kg);
  if (!Number.isFinite(n)) return '';
  const shown = units === 'lb' ? kgToLb(n) : n;
  return String(Math.round(shown * 100) / 100);
}

/**
 * Convert a user-entered display-unit value back to canonical kg text.
 * kg input is preserved exactly; lb input is normalised to 5 decimals so a
 * display → store → display round-trip remains stable without noisy tails.
 */
export function weightInputToKg(value: number | string | null | undefined, units: Unit = 'kg'): string {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (text === '') return '';
  const n = Number(text);
  if (!Number.isFinite(n)) return '';
  if (units === 'kg') return text;
  const kg = lbToKg(n);
  return String(Math.round(kg * 100000) / 100000);
}
