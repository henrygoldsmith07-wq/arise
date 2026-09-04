// benchmark/fixtures/index.js — synthetic fixture library for evidence tests.
//
// Every fixture is synthetic and deterministic (relative to a FIXED_BASE so
// runs are reproducible across machines and commits — never Date.now()). The
// builders here back three layers:
//   - the leakage suite (future-data probes fed to point-in-time replays)
//   - the robustness suite (missing/noisy/layoff/equipment/readiness/
//     duplicate/corrupted edge cases fed through the whole pipeline)
//   - benchmark scripts that want a dataset beyond synthetic-history.json
//
// Dataset shape follows benchmark/benchmark.schema.json (formatVersion 1).

export const FIXED_BASE = '2026-06-01T12:00:00.000Z';

const DAY = 86400000;
const iso = (offsetDays)=> new Date(Date.parse(FIXED_BASE) + offsetDays * DAY).toISOString().slice(0, 10);

let counter = 0;
export function __resetFixtureIds(){ counter = 0; }

// ── Core builders ────────────────────────────────────────────────────────────

export function session({ dateISO, sets = [], exerciseId = 'bench-press', skippedSets = 0, pain = false, durationMinutes = 55, note = '' } = {}){
  return {
    id: `fix-${++counter}`,
    dateISO,
    durationMinutes,
    ...(pain ? { painDiscomfort: true } : {}),
    ...(skippedSets ? { skippedSetsCount: skippedSets } : {}),
    ...(note ? { note } : {}),
    blocks: sets.length ? [{ exerciseId, sets }] : [],
  };
}

export function setOf({ weightKg = 60, reps = 8, rpe = null, failed = false, skipped = false, assistedKg = null, side = null, rom = null } = {}){
  const out = { weightKg, reps, rpe };
  if(rpe === null) delete out.rpe;
  if(failed) out.failed = true;
  if(skipped) out.skipped = true;
  if(assistedKg != null) out.assistedKg = assistedKg;
  if(side != null) out.side = side;
  if(rom != null) out.rom = rom;
  return out;
}

// Weekly ascending sessions at one exercise.
export function history({ sessions = 6, start = 80, step = 2.5, reps = 8, rpe = 7, exerciseId = 'bench-press', gapWeeks = 1, startDateOffset = -70, perSession = null } = {}){
  const out = [];
  for(let i = 0; i < sessions; i++){
    const dateISO = iso(startDateOffset + i * 7 * gapWeeks);
    const weightKg = start + i * step;
    const sets = perSession
      ? perSession(i, dateISO)
      : [setOf({ weightKg, reps, rpe }), setOf({ weightKg, reps, rpe: rpe + 1 }), setOf({ weightKg, reps, rpe: rpe })];
    out.push(session({ dateISO, sets, exerciseId }));
  }
  return out;
}

function dataset(historyRows, extras = {}, name = 'fixture'){
  return {
    formatVersion: 1,
    kind: 'synthetic',
    metadata: { name, synthetic: true, seed: 'arise-fixtures-v1', realTrainingValidation: false, generatedFromFixedBase: FIXED_BASE },
    profile: { availableEquipment: ['barbell', 'dumbbells', 'bench', 'machine'] },
    history: historyRows,
    ...extras,
  };
}

export function asDataset(historyRows, extras = {}, name = 'fixture'){ return dataset(historyRows, extras, name); }

// ── Edge-case packs ──────────────────────────────────────────────────────────
// Every pack resets the id counter first, so identical invocations produce
// byte-identical datasets (determinism is itself asserted in tests).

// 1. Missing data: blank reps, empty blocks, absent weight, null rpe, a
// session with no sets at all.
export function missingDataPack(){
  __resetFixtureIds();
  return [
    session({ dateISO: iso(-40), sets: [setOf({ weightKg: 80, reps: 8 })] }),
    session({ dateISO: iso(-33), sets: [setOf({ weightKg: 80, reps: 0 }), setOf({ weightKg: 82.5, reps: 8 })] }),
    session({ dateISO: iso(-26), sets: [] }),
    session({ dateISO: iso(-19), sets: [setOf({ weightKg: 0, reps: 8 }), setOf({ weightKg: 85, reps: 8, rpe: null })] }),
    session({ dateISO: iso(-12), sets: [setOf({ weightKg: 87.5, reps: 8 })] }),
  ];
}

