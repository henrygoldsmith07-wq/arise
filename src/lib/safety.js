// safety.js — training-safety detection layer.
//
// Pure, deterministic reads over history/readiness the user already owns.
// Every check returns null (no signal) or a warning object:
//   { id, severity: 'info'|'caution'|'stop', title, detail, action? }
// The UI renders them verbatim; the ENGINE never reads this module — safety
// messaging informs the lifter, it does not silently override the
// progression policy. The one applied exception is pain aftercare: after a
// painful session on an exercise, the runner shows a conservative target for
// the NEXT exposure of that exercise (see painAftercareFor).
//
// All thresholds live in SAFETY_CONFIG so future "cautious mode" or user
// tuning adjusts one object. Weeks are calendar buckets by dateISO.

// ── Tunables ──────────────────────────────────────────────────────────────
export const SAFETY_CONFIG = {
  // Pain: two painful exposures of the same exercise within this window
  // (days) escalate from a per-session note to a pattern warning.
  painPatternDays: 21,
  // Volume: week-over-week increase beyond this fraction is a spike.
  volumeJumpPct: 0.25,
  // Load: session-best e1RM jump beyond this fraction over the prior best.
  loadJumpPct: 0.15,
  // PR: an e1RM "PR" this far above the recent best is more likely noise
  // (rig setup, ROM change, miscount) than a real gain — flag, don't celebrate.
  prUnrealisticPct: 0.20,
  // Failure: this many failed sets of the same exercise in a rolling window
  // is a pattern, not a bad day.
  failedRepCount: 3,
  failedRepWindowDays: 28,
  // Recovery: readiness below this (or this many deficit days in a row)
  // raises the recovery-deficit flag.
  readinessDeficitScore: 4,
  readinessDeficitDays: 3,
  // Deload prompt: weekly volume above this multiple of the 4-week average.
  deloadVolumeMultiple: 1.35,
  // Break lengths (days) that switch the next session to conservative mode.
  longBreakDays: 14,
  illnessBreakDays: 7,
  // Maximum-intensity warning fires when the target set lands within this
  // many RIR of failure.
  maxEffortRir: 1,
};

const dayMs = 86_400_000;
const toTime = (iso) => Date.parse(`${iso}T00:00:00Z`) || 0;

function sessionDate(h){ return h?.dateISO || (h?.savedAt || '').slice(0, 10); }

/** All sets of a session, flattened, tagged with their exercise. */
function setsOf(h){
  const out = [];
  for(const b of h?.blocks || []){
    for(const s of b?.sets || []){
      if(s?.skipped) continue;
      out.push({ exerciseId: b.exerciseId, set: s });
    }
  }
  return out;
}

function parseNum(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

/** Most recent sets logged for one exercise, newest session first. */
function lastExerciseSetsFor(exerciseId, history){
  const sorted = [...(history || [])]
    .filter(h => (h?.blocks || []).some(b => b?.exerciseId === exerciseId))
    .sort((a, b) => sessionDate(b).localeCompare(sessionDate(a)));
  for(const h of sorted){
    const block = h.blocks.find(b => b?.exerciseId === exerciseId);
    const sets = (block?.sets || []).filter(s => !s?.skipped);
    if(sets.length) return sets.map(s => ({ ...s, date: sessionDate(h) }));
  }
  return null;
}

/** Session volume in kg (reps × load, assisted credit like SessionRunner). */
export function sessionVolumeKg(h){
  let total = 0;
  for(const { set: s } of setsOf(h)){
    total += parseNum(s.reps) * Math.max(0, parseNum(s.weightKg) - parseNum(s.assistedKg));
  }
  return total;
}

/** Best e1RM within one session (0 if none). */
export function sessionBestE1rm(h){
  let best = 0;
  for(const { set: s } of setsOf(h)){
    const w = parseNum(s.weightKg) - parseNum(s.assistedKg);
    const r = parseNum(s.reps);
    if(w > 0 && r > 0) best = Math.max(best, w * (1 + r / 30));
  }
  return best;
}

// ── Weekly volume buckets ─────────────────────────────────────────────────
export function weeklyVolumes(history, { today = null } = {}){
  const weeks = new Map();
  for(const h of history || []){
    const t = toTime(sessionDate(h));
    if(!t) continue;
    const monday = new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * dayMs);
    const key = monday.toISOString().slice(0, 10);
    weeks.set(key, (weeks.get(key) || 0) + sessionVolumeKg(h));
  }
  return [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, vol]) => ({ week, vol }));
}

