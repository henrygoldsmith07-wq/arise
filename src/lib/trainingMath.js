// trainingMath.js — the ONE place Arise computes Epley 1RM and rep parsing.
//
// WHY THIS EXISTS
// ---------------
// These two formulas were reimplemented per module: eight copies of the
// "first number in a possibly-string rep value" scan (backtesting,
// longitudinalCore, performance, programming, progressionModel,
// realWorldValidation, study — plus schedule.js, which is a DIFFERENT function
// that returns a string and is deliberately NOT here), and the Epley formula
// itself in three function definitions (progression.js, performance.js,
// longitudinalCore.js) plus eight inline copies (analytics.js, printReport.js,
// safety.js ×2, store.js ×2 and the three functions above).
//
// The copies had already drifted: some parsed decimals and some did not
// (`programming.js` read "8.5" as 8), some returned 0 and some null for an
// unusable value, and `realWorldValidation.js` had grown its own number
// passthrough. A drifted 1RM is not a cosmetic bug — it is the input to every
// load recommendation, PR classification and strength trend, so two modules
// could legitimately disagree about whether the same logged set was a PR.
//
// Everything now routes through here. One formula, one contract, one place to
// audit.

// Extract the leading number from a rep value that may be a string.
//
// Logged and prescribed reps arrive as many shapes: 8, "8", "8-10", "8–10"
// (en dash), "AMRAP", "", null. The engine's convention everywhere is "the
// number you can actually count", so this returns the FIRST number found and
// 0 when there is none — never null, never NaN, never a negative.
//
// Decimals are preserved ("8.5" → 8.5): partial rep credit is real data, and
// truncating it silently under-counts volume on assisted and tempo work. A
// negative or non-finite number is impossible as a rep count, so it is 0 — the
// same answer the string path gives for "-5" (the regex has no sign, so it
// reads the digits, and a leading minus is not a rep count).
export function parseReps(value){
  if(value == null || value === '') return 0;
  if(typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0;
  const match = String(value).match(/\d+(?:\.\d+)?/);
  if(!match) return 0;
  const n = Number(match[0]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Epley estimated 1RM. Returns 0 when either input is missing or unusable,
// which is the engine's sentinel (falsy = "cannot estimate", so callers can use
// `e1rm(...) || reps` without a separate null check).
export function e1rm(weightKg, reps){
  const w = Number(weightKg);
  const r = parseReps(reps);
  if(!(w > 0 && r > 0)) return 0;
  return w * (1 + r / 30);
}

// Inverse of e1rm: the load that produces `e1rmVal` for `reps` reps. Used to
// convert a carried working-set target onto a substituted exercise's rep range.
export function epleyToLoad(e1rmVal, reps){
  const r = parseReps(reps);
  if(!(r > 0)) return 0;
  return Number(e1rmVal) / (1 + r / 30);
}