// 2. Noisy data: RPE jitter, a pain-flagged session, an unusual performance
// drop, skipped sets, alternating order noise.
export function noisyDataPack(){
  __resetFixtureIds();
  return [
    session({ dateISO: iso(-56), sets: [setOf({ weightKg: 80, reps: 8, rpe: 6 }), setOf({ weightKg: 80, reps: 8, rpe: 9 })] }),
    session({ dateISO: iso(-49), sets: [setOf({ weightKg: 82.5, reps: 8, rpe: 7.5 })] }),
    session({ dateISO: iso(-42), sets: [setOf({ weightKg: 80, reps: 8, rpe: 8 })], pain: true }),
    session({ dateISO: iso(-35), sets: [setOf({ weightKg: 60, reps: 5, rpe: 9 })], skippedSets: 2, durationMinutes: 25 }),
    session({ dateISO: iso(-28), sets: [setOf({ weightKg: 82.5, reps: 9, rpe: 7 })] }),
    session({ dateISO: iso(-21), sets: [setOf({ weightKg: 85, reps: 8, rpe: 7 })] }),
  ];
}

// 3. Long layoff: eight weeks off mid-history, then a weak return.
export function longLayoffPack(){
  __resetFixtureIds();
  const before = history({ sessions: 4, start: 80, step: 2.5, startDateOffset: -160 });
  const layoff = [session({ dateISO: iso(-95), sets: [setOf({ weightKg: 55, reps: 6, rpe: 9 })] })];
  const after = history({ sessions: 3, start: 70, step: 2.5, startDateOffset: -30 });
  return [...before, ...layoff, ...after];
}

// 4. Mixed equipment constraints: barbell, dumbbell and machine work with
// plate-relevant increments, plus a kit drop mid-span.
export function mixedEquipmentPack(){
  __resetFixtureIds();
  return [
    session({ dateISO: iso(-42), sets: [setOf({ exerciseWeight: null, weightKg: 80, reps: 8, rpe: 7 })], exerciseId: 'bench-press' }),
    session({ dateISO: iso(-35), sets: [setOf({ weightKg: 30, reps: 10, rpe: 7 })], exerciseId: 'dumbbell-bench-press' }),
    session({ dateISO: iso(-28), sets: [setOf({ weightKg: 40, reps: 10, rpe: 7 })], exerciseId: 'machine-chest-press' }),
    session({ dateISO: iso(-21), sets: [setOf({ weightKg: 82.5, reps: 8, rpe: 7 })], exerciseId: 'bench-press' }),
    session({ dateISO: iso(-14), sets: [setOf({ weightKg: 32.5, reps: 10, rpe: 7 })], exerciseId: 'dumbbell-bench-press' }),
    session({ dateISO: iso(-7), sets: [setOf({ weightKg: 42.5, reps: 10, rpe: 7 })], exerciseId: 'machine-chest-press' }),
  ].map(s=> ({ ...s, equipmentSnapshot: ['dumbbells', 'bench'] }));
}

// 5. Contradictory readiness: readiness says fresh while performance collapses,
// then readiness says exhausted while performance PRs.
export function contradictoryReadinessPack(){
  __resetFixtureIds();
  return {
    history: [
      session({ dateISO: iso(-28), sets: [setOf({ weightKg: 82.5, reps: 8, rpe: 9 })] }),
      session({ dateISO: iso(-21), sets: [setOf({ weightKg: 80, reps: 8, rpe: 9 })] }),
      session({ dateISO: iso(-14), sets: [setOf({ weightKg: 90, reps: 8, rpe: 5 })] }),
      session({ dateISO: iso(-7), sets: [setOf({ weightKg: 92.5, reps: 8, rpe: 4 })] }),
    ],
    readinessLog: [
      { dateISO: iso(-28), score: 85 },
      { dateISO: iso(-21), score: 80 },
      { dateISO: iso(-14), score: 20 },
      { dateISO: iso(-7), score: 18 },
    ],
  };
}

