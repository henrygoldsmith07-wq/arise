// gymMode.js — the pure logic behind Gym Mode.
//
// Gym Mode is the "one thumb, chalk on your fingers" layer over the session
// runners: big targets, quick load changes that respect the iron you actually
// have, and rest timers that manage themselves. This module holds the pure
// decisions so the components stay declarative and the behaviour is testable:
//
//   - quickJumps: the equipment-aware quick-add buttons for the load field
//     (barbells jump by plates, dumbbells by their real gaps, machines by
//     their pin increment — never an impossible number).
//   - restPresets: per-exercise rest countdowns, remembered and adjustable.
//   - skipTo: "where was chest press in this session?" for instant navigation.

import { nearestAchievableLoad, minimumAchievableJump, DEFAULT_PLATE_DENOMINATIONS_KG, DEFAULT_DUMBBELL_WEIGHTS_KG, DEFAULT_MACHINE_INCREMENT_KG } from './plates.js';
import { EXERCISE_BY_ID } from './data.js';
import { recommendNext } from './progression.js';

// The smallest real jump for a piece of equipment, derived from the plate /
// dumbbell / machine-pin configuration (falling back to the defaults). Every
// quick-add button is a multiple of this, so no button can propose a load the
// kit cannot produce.
export function equipmentIncrement({ equipment = 'barbell', config = null } = {}){
  const equip = String(equipment || '').toLowerCase();
  if(equip.includes('dumbbell')){
    const weights = (config?.dumbbellsKg?.length ? config.dumbbellsKg : DEFAULT_DUMBBELL_WEIGHTS_KG).slice().sort((a,b)=> a-b);
    const gaps = weights.slice(1).map((w,i)=> w - weights[i]);
    return gaps.length ? Math.min(...gaps) : 2.5;
  }
  if(equip.includes('machine') || equip.includes('cable')) return Number(config?.machineIncrementKg) || DEFAULT_MACHINE_INCREMENT_KG;
  const plates = (config?.platesKg?.length ? config.platesKg : DEFAULT_PLATE_DENOMINATIONS_KG).slice().sort((a,b)=> a-b);
  return plates.length ? plates[0] * 2 : 2.5; // per-side smallest plate → total jump
}

// Quick-add buttons for the load field: one and two increments up/down,
// labelled with the actual kilos. Equipment-aware by construction.
export function quickJumps({ equipment = [], supportsWeighted = true, config = null } = {}){
  if(!supportsWeighted) return [];
  const inc = equipmentIncrement({ equipment: equipment?.[0] || 'barbell', config });
  const fmt = (n)=> Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  return [
    { id: 'down2', label: `−${fmt(inc * 2)}`, delta: -inc * 2 },
    { id: 'down', label: `−${fmt(inc)}`, delta: -inc },
    { id: 'up', label: `+${fmt(inc)}`, delta: inc },
    { id: 'up2', label: `+${fmt(inc * 2)}`, delta: inc * 2 },
  ];
}

// Apply a quick jump: move by the delta, then snap to the nearest load the
// equipment can actually produce. Falls back to the un-snapped value if the
// snap helpers have no answer (unknown kit).
export function applyQuickJump(currentKg, jump, { equipment = 'barbell', config = null } = {}){
  const current = Number(currentKg) || 0;
  const raw = Math.max(0, current + jump.delta);
  try{
    // nearestAchievableLoad returns a result object ({ loadKg, exact, … }),
    // not a number — read .loadKg, never Number(result).
    const snapped = nearestAchievableLoad(raw, { equipment, config: config || {} });
    const snappedKg = snapped ? Number(snapped.loadKg) : NaN;
    if(Number.isFinite(snappedKg) && snappedKg > 0) return String(Math.round(snappedKg * 100) / 100);
  }catch{}
  return String(Math.round(raw * 100) / 100);
}

