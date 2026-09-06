// units.ts — display-side weight localization.
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