// ── Pain trend ────────────────────────────────────────────────────────────
/** Painful exposures per exercise, most recent first. */
export function painByExercise(history, { today = null } = {}){
  const byExercise = new Map();
  for(const h of history || []){
    for(const { exerciseId, set: s } of setsOf(h)){
      if(!s.pain && !h.painDiscomfort) continue;
      const list = byExercise.get(exerciseId) || [];
      list.push(sessionDate(h));
      byExercise.set(exerciseId, list);
    }
  }
  for(const list of byExercise.values()) list.sort().reverse();
  return byExercise;
}

/**
 * Pain pattern warning: N+ painful exposures of one exercise within
 * `painPatternDays` (two by default). Exercise-specific by design —
 * "knee hurts on split squats" is actionable; "pain happened" is not.
 */
export function painTrendWarnings(history, { today = null, config = SAFETY_CONFIG } = {}){
  const cfg = { ...SAFETY_CONFIG, ...config };
  const out = [];
  for(const [exerciseId, dates] of painByExercise(history)){
    if(dates.length < 2) continue;
    const [latest, prior] = dates;
    if(toTime(latest) - toTime(prior) > cfg.painPatternDays * dayMs) continue;
    out.push({
      id: `pain-pattern:${exerciseId}`,
      severity: 'caution',
      exerciseId,
      title: `Recurring pain with ${exerciseId.replace(/-/g, ' ')}`,
      detail: `${dates.length} painful sessions within ${cfg.painPatternDays} days, most recently ${latest}. Repeated pain on the same movement is a load, range, or technique signal — not soreness.`,
      action: 'Swap to a joint-friendly alternative or drop the load until both are comfortable.',
    });
  }
  return out;
}

/** Aftercare advice for the next exposure after a painful session. */
export function painAftercareFor(exerciseId, history, { today = null, config = SAFETY_CONFIG } = {}){
  const cfg = { ...SAFETY_CONFIG, ...config };
  const dates = painByExercise(history).get(exerciseId) || [];
  const latest = dates[0];
  if(!latest) return null;
  // Aftercare window: 14 days since the painful exposure.
  if(!today || toTime(today) - toTime(latest) > 14 * dayMs) return null;
  return {
    exerciseId,
    lastPainDate: latest,
    message: `Last exposure (${latest}) was flagged painful. Today: reduce load ~10% or cut one set — quality reps over load. Stop the set if it returns.`,
  };
}

// ── Volume / load / fatigue / PR checks ───────────────────────────────────
export function volumeJumpWarnings(history, { today = null, config = SAFETY_CONFIG } = {}){
  const cfg = { ...SAFETY_CONFIG, ...config };
  const weeks = weeklyVolumes(history);
  if(weeks.length < 2) return [];
  const out = [];
  for(let i = 1; i < weeks.length; i++){
    const prev = weeks[i - 1].vol, cur = weeks[i].vol;
    if(prev > 0 && (cur - prev) / prev > cfg.volumeJumpPct){
      out.push({
        id: `volume-jump:${weeks[i].week}`,
        severity: 'caution',
        title: `Weekly volume jumped ${Math.round((cur / prev - 1) * 100)}%`,
        detail: `Week of ${weeks[i].week}: ${Math.round(cur).toLocaleString()} kg vs ${Math.round(prev).toLocaleString()} kg the week before. Rapid volume spikes are the classic overuse-injury setup.`,
        action: 'Hold volume steady for a week before adding more.',
      });
    }
  }
  return out;
}