// Next/previous achievable load relative to the current one — used by the
// load stepper around the numpad. The increment is only a starting point: the
// step lands on a load the configured kit can actually produce, stepping
// further when the first candidate is impossible. Going down never dips below
// the lightest producible load (you can't unload the bar), so at the floor the
// stepper holds still.
export function adjacentLoad(currentKg, direction, { equipment = 'barbell', config = null } = {}){
  const current = Number(currentKg) || 0;
  const inc = equipmentIncrement({ equipment, config }) || 2.5;
  const up = direction >= 0;
  if(current <= 0) return up ? String(inc) : '0';
  try{
    let raw = up ? current + inc : current - inc;
    for(let i = 0; i < 60; i++){
      if(raw <= 0){
        // Below everything the kit can produce: hold at the current load
        // (the empty bar is as light as a barbell gets).
        return String(Math.round(current * 100) / 100);
      }
      const snapped = nearestAchievableLoad(raw, { equipment, config: config || {} });
      const snappedKg = snapped ? Number(snapped.loadKg) : NaN;
      if(Number.isFinite(snappedKg) && snappedKg > 0 && (up ? snappedKg > current : snappedKg < current)){
        return String(Math.round(snappedKg * 100) / 100);
      }
      raw = up ? raw + inc : raw - inc;
    }
  }catch{}
  return String(Math.round((up ? current + inc : current) * 100) / 100);
}

// ── Rest presets ────────────────────────────────────────────────────────────
// Remembered per exercise (e.g. 90s after squats, 60s after curls) so each
// block's rest button starts the countdown the user actually wants, not the
// programme's guess.

export const REST_PRESET_CHOICES = [45, 60, 90, 120, 180, 240];

export function defaultRestPreset(restSec){
  const sec = Number(restSec) || 0;
  if(sec <= 0) return null;
  return REST_PRESET_CHOICES.reduce((best, choice)=> Math.abs(choice - sec) < Math.abs(best - sec) ? choice : best, REST_PRESET_CHOICES[0]);
}

export function restPresetFor(gymPrefs, exerciseId, fallbackSec){
  const stored = Number(gymPrefs?.restPresets?.[exerciseId]);
  if(Number.isFinite(stored) && stored > 0) return stored;
  return defaultRestPreset(fallbackSec);
}

// Effort-aware rest: when the user has NOT set their own preset for a lift,
// a grind (RIR 0 / RPE >= 9.5) earns +30 s and an easy set (RIR >= 3 /
// RPE <= 6) trims 15 s (never below 45 s, never above 300 s). A remembered
// preset always wins: their choice is never overridden. Unknown effort = no change.
export function effortAdjustedRest(baseSec, { rir = null, rpe = null, reps = null, minReps = null } = {}, { hasUserPreset = false } = {}){
  const base = Math.round(Number(baseSec) || 0);
  if(base <= 0 || hasUserPreset) return base;
  // Rep shortfall (fewer reps than the bottom of the target) is a grind even
  // when RIR/RPE were not logged: +30 s, same cap as a grind.
  const repsN = reps === null || reps === '' ? NaN : Number(reps);
  const minN = minReps === null || minReps === '' ? NaN : Number(minReps);
  const noEffort = (rir === null || rir === '' || rir === undefined) && (rpe === null || rpe === '' || rpe === undefined);
  if(noEffort && Number.isFinite(repsN) && Number.isFinite(minN) && minN > 0 && repsN > 0 && repsN < minN) return Math.min(300, base + 30);
  const rirN = rir === null || rir === '' ? NaN : Number(rir);
  const rpeN = rpe === null || rpe === '' ? NaN : Number(rpe);
  let r = Number.isFinite(rirN) ? rirN : (Number.isFinite(rpeN) ? 10 - rpeN : NaN);
  if(!Number.isFinite(r)) return base;
  if(r <= 0.5) return Math.min(300, base + 30);
  if(r >= 3) return Math.max(45, base - 15);
  return base;
}

export function hasUserRestPreset(gymPrefs, exerciseId){
  const stored = Number(gymPrefs?.restPresets?.[exerciseId]);
  return Number.isFinite(stored) && stored > 0;
}

export function setRestPreset(gymPrefs, exerciseId, seconds){
  const sec = Math.max(0, Math.round(Number(seconds) || 0));
  const next = { ...(gymPrefs?.restPresets || {}) };
  if(sec <= 0) delete next[exerciseId];
  else next[exerciseId] = sec;
  return next;
}

// ── Warm-up skip memory ─────────────────────────────────────────────────────
// Remembered per lift in gymPrefs.skipWarmups ({exerciseId:true}); the runner
// drops that lift's ramp sets from the plan and the predicted session length.

export function warmupsSkipped(gymPrefs, exerciseId){
  return gymPrefs?.skipWarmups?.[exerciseId] === true;
}

