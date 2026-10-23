// workingWeight.js — first-session "find my working weight" maths.
//
// A lifter with no history on a loaded lift gets no prescription (the engine
// says "No history — use program prescription"), so the first set is a guess.
// This turns ONE easy trial set (load, reps, reps-in-reserve) into a starting
// load for the programme's rep range. It is an estimate from the Epley
// formula, not a measured 1RM: it is deliberately rounded DOWN onto the
// loads the kit can actually make, and it never claims more than that.
import { nearestAchievableLoad } from './plates.js';
import { equipmentForExercise } from './progression.js';

const DEFAULT_RIR = 2;       // unknown RIR is treated as "not much left": lower estimate
const TARGET_RIR = 2;        // working sets leave ~2 reps in reserve
const MAX_TRIAL_REPS = 15;   // beyond this Epley stops being a usable extrapolation

export function parseRepRange(text){
  const nums = (String(text ?? '').match(/\d+/g) || []).map(Number).filter(n => n > 0);
  if(nums.length >= 2) return [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])];
  if(nums.length === 1) return [nums[0], nums[0]];
  return [8, 12];
}

// Largest achievable load that does not exceed `rawKg` (never rounds UP).
export function snapDown(rawKg, { equipment, config } = {}){
  const near = nearestAchievableLoad(rawKg, { equipment, config: config || {} });
  if(!near) return null;
  if(near.loadKg <= rawKg + 1e-9) return near.loadKg;
  // nearest was above: step to the closest lower achievable load
  let lo = Math.max(0, rawKg - Math.max(1, near.loadKg - rawKg) * 4);
  let best = null;
  for(let kg = rawKg; kg >= lo; kg -= 0.25){
    const c = nearestAchievableLoad(kg, { equipment, config: config || {} });
    if(c && c.loadKg <= rawKg + 1e-9){ best = c.loadKg; break; }
  }
  return best;
}

// → { ok:false, reason } | { ok:true, loadKg, rawKg, e1rmKg, reps, confidence, note }
export function suggestWorkingLoad({ loadKg, reps, rir = null, targetReps = '8–12', equipment = 'machine', config = null } = {}){
  const load = Number(loadKg), r = Number(reps);
  if(!(load > 0)) return { ok: false, reason: 'Enter the weight you used.' };
  if(!(r >= 1) || !Number.isInteger(r)) return { ok: false, reason: 'Enter the reps you managed.' };
  const known = rir !== null && rir !== '' && Number.isFinite(Number(rir)) && Number(rir) >= 0;
  const reserve = known ? Math.min(Number(rir), 6) : DEFAULT_RIR;
  const [lo] = parseRepRange(targetReps);
  const toFailure = r + reserve;
  const e1rmKg = load * (1 + toFailure / 30);
  const rawKg = e1rmKg / (1 + (lo + TARGET_RIR) / 30);
  const snapped = snapDown(rawKg, { equipment, config });
  if(snapped == null || snapped <= 0) return { ok: false, reason: 'No achievable load that light on this kit — use the lightest setting.' };
  const confidence = r > MAX_TRIAL_REPS ? 'low' : (!known ? 'low' : r <= 12 ? 'medium' : 'low');
  const note = r > MAX_TRIAL_REPS
    ? 'More than 15 reps is too far from your working range to estimate well — treat this as a cautious start.'
    : known ? `Estimated from ${r} reps with ${reserve} in reserve. Adjust after set 1.`
      : `You skipped reps in reserve, so this assumes ${DEFAULT_RIR} left — a cautious start. Adjust after set 1.`;
  return { ok: true, loadKg: snapped, rawKg: Math.round(rawKg * 100) / 100, e1rmKg: Math.round(e1rmKg * 10) / 10, reps: lo, confidence, note };
}

// Which blocks should offer the finder: a loaded lift, nothing logged or typed
// yet in any set, no history of the exercise, and no load already prescribed.
export function needsWorkingWeight({ block, exercise, history = [], recommendation = null, takesLoad = false } = {}){
  if(!block || !takesLoad) return false;
  if(recommendation && Number(recommendation.load) > 0) return false;
  if((block.sets || []).some(s => s.completed || s.failed || String(s.weightKg ?? '').trim() !== '' || String(s.reps ?? '').trim() !== '')) return false;
  const id = block.exerciseId;
  const seen = (history || []).some(h => (h.blocks || []).some(b => b.exerciseId === id && (b.sets || []).some(s => Number(s.weightKg) > 0)));
  return !seen;
}