// 6. Duplicate records: the same session twice (exact and shuffled-set),
// a repeated identical set inside one session.
export function duplicateRecordsPack(){
  __resetFixtureIds();
  const a = session({ dateISO: iso(-14), sets: [setOf({ weightKg: 80, reps: 8 }), setOf({ weightKg: 82.5, reps: 8 })] });
  const a2 = { ...a, id: `fix-${++counter}`, blocks: [{ exerciseId: 'bench-press', sets: [setOf({ weightKg: 82.5, reps: 8 }), setOf({ weightKg: 80, reps: 8 })] }] };
  const b = session({ dateISO: iso(-7), sets: [setOf({ weightKg: 85, reps: 8 }), setOf({ weightKg: 85, reps: 8 })] });
  return [a, a2, b];
}

// 7. Corrupted but recoverable: string numbers, negative weight, impossible
// reps, NaN-ish dates on later sessions only (the tail is garbage, the head
// is a real ascending history).
export function corruptedRecoverablePack(){
  __resetFixtureIds();
  return [
    session({ dateISO: iso(-28), sets: [setOf({ weightKg: 80, reps: 8 })] }),
    session({ dateISO: iso(-21), sets: [setOf({ weightKg: 82.5, reps: 8 })] }),
    session({ dateISO: iso(-14), sets: [{ weightKg: '85', reps: '8' }, setOf({ weightKg: -20, reps: 8 })] }),
    session({ dateISO: iso(-7), sets: [setOf({ weightKg: 87.5, reps: 8 })] }),
    { id: `fix-${++counter}`, dateISO: 'not-a-date', blocks: [{ exerciseId: 'bench-press', sets: [setOf({ weightKg: 90, reps: 8 })] }] },
  ];
}

// 8. Future-leak probe pairs: a real decision history plus FUTURE sessions the
// engine must never see when asked for a mid-span recommendation. Past side
// descends then recovers; future side jumps 15 kg — a tell any leak betrays.
export function futureLeakPair({ exerciseId = 'bench-press' } = {}){
  __resetFixtureIds();
  const past = [
    session({ dateISO: iso(-28), sets: [setOf({ weightKg: 82.5, reps: 8, rpe: 7 })], exerciseId }),
    session({ dateISO: iso(-21), sets: [setOf({ weightKg: 80, reps: 8, rpe: 7 })], exerciseId }),
    session({ dateISO: iso(-14), sets: [setOf({ weightKg: 82.5, reps: 8, rpe: 7 })], exerciseId }),
  ];
  const future = [
    session({ dateISO: iso(-7), sets: [setOf({ weightKg: 95, reps: 8, rpe: 7 })], exerciseId }),
    session({ dateISO: iso(0), sets: [setOf({ weightKg: 97.5, reps: 8, rpe: 6.5 })], exerciseId }),
  ];
  return { past, future, asOfISO: iso(-14), tellWeightKg: 95 };
}

// Dataset wrappers for the benchmark scripts / schema validation.
export const PACK_DATASETS = {
  'missing-data': ()=> dataset(missingDataPack(), {}, 'missing-data'),
  'noisy-data': ()=> dataset(noisyDataPack(), {}, 'noisy-data'),
  'long-layoff': ()=> dataset(longLayoffPack(), {}, 'long-layoff'),
  'mixed-equipment': ()=> dataset(mixedEquipmentPack(), {}, 'mixed-equipment'),
  'contradictory-readiness': ()=> {
    const { history: h, readinessLog } = contradictoryReadinessPack();
    return dataset(h, { readinessLog }, 'contradictory-readiness');
  },
  'duplicate-records': ()=> dataset(duplicateRecordsPack(), {}, 'duplicate-records'),
  'corrupted-recoverable': ()=> dataset(corruptedRecoverablePack(), {}, 'corrupted-recoverable'),
};

export const PACK_NAMES = Object.keys(PACK_DATASETS);