export function setWarmupSkip(gymPrefs, exerciseId, skip){
  const next = { ...(gymPrefs?.skipWarmups || {}) };
  if(skip) next[exerciseId] = true;
  else delete next[exerciseId];
  return next;
}

export function effectiveWarmups(block, gymPrefs){
  if(!block || !Array.isArray(block.warmups)) return [];
  return warmupsSkipped(gymPrefs, block.exerciseId) ? [] : block.warmups;
}

// ── Skip-to navigation ──────────────────────────────────────────────────────
// One tap to jump to the first unfinished set of a named exercise — for when
// you come back from a water refill and want straight back to the rack.

export function skipTo(blocks, query){
  const q = String(query || '').trim().toLowerCase();
  if(!q) return null;
  for(let bi = 0; bi < blocks.length; bi++){
    const block = blocks[bi];
    if(!block) continue;
    // Runner blocks carry exerciseId, not name — resolve the display name so
    // "chest press" can match. Keep block.name/id matching for callers that
    // pass enriched blocks.
    const resolvedName = EXERCISE_BY_ID[block.exerciseId]?.name || '';
    const nameHit = String(block.name || resolvedName || '').toLowerCase().includes(q);
    const idHit = String(block.exerciseId || '').toLowerCase().includes(q);
    if(!nameHit && !idHit) continue;
    const si = block.sets.findIndex(s=> !s.completed && !s.skipped);
    return { blockIndex: bi, setIndex: si === -1 ? Math.max(0, block.sets.length - 1) : si };
  }
  return null;
}

// ── Session quality ─────────────────────────────────────────────────────────
// A one-tap rating captured at save time. Values are stable ids, not text, so
// analytics can group them and history can render them without parsing.
export const SESSION_QUALITY_OPTIONS = [
  { id: 'great', label: 'Great', emoji: '🔥', weight: 3 },
  { id: 'good', label: 'Good', emoji: '👍', weight: 2 },
  { id: 'ok', label: 'OK', emoji: '👌', weight: 1 },
  { id: 'rough', label: 'Rough', emoji: '😵', weight: 0 },
];

export function sessionQualityLabel(id){
  return SESSION_QUALITY_OPTIONS.find(o=> o.id === id)?.label || null;
}

// Which blocks are actually PRESENTED to the user right now. In the standard
// runner every block's target is on screen, so all indices are visible. In Gym
// Mode only the focused block is rendered (later blocks are `return null`), so
// a block's prescription must not be frozen until it becomes the focused one.
// This is the pure core of first-visible capture timing: the runner asks
// "which indices are shown?" and only freezes those.
export function visiblePrescriptionIndexes({ gymMode = false, focusIdx = 0, blockCount = 0 } = {}){
  const count = Math.max(0, Number(blockCount) || 0);
  if(!gymMode) return Array.from({ length: count }, (_, i)=> i);
  return focusIdx >= 0 && focusIdx < count ? [focusIdx] : [];
}

// ── In-session next-set advice ──────────────────────────────────────────────
// After a completed set, compare its reps with the planned range and say what
// to do with the NEXT set of the same lift. It never rewrites anything: the
// lifter taps "Use" to accept. Reps below the range floor → one increment
// lighter (a bad first set is the usual signal the opening load was too high);
// reps at/above the ceiling with room left (RIR ≥ 2, or RIR unknown →
// no bump) → one increment heavier. Failed sets count as a drop.
export function parseRepRange(reps){
  const m = String(reps ?? '').match(/(\d+)\s*[–\-]\s*(\d+)/);
  if(m) return { min: Number(m[1]), max: Number(m[2]) };
  const n = String(reps ?? '').match(/^\s*(\d+)\s*$/);
  return n ? { min: Number(n[1]), max: Number(n[1]) } : null;
}