export function loadJumpWarnings(history, { today = null, config = SAFETY_CONFIG } = {}){
  const cfg = { ...SAFETY_CONFIG, ...config };
  const out = [];
  const byExercise = new Map();
  for(const h of history || []){
    const best = sessionBestE1rm(h);
    if(best <= 0) continue;
    for(const { exerciseId } of setsOf(h)){
      const list = byExercise.get(exerciseId) || [];
      list.push({ date: sessionDate(h), best });
      byExercise.set(exerciseId, list);
    }
  }
  for(const [exerciseId, entries] of byExercise){
    const sorted = entries.sort((a, b) => a.date.localeCompare(b.date));
    for(let i = 1; i < sorted.length; i++){
      const prev = sorted[i - 1].best, cur = sorted[i].best;
      if(prev > 0 && (cur - prev) / prev > cfg.loadJumpPct){
        out.push({
          id: `load-jump:${exerciseId}:${sorted[i].date}`,
          severity: 'caution',
          exerciseId,
          title: `Big e1RM jump on ${exerciseId.replace(/-/g, ' ')}`,
          detail: `Best e1RM moved from ${Math.round(prev)} to ${Math.round(cur)} kg around ${sorted[i].date} — more than ${Math.round(cfg.loadJumpPct * 100)}% in a step.`,
          action: 'Verify the reps were full-depth and counted honestly before locking in the new load.',
        });
      }
    }
  }
  return out;
}

export function unrealisticPrWarnings(history, { today = null, config = SAFETY_CONFIG } = {}){
  const cfg = { ...SAFETY_CONFIG, ...config };
  const out = [];
  const byExercise = new Map();
  for(const h of history || []){
    for(const { exerciseId, set: s } of setsOf(h)){
      const w = parseNum(s.weightKg) - parseNum(s.assistedKg);
      const r = parseNum(s.reps);
      if(w <= 0 || r <= 0) continue;
      const list = byExercise.get(exerciseId) || [];
      list.push({ date: sessionDate(h), e1rm: w * (1 + r / 30) });
      byExercise.set(exerciseId, list);
    }
  }
  for(const [exerciseId, entries] of byExercise){
    const sorted = entries.sort((a, b) => a.date.localeCompare(b.date) || a.e1rm - b.e1rm);
    for(let i = 1; i < sorted.length; i++){
      const priorBest = Math.max(...sorted.slice(0, i).map(e => e.e1rm));
      if(priorBest > 0 && (sorted[i].e1rm - priorBest) / priorBest > cfg.prUnrealisticPct){
        out.push({
          id: `pr-unrealistic:${exerciseId}:${sorted[i].date}`,
          severity: 'caution',
          exerciseId,
          title: `Implausible PR on ${exerciseId.replace(/-/g, ' ')} — check before celebrating`,
          detail: `${Math.round(sorted[i].e1rm)} kg e1RM on ${sorted[i].date} is ${Math.round((sorted[i].e1rm / priorBest - 1) * 100)}% above your prior best. Realistic monthly gains are a few percent.`,
          action: 'Common causes: partial reps, a spotter helping, different machine, or a miscount.',
        });
        break; // one flag per exercise is enough
      }
    }
  }
  return out;
}

export function failedRepWarnings(history, { today = null, config = SAFETY_CONFIG } = {}){
  const cfg = { ...SAFETY_CONFIG, ...config };
  const out = [];
  const byExercise = new Map();
  for(const h of history || []){
    for(const { exerciseId, set: s } of setsOf(h)){
      if(!s.failed) continue;
      const list = byExercise.get(exerciseId) || [];
      list.push(sessionDate(h));
      byExercise.set(exerciseId, list);
    }
  }
  for(const [exerciseId, dates] of byExercise){
    if(dates.length < cfg.failedRepCount) continue;
    const recent = dates.sort().slice(-cfg.failedRepCount);
    if(toTime(recent[recent.length - 1]) - toTime(recent[0]) > cfg.failedRepWindowDays * dayMs) continue;
    out.push({
      id: `failed-reps:${exerciseId}`,
      severity: 'caution',
      exerciseId,
      title: `Repeated missed reps on ${exerciseId.replace(/-/g, ' ')}`,
      detail: `${dates.length} failed sets across ${cfg.failedRepWindowDays} days. The current load or weekly dose is ahead of recovery.`,
      action: 'Drop the working load ~5–10% or cut a set; rebuild with clean reps.',
    });
  }
  return out;
}

