// longitudinalCore.js � shared constants and helpers for the evaluation
// ledger (ADR 0007). Split from longitudinal.js so the pure aggregation in
// evaluation.js can import these without touching storage or consent logic.

export const EVALUATION_SCHEMA_VERSION = 2;

// ── Statistics helpers ──────────────────────────────────────────────────
// Wilson score interval: honest uncertainty for proportion estimates even at
// small n (a 3/3 rate must NOT read as "certainly 100%").
export function wilsonInterval(successes, n, z = 1.96){
  const s = Number(successes), total = Number(n);
  if(!total || total < 0 || s < 0 || s > total) return null;
  const p = s / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denom;
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / denom) / denom;
  return {
    low: round(Math.max(0, centre - spread), 3),
    high: round(Math.min(1, centre + spread), 3),
  };
}

// Flag an open recommendation as overridden by the user (they edited targets
// away from the engine's prescription before logging). Studies can then
// separate "engine decided" transitions from "user decided" ones.

export const EVALUATION_KEY = 'arise.evaluation.v1';

const SCALE = 100;

export function round(value, digits = 3){
  if(!Number.isFinite(Number(value))) return null;
  const p = 10 ** digits;
  return Math.round(Number(value) * p) / p;
}

export function parseReps(value){
  const match = String(value ?? '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

export function e1rm(weightKg, reps){
  const w = Number(weightKg) || 0;
  const r = parseReps(reps);
  return w > 0 && r > 0 ? w * (1 + r / 30) : 0;
}

export function hasConsent(preferences){
  return preferences?.telemetryEnabled === true;
}



export function bestSetOfBlock(block){
  let best = null;
  for(const set of block?.sets || []){
    const reps = parseReps(set.reps);
    const weightKg = Number(set.weightKg) || 0;
    const score = e1rm(weightKg, reps) || reps;
    if(reps > 0 && (!best || score > best.score)){
      best = { reps, weightKg, assistedKg: Number(set.assistedKg) || 0, rpe: set.rpe ?? null, score };
    }
  }
  return best;
}