export const COARSE_JUMP_FRACTION = 0.15;
// Indexes of every still-pending set from `fromIdx` that carries the same load
// as the set before it (i.e. not hand-edited), so one tap can move them all.
export function pendingSameLoadIndexes(block, fromIdx){
  const sets = Array.isArray(block?.sets) ? block.sets : [];
  const base = Number(sets[fromIdx]?.weightKg);
  const out = [];
  for(let i = fromIdx; i < sets.length; i++){
    const s = sets[i];
    if(s.completed || s.failed || s.skipped) break;
    if(Number(s.weightKg) !== base) break;
    out.push(i);
  }
  return out;
}
export const OVERSHOOT_REPS = 3;
export const EASY_OPENER_RIR = 4;
export function nextSetAdvice(block, { equipment = 'machine', config = null } = {}){
  const sets = Array.isArray(block?.sets) ? block.sets : [];
  const range = parseRepRange(block?.reps);
  if(!range) return null;
  const nextIdx = sets.findIndex(s => !s.completed && !s.failed);
  if(nextIdx <= 0) return null;
  const prev = sets[nextIdx - 1];
  if(!prev || !(prev.completed || prev.failed)) return null;
  const load = Number(prev.weightKg);
  if(!Number.isFinite(load) || load <= 0) return null;
  const nextLoad = Number(sets[nextIdx].weightKg);
  if(Number.isFinite(nextLoad) && nextLoad > 0 && nextLoad !== load) return null; // already adjusted by the user
  const reps = prev.failed ? 0 : Number(prev.reps);
  if(!Number.isFinite(reps)) return null;
  const rirN = prev.rir === '' || prev.rir == null ? NaN : Number(prev.rir);
  let dir = 0;
  if(reps < range.min) dir = -1;
  else if(reps >= range.max && Number.isFinite(rirN) && rirN >= 2) dir = 1;
  // Reps well past the top of the range with no effort logged: the load is
  // plainly too light (most lifters skip RIR mid-session), so offer the step up.
  else if(!Number.isFinite(rirN) && reps >= range.max + OVERSHOOT_REPS) dir = 1;
  // Opening set ground out at the rep floor with nothing left (RIR 0) and two or
  // more sets still to do: the same load will push the rest under the floor and
  // trigger stop-early. Offer one step down now to keep the work sets productive.
  else if(nextIdx === 1 && reps === range.min && rirN === 0 && sets.length - nextIdx >= 2) dir = -1;
  // Opening set mid-range but with 4+ reps in reserve: the load is far too light
  // for the target, and waiting for the top of the range wastes the remaining sets.
  else if(nextIdx === 1 && Number.isFinite(rirN) && rirN >= EASY_OPENER_RIR && reps >= range.min && sets.length - nextIdx >= 1) dir = 1;
  if(!dir) return null;
  const target = Number(adjacentLoad(load, dir, { equipment, config }));
  if(!Number.isFinite(target) || target === load || target <= 0) return null;
  // A step up bigger than COARSE_JUMP_FRACTION of the load (a 10 kg pin on a
  // 30 kg stack is +33%) would drop the next set under the rep floor: advise
  // holding the load and chasing reps instead of offering the jump.
  if(dir > 0 && (target - load) / load > COARSE_JUMP_FRACTION){
    return {
      setIndex: nextIdx,
      direction: 'hold',
      loadKg: load,
      reason: `Set ${nextIdx} hit ${reps} reps with ${rirN} left, but the next ${Math.round((target - load) * 100) / 100} kg step is a big jump on ${load} kg.`,
    };
  }
  return {
    setIndex: nextIdx,
    direction: dir < 0 ? 'down' : 'up',
    loadKg: target,
    applyIndexes: pendingSameLoadIndexes(block, nextIdx),
    reason: dir < 0 && reps === range.min && rirN === 0
      ? `Set 1 took everything for ${reps} reps. A small drop keeps the next sets in the ${range.min}–${range.max} range.`
      : dir < 0
      ? `Set ${nextIdx} gave ${reps} reps, under the ${range.min}–${range.max} range.`
      : reps < range.max && rirN >= EASY_OPENER_RIR
      ? `Set 1 gave ${reps} reps with ${rirN} left in the tank, so this load is well under what you can lift for ${range.min}–${range.max}.`
      : !Number.isFinite(rirN)
      ? `Set ${nextIdx} gave ${reps} reps, well past the top of the ${range.min}–${range.max} range.`
      : `Set ${nextIdx} hit ${reps} reps with ${rirN} left in the tank.`,
  };
}

