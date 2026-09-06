// demoData.js — deterministic, seeded generators for demo/sample data.
//
// One seeded RNG drives every generator, so a given seed always yields the
// byte-identical dataset: the demo mode renders the same "month of use" on
// every device, and the test journey fixtures are reproducible across
// machines and commits (the same discipline as the benchmark determinism
// checks). Zero runtime dependencies beyond the shared data module.
//
//   mulberry32(seed)  — the RNG every generator shares
import { scheduleProgram } from './data.js';
//   makeUserContext   — seeded user profile + preferences
//   makeHistory       — plausible multi-week multi-exercise training log
//   makeJourneyStore  — a complete store shaped like a real month of use
//   makeDemoStore     — a demo store with a live, dated schedule attached
//   JOURNEY_SEEDS     — the canonical seeds CI pins (rename = re-baseline)
export function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a seeded RNG plus the tiny helpers everything below shares. */
export function makeRng(seed){
  const rng = mulberry32(seed);
  const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const chance = (p) => rng() < p;
  return { rng, int, pick, chance };
}

// Canonical seeds. These pin every fixture: changing a seed changes the
// dataset and must be a conscious, reviewed act (same policy as re-baselining
// benchmark artifacts).
export const JOURNEY_SEEDS = {
  beginner: 1001,
  consistent: 1002,
  noisy: 1003,
  layoff: 1004,
};

const EXERCISE_ROTATION = [
  { exerciseId: 'bench-press-dumbbell', baseLoad: 20, progression: 'load' },
  { exerciseId: 'dumbbell-row', baseLoad: 18, progression: 'load' },
  { exerciseId: 'goblet-squat', baseLoad: 16, progression: 'load' },
  { exerciseId: 'push-up', baseLoad: 0, progression: 'reps' },
];