export function recoveryDeficitWarnings(history, readinessLog = [], { today = null, config = SAFETY_CONFIG } = {}){
  const cfg = { ...SAFETY_CONFIG, ...config };
  const sorted = [...(readinessLog || [])].filter(r => r?.dateISO && r?.score != null).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const recent = sorted.slice(-cfg.readinessDeficitDays);
  if(recent.length < cfg.readinessDeficitDays) return [];
  const allLow = recent.every(r => Number(r.score) <= cfg.readinessDeficitScore);
  if(!allLow) return [];
  return [{
    id: `recovery-deficit:${recent[recent.length - 1].dateISO}`,
    severity: 'caution',
    title: 'Recovery running a deficit',
    detail: `Readiness ≤ ${cfg.readinessDeficitScore} for ${recent.length} days in a row. Training hard on top of this is where sessions stall and form slips.`,
    action: 'Consider a lighter session, extra sleep, or a rest day — consistency survives a step back.',
  }];
}

export function excessiveFatigueWarnings(history, readinessLog = [], { today = null, config = SAFETY_CONFIG } = {}){
  // Fatigue = recovery deficit + rising RPE on recent sessions.
  const cfg = { ...SAFETY_CONFIG, ...config };
  const deficits = recoveryDeficitWarnings(history, readinessLog, { today, config });
  const recentRpe = [];
  for(const h of [...(history || [])].sort((a, b) => sessionDate(a).localeCompare(sessionDate(b))).slice(-3)){
    const rpes = setsOf(h).map(({ set: s }) => parseNum(s.rpe)).filter(n => n > 0);
    if(rpes.length) recentRpe.push(rpes.reduce((a, b) => a + b, 0) / rpes.length);
  }
  const rpeHigh = recentRpe.length >= 2 && recentRpe.every(r => r >= 8.5);
  if(!(deficits.length && rpeHigh)) return [];
  return [{
    id: 'excessive-fatigue',
    severity: 'stop',
    title: 'Fatigue is stacking up',
    detail: 'Low readiness for several days AND every recent session at RPE 8.5+. This combination predicts failed reps, form breakdown, or illness within the week.',
    action: 'Take a deload week or two full rest days now — not after the next failed session.',
  }];
}

// ── Deload / restart / break advice ───────────────────────────────────────
export function deloadSafetyPrompt(history, { today = null, config = SAFETY_CONFIG } = {}){
  const cfg = { ...SAFETY_CONFIG, ...config };
  const weeks = weeklyVolumes(history);
  // Needs a current week plus a full 3-week baseline to compare against.
  if(weeks.length < 4) return null;
  const recent = weeks.slice(-4);
  const avg = recent.slice(0, 3).reduce((a, w) => a + w.vol, 0) / 3;
  const current = recent[3].vol;
  if(avg <= 0 || current / avg < cfg.deloadVolumeMultiple) return null;
  return {
    id: `deload-prompt:${recent[3].week}`,
    severity: 'info',
    title: 'Volume is running hot — consider scheduling a deload',
    detail: `This week is ${Math.round(current / avg * 100)}% of your 3-week average. Planned deloads protect the next block; unplanned ones follow a failed session.`,
    action: 'Cut sets ~40% next week, keep loads, then resume.',
  };
}

/**
 * Conservative restart advice after a layoff. `reason` may be 'break',
 * 'illness' or 'injury' (illness/injury use a shorter threshold and softer
 * language). Returns null when no restart ramp applies.
 */
export function restartAdvice(history, { today = null, reason = 'break', config = SAFETY_CONFIG } = {}){
  const cfg = { ...SAFETY_CONFIG, ...config };
  const anchor = today || new Date().toISOString().slice(0, 10);
  const sorted = [...(history || [])].sort((a, b) => sessionDate(b).localeCompare(sessionDate(a)));
  const last = sorted[0];
  if(!last) return null;
  const gapDays = Math.floor((toTime(anchor) - toTime(sessionDate(last))) / dayMs);
  const threshold = reason === 'break' ? cfg.longBreakDays : cfg.illnessBreakDays;
  if(gapDays < threshold) return null;
  const loadFactor = reason === 'break' ? 0.85 : 0.75;
  const rampWeeks = reason === 'break' ? 1 : 2;
  return {
    id: `restart:${reason}`,
    severity: 'info',
    gapDays,
    loadFactor,
    rampWeeks,
    title: reason === 'break'
      ? `${gapDays} days off — start at ${Math.round((1 - loadFactor) * 100)}% below your old loads`
      : `${gapDays} days since training while ill/injured — restart gently`,
    detail: reason === 'break'
      ? 'Strength holds better than it feels; skill and work capacity fade first. One conservative session rebuilds both faster than forcing old loads.'
      : 'After illness or injury the engine drops your suggested loads; treat the first week back as practice, not testing.',
    action: reason === 'break'
      ? `First session: ~${Math.round(loadFactor * 100)}% of previous loads, same reps. Add ~5% per week until back.`
      : `First ${rampWeeks} week${rampWeeks === 1 ? '' : 's'}: ~${Math.round(loadFactor * 100)}% of previous loads, stop sets 3+ RIR from failure.`,
  };
}