// ── Stop-early advice ───────────────────────────────────────────────────────
// Two finished sets in a row under the rep floor (or failed) with sets still
// pending means the lift is fatigued: more junk volume costs recovery (and
// the next ride) without adding stimulus. Advice only; the lifter taps to drop
// the pending sets. Needs ≥ 2 sets already done so one bad set never triggers.
export function stopEarlyAdvice(block){
  const sets = Array.isArray(block?.sets) ? block.sets : [];
  const range = parseRepRange(block?.reps);
  if(!range) return null;
  const done = sets.filter(s => s.completed || s.failed);
  const pendingIdx = sets.map((s, i) => (!s.completed && !s.failed && !s.skipped) ? i : -1).filter(i => i >= 0);
  if(done.length < 2 || !pendingIdx.length) return null;
  const lastTwo = done.slice(-2);
  const low = s => s.failed || (s.reps != null && s.reps !== '' && Number.isFinite(Number(s.reps)) && Number(s.reps) < range.min);
  if(!lastTwo.every(low)) return null;
  // Only the tail of the list may be pending; a skipped middle set means the user is reordering.
  const lastDoneIdx = sets.lastIndexOf(lastTwo[1]);
  if(pendingIdx.some(i => i < lastDoneIdx)) return null;
  return {
    pendingIndexes: pendingIdx,
    reason: `Two sets in a row came in under ${range.min} reps. More sets now add fatigue, not much stimulus.`,
  };
}

// ── Extra-set advice ────────────────────────────────────────────────────────
// Every planned set is done, each reached the top of the rep range and the last
// one still had 3+ reps in reserve: the lift was clearly too easy for its volume.
// Offer ONE more set (capped at 4 sets) so a short plan does not waste a fresh
// session. Advice only; never fires with sets pending or unknown effort.
export const EXTRA_SET_CAP = 4;
export function extraSetAdvice(block){
  const sets = Array.isArray(block?.sets) ? block.sets : [];
  const range = parseRepRange(block?.reps);
  if(!range || range.min === range.max || sets.length < 2 || sets.length >= EXTRA_SET_CAP) return null;
  if(!sets.every(s => s.completed && !s.failed && !s.skipped)) return null;
  if(!sets.every(s => Number.isFinite(Number(s.reps)) && s.reps !== '' && Number(s.reps) >= range.max)) return null;
  const last = sets[sets.length - 1];
  const rir = last.rir === '' || last.rir == null ? NaN : Number(last.rir);
  if(!Number.isFinite(rir) || rir < 3) return null;
  return { reason: `All ${sets.length} sets hit ${range.max} reps with ${rir} left in the tank. One more set will still count.` };
}

// ── Back-off set advice ─────────────────────────────────────────────────────
// The final planned set was failed (or ground out under the rep floor) and
// nothing is pending: offer ONE extra set ~10% lighter, snapped to a load the
// equipment can actually be set to, so the lift ends on a productive set
// instead of a miss. Never offers a set at the same load, never past the cap.
export const BACKOFF_FRACTION = 0.10;
export function backoffSetAdvice(block, { equipment = 'machine', config = null } = {}){
  const sets = Array.isArray(block?.sets) ? block.sets : [];
  const range = parseRepRange(block?.reps);
  if(!range || sets.length < 2 || sets.length >= EXTRA_SET_CAP) return null;
  if(sets.some(s => !s.completed && !s.failed && !s.skipped)) return null;
  const last = sets[sets.length - 1];
  if(!last || last.skipped || !(last.completed || last.failed)) return null;
  const reps = last.failed ? 0 : (last.reps === '' || last.reps == null ? NaN : Number(last.reps));
  if(!Number.isFinite(reps) || reps >= range.min) return null;
  const load = Number(last.weightKg);
  if(!Number.isFinite(load) || load <= 0) return null;
  let target = NaN;
  try{ target = Number(nearestAchievableLoad(load * (1 - BACKOFF_FRACTION), { equipment, config: config || {} })?.loadKg); }catch{}
  if(!Number.isFinite(target) || target <= 0) target = Math.round(load * (1 - BACKOFF_FRACTION) * 2) / 2;
  if(target >= load){
    const down = Number(adjacentLoad(load, -1, { equipment, config }));
    if(!Number.isFinite(down) || down <= 0 || down >= load) return null;
    target = down;
  }
  return { loadKg: target, reason: `The last set ${last.failed ? 'was missed' : `gave ${reps} reps`}. One lighter set at ${target} kg ends the lift on a good one.` };
}