/** Local-calendar date N days before today, as YYYY-MM-DD. */
export function isoDaysAgo(days){
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A month of realistic training. Deterministic per seed; `profile` tweaks:
 *   adherence   — probability a scheduled day actually happens (0..1)
 *   noise       — probability of a "noisy" session (pain/skipped/short)
 *   layoffAfter — session index after which the user disappears for N days
 *   layoffDays  — length of that layoff
 *   startDaysAgo— first session N days before today (demo mode keeps the
 *                 log alive relative to the real calendar)
 */
export function makeHistory(seed, {
  sessions = 16,
  adherence = 0.9,
  noise = 0.08,
  layoffAfter = null,
  layoffDays = 10,
  startDate = '2026-01-05',
  startDaysAgo = null,
} = {}){
  const { int, pick, chance } = makeRng(seed);
  const history = [];
  let day = startDaysAgo != null
    ? Date.parse(`${isoDaysAgo(startDaysAgo)}T09:00:00Z`)
    : Date.parse(`${startDate}T09:00:00Z`);
  let laidOff = false;
  for(let i = 0; i < sessions; i++){
    if(chance(1 - adherence)) continue;                 // missed day
    if(layoffAfter != null && i === layoffAfter){
      day += layoffDays * 86400000;
      laidOff = true;
    }
    const dateISO = new Date(day).toISOString().slice(0, 10);
    const savedAt = new Date(day + int(0, 5) * 3600000).toISOString();
    const sessionNoisy = chance(noise); // noise is a SESSION property
    const blocks = [];
    for(const lift of EXERCISE_ROTATION){
      const last = [...history].reverse().flatMap((h) => h.blocks).find((b) => b.exerciseId === lift.exerciseId);
      // Sets store numerics as strings (the app's own convention) — coerce
      // before arithmetic or "22" + 2 becomes "222".
      const priorRaw = last?.sets?.[0] ?? { reps: 8, weightKg: lift.baseLoad };
      const prior = { reps: Number(priorRaw.reps) || 8, weightKg: Number(priorRaw.weightKg) || lift.baseLoad };
      let weightKg;
      let reps;
      if(prior.reps >= 12){
        weightKg = prior.weightKg + 2;   // top of range → load jumps
        reps = 8;                        // …and reps reset (double progression)
      } else {
        weightKg = prior.weightKg;
        reps = prior.reps + (chance(0.6) ? 1 : 0);
      }
      const noisy = sessionNoisy;
      const sets = Array.from({ length: int(2, 4) }, (_, si) => ({
        reps: String(noisy ? Math.max(1, reps - int(1, 3)) : reps),
        weightKg: String(weightKg),
        rpe: noisy ? String(int(9, 10)) : '',
        skipped: noisy && si === 0 ? false : chance(0.05),
        failed: noisy && chance(0.15),
        pain: noisy && chance(0.3),
      }));
      blocks.push({ exerciseId: lift.exerciseId, sets });
    }
    history.push({
      id: `gen-${seed}-${i}`,
      dateISO,
      savedAt,
      mode: 'standard',
      durationMinutes: sessionNoisy ? int(18, 30) : int(38, 60),
      painDiscomfort: blocks.some((b) => b.sets.some((s) => s.pain)),
      blocks,
    });
    day += int(1, 3) * 86400000;
    laidOff = false;
  }
  return history;
}

/** Seeded profile + preferences, matching the onboarding shape. */
export function makeUserContext(seed, { goal = 'muscle', units = 'kg' } = {}){
  const { pick } = makeRng(seed);
  return {
    onboarding: { goal, equipment: pick([['dumbbells'], ['dumbbells', 'barbell'], ['bodyweight']]), location: pick(['home', 'gym']) },
    preferences: { units, theme: pick(['dark', 'light']), autoRest: true, soundCues: true, voiceCoach: false },
  };
}

/** A complete store shaped like a real month of use — the e2e/unit fixture. */
export function makeJourneyStore(seed, opts = {}){
  const user = makeUserContext(seed, opts);
  const history = makeHistory(seed, opts);
  return {
    version: 9,
    ...user,
    activeSchedule: null,
    programHistory: [],
    readinessLog: history.map((h, i) => ({ dateISO: h.dateISO, score: 55 + ((i * 7) % 30) })),
    eventHistory: [],
    healthSummary: null,
    evaluationLedger: [],
    customTemplates: [],
    activeWorkout: null,
    history,
  };
}

/**
 * The demo-mode store: a believable month of training on a LIVE schedule.
 *
 * Honesty rules, enforced here so no UI can accidentally violate them:
 *   - every session id is prefixed `demo-` so merges are collision-free;
 *   - `demo: true` marks the store itself (the demo banner + exit flow read
 *     this flag, and regular saves keep it);
 *   - the schedule starts ~5 weeks ago with the starter program, so the
 *     generated log aligns with its dated sessions and "today" still has a
 *     session to run — the demo is a living app, not a screenshot.
 */
export function makeDemoStore(seed = JOURNEY_SEEDS.consistent){
  const DEMO_PROGRAM = 'starter-3x';
  // History spans ~5 weeks up to the last few days (so training age,
  // consistency weeks and the monthly digest all have something to say);
  // the schedule is anchored 2 days back so the starter program's 6 sessions
  // land as: one done, one TODAY, four ahead — the demo is a living app
  // mid-program, not a finished archive.
  const base = makeJourneyStore(seed, { goal: 'strength', startDaysAgo: 38, sessions: 22 });
  const history = (base.history || []).map((h) => ({ ...h, id: `demo-${h.id}` }));
  const sched = scheduleProgram({ programId: DEMO_PROGRAM, startDateISO: isoDaysAgo(2) });
  const todayIso = isoDaysAgo(0);
  const marked = { ...sched, sessions: sched.sessions.map((s) => s.dateISO < todayIso ? { ...s, status: 'done' } : s) };
  return {
    ...base,
    demo: true,
    onboarding: { goal: 'strength', equipment: ['dumbbells', 'bench'], location: 'home', level: 'Beginner', daysPerWeek: 3, availableMinutes: 45 },
    preferences: { ...base.preferences, theme: base.preferences.theme, telemetryEnabled: false },
    history,
    activeSchedule: marked,
  };
}