// ── Aggregated panel ──────────────────────────────────────────────────────
/**
 * All safety signals for the Progress/Today panel. `opts.cautious` lowers
 * thresholds (~25%) so cautious-mode users see signals earlier.
 */
export function safetyPanel(history, readinessLog = [], { today = null, cautious = false } = {}){
  const config = cautious
    ? {
        ...SAFETY_CONFIG,
        volumeJumpPct: SAFETY_CONFIG.volumeJumpPct * 0.75,
        loadJumpPct: SAFETY_CONFIG.loadJumpPct * 0.75,
        prUnrealisticPct: SAFETY_CONFIG.prUnrealisticPct * 0.75,
        failedRepCount: Math.max(2, SAFETY_CONFIG.failedRepCount - 1),
        readinessDeficitScore: SAFETY_CONFIG.readinessDeficitScore + 1,
      }
    : SAFETY_CONFIG;
  const opts = { today, config };
  const warnings = [
    ...painTrendWarnings(history, opts),
    ...volumeJumpWarnings(history, opts),
    ...loadJumpWarnings(history, opts),
    ...unrealisticPrWarnings(history, opts),
    ...failedRepWarnings(history, opts),
    ...recoveryDeficitWarnings(history, readinessLog, opts),
    ...excessiveFatigueWarnings(history, readinessLog, opts),
  ];
  const order = { stop: 0, caution: 1, info: 2 };
  warnings.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    warnings,
    deloadPrompt: deloadSafetyPrompt(history, opts),
    restart: restartAdvice(history, { today, reason: 'break', config }),
  };
}

// ── Technique prompts ─────────────────────────────────────────────────────
/**
 * Technique/ROM prompt for a block about to be trained. Fires when the last
 * logged sets carried a technique or ROM quality note — a cue to perform the
 * movement deliberately, at the moment it can still change the set.
 */
export function techniquePromptFor(exerciseId, history){
  const sets = lastExerciseSetsFor(exerciseId, history) || [];
  // Most informative set wins: one with a rom value, else one with a note.
  const last = sets.find(s => String(s.rom || '').trim() !== '') || sets.find(s => String(s.note || '').trim() !== '');
  if(!last) return null;
  const rom = String(last.rom || '').trim().toLowerCase();
  const note = String(last.note || '').trim().toLowerCase();
  const quality = [rom, note].filter(Boolean).join(' ');
  const flagged = /(shallow|partial|half|cut|short|sloppy|rushed|cheat|bounce)/.test(quality);
  if(!rom && !note) return null;
  if(rom === 'full' && !flagged) return null;
  if(!flagged && ['good', 'great', 'solid', 'clean', 'deep'].some(w => quality.includes(w))) return null;
  return {
    exerciseId,
    lastDate: last.date,
    message: `Last time (${last.date}) you noted ${rom ? `range: ${rom}` : 'technique'}${note && rom ? ' · ' : ''}${note || ''}. Cue up: control the descent, full range, no bounce.`,
  };
}

// ── Per-session UX toggles ────────────────────────────────────────────────
/** Maximum-effort warning for a target set, if the toggle is enabled. */
export function maxEffortWarning(targetRir, { enabled = true, config = SAFETY_CONFIG } = {}){
  const cfg = { ...SAFETY_CONFIG, ...config };
  if(!enabled) return null;
  if(targetRir == null || String(targetRir).trim() === '') return null; // no data, no warning
  const rir = Number(targetRir);
  if(!Number.isFinite(rir) || rir > cfg.maxEffortRir) return null;
  return {
    id: 'max-effort',
    severity: 'caution',
    title: 'This set is programmed close to failure',
    detail: `The target is ~${rir} rep${rir === 1 ? '' : 's'} in reserve. Near-failure sets are effective but raise form-breakdown risk, especially on compounds.`,
    action: 'Keep a spotter/safety pins ready, and end the set the moment the bar speed dies.',
  };
}