// ── Longer-rest advice ──────────────────────────────────────────────────────
// Reps fell by 3+ between the last two finished sets while sets remain and the
// lift runs on a short rest the lifter never chose: under-recovery is the likely
// cause. Offer to remember a rest one preset longer (max 180 s) for this lift.
// Never fires when the lifter already set their own preset or the rest is ≥ 150 s.
export const REST_DROP_REPS = 3;
export function longerRestAdvice(block, { restSec = null, hasUserPreset = false } = {}){
  if(hasUserPreset) return null;
  const rest = Number(restSec ?? block?.restSec);
  if(!Number.isFinite(rest) || rest <= 0 || rest >= 150) return null;
  const sets = Array.isArray(block?.sets) ? block.sets : [];
  const done = sets.filter(s => s.completed && !s.failed);
  if(done.length < 2 || !sets.some(s => !s.completed && !s.failed && !s.skipped)) return null;
  const [a, b] = done.slice(-2).map(s => (s.reps === '' || s.reps == null) ? NaN : Number(s.reps));
  if(!Number.isFinite(a) || !Number.isFinite(b) || a - b < REST_DROP_REPS) return null;
  const seconds = REST_PRESET_CHOICES.find(c => c >= rest + 30 && c <= 180);
  if(!seconds) return null;
  return { seconds, reason: `Reps fell from ${a} to ${b} on ${Math.round(rest)} s rest. A little longer between sets usually holds the reps up.` };
}

// ── Shorter-rest advice ─────────────────────────────────────────────────────
// The mirror of longerRestAdvice: the last two finished sets held the same reps
// (within 1), both left 3+ in reserve, sets remain and the lift runs on a long
// rest (≥ 150 s) the lifter never chose. Recovery is not the limiter, so offer
// to remember a rest one preset shorter (never under 90 s) and save session time.
export const SHORT_REST_MIN_RIR = 3;
export function shorterRestAdvice(block, { restSec = null, hasUserPreset = false } = {}){
  if(hasUserPreset) return null;
  const rest = Number(restSec ?? block?.restSec);
  if(!Number.isFinite(rest) || rest < 150) return null;
  const sets = Array.isArray(block?.sets) ? block.sets : [];
  const done = sets.filter(s => s.completed && !s.failed);
  if(done.length < 2 || !sets.some(s => !s.completed && !s.failed && !s.skipped)) return null;
  const last = done.slice(-2);
  const reps = last.map(s => (s.reps === '' || s.reps == null) ? NaN : Number(s.reps));
  const rirs = last.map(s => (s.rir === '' || s.rir == null) ? NaN : Number(s.rir));
  if(reps.some(r => !Number.isFinite(r)) || rirs.some(r => !Number.isFinite(r) || r < SHORT_REST_MIN_RIR)) return null;
  if(Math.abs(reps[0] - reps[1]) > 1) return null;
  const seconds = [...REST_PRESET_CHOICES].reverse().find(c => c <= rest - 30 && c >= 90);
  if(!seconds) return null;
  return { seconds, reason: `Both sets held ${reps[1]} reps with ${rirs[1]} left on ${Math.round(rest)} s rest. You can rest a bit less and finish sooner.` };
}

// ── "Next time" preview ─────────────────────────────────────────────────────
// Once every set of a lift is done, show what the engine will prescribe next
// session, computed from history plus this just-finished block. Advice only;
// null while sets are pending, nothing logged, or the engine has no load.
export function nextTimePreview(block, { exerciseId, history = [], dateISO = null, plateConfig = null, config = null } = {}){
  const sets = Array.isArray(block?.sets) ? block.sets : [];
  const finished = sets.filter(s => s.completed && !s.failed && Number(s.reps) > 0);
  if(!exerciseId || !sets.length || !finished.length) return null;
  if(sets.some(s => !s.completed && !s.failed && !s.skipped)) return null;
  const entry = { dateISO: dateISO || new Date().toISOString().slice(0, 10), blocks: [{ exerciseId, sets: finished.map(s => ({ reps: String(s.reps), weightKg: s.weightKg ?? '', rpe: s.rpe ?? '', rir: s.rir ?? '' })) }] };
  let rec;
  try{ rec = recommendNext({ exerciseId, history: [...history, entry], targetReps: block.reps || null, plateConfig, config }); }catch{ return null; }
  if(!rec || !(Number(rec.reps) > 0)) return null;
  const load = Number(rec.load);
  const label = load > 0 ? `${load} kg × ${rec.reps}` : `${rec.reps} reps`;
  return { load: load > 0 ? load : null, reps: Number(rec.reps), label, reason: rec.reason || '' };
}
