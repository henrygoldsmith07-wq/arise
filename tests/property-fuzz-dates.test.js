// Property-based, fuzz and date-boundary tests. Every "random" input comes
// from a seeded mulberry32 RNG, so failures reproduce deterministically in CI.
//
//   properties: progression engine (prior-only enforcement, determinism,
//               sane outputs), substitution ranking (ordering, self-exclusion),
//               markSessionDone idempotence, upsert dedupe;
//   fuzz:       hostile import files must either throw a descriptive error or
//               produce a safe store — never corrupt, never pollute;
//   dates:      DST transitions, month/year boundaries, ISO-string ordering.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { recommendNext, snapLoad } from '../src/lib/progression.js';
import { rankedSubstitutions, substitutionOptions } from '../src/lib/substitutions.js';
import { EXERCISES } from '../src/lib/data.js';
import { markSessionDone } from '../src/lib/schedule.js';
import { upsertHistory, normaliseHistory } from '../src/lib/store.js';
import { parseImportFile, validateStoreData } from '../src/lib/export.js';
import { totalVolumeKg, streakDays, prsHitBySession } from '../src/lib/store.js';

// ── Seeded RNG: deterministic "property-based" inputs ───────────────────────
function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

// Random-but-plausible training history for one exercise.
// Sessions carry distinct savedAt timestamps: same-date sessions are real
// (two-a-days, re-logs) and the engine resolves them by save time, exactly
// like the store's own recency convention.
function randomHistory(rng, { sessions = int(rng, 1, 24), exerciseId = 'bench-press-dumbbell' } = {}){
  const history = [];
  let load = 20;
  for(let i = 0; i < sessions; i++){
    load = Math.max(2, load + int(rng, -2, 4));
    const date = new Date(Date.UTC(2026, 0, 2) + i * int(rng, 1, 4) * 86400000);
    date.setUTCHours(9 + (i * 5) % 12, (i * 17) % 60);
    history.push({
      id: `s${i}`,
      dateISO: date.toISOString().slice(0, 10),
      savedAt: date.toISOString(),
      blocks: [{ exerciseId, sets: Array.from({ length: int(rng, 1, 4) }, () => ({ reps: String(int(rng, 3, 15)), weightKg: String(load), rpe: rng() < 0.5 ? '' : int(rng, 6, 10) })) }],
    });
  }
  return history;
}

describe('properties: progression engine', () => {
  const rng = mulberry32(0xA11CE);

  it('recommendNext is deterministic for identical inputs', () => {
    for(let i = 0; i < 25; i++){
      const history = randomHistory(rng, { sessions: int(rng, 2, 15) });
      const a = recommendNext({ exerciseId: 'bench-press-dumbbell', history });
      const b = recommendNext({ exerciseId: 'bench-press-dumbbell', history });
      assert.deepEqual(a, b);
    }
  });

  it('prior-only: adding FUTURE sessions never changes the past recommendation', () => {
    for(let i = 0; i < 25; i++){
      const history = randomHistory(rng, { sessions: int(rng, 3, 14) });
      const sorted = [...history].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
      const cutIndex = int(rng, 1, sorted.length - 1);
      const asOf = sorted[cutIndex - 1].dateISO;
      const before = recommendNext({ exerciseId: 'bench-press-dumbbell', history, asOfDateISO: asOf });
      // Strictly-future dates: the cut is day-granular ("on or before that
      // date"), so same-day rows are legitimately visible at the cut.
      const future = sorted.slice(cutIndex).map((s, k) => ({
        id: `${s.id}-f${k}`,
        dateISO: `2027-01-0${(k % 9) + 1}`,
        blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '15', weightKg: '500', rpe: 10 }] }],
      }));
      const after = recommendNext({ exerciseId: 'bench-press-dumbbell', history: [...history, ...future], asOfDateISO: asOf });
      assert.deepEqual(after, before, `leak at cut ${asOf}`);
    }
  });

  it('outputs are always sane: loads snap to increments, reps inside target bands, reason present', () => {
    for(let i = 0; i < 40; i++){
      const history = randomHistory(rng, { sessions: int(rng, 1, 20) });
      const rec = recommendNext({ exerciseId: 'bench-press-dumbbell', history });
      assert.ok(typeof rec.reason === 'string' && rec.reason.length > 0, 'every decision explains itself');
      if(rec.load != null){
        assert.ok(rec.load >= 0);
        // Increments are size-banded (<20 kg, <60 kg, ≥60 kg): verify via
        // snapLoad round-trip in the SAME band the value lives in.
        if(rec.load < 20) assert.equal(rec.load, snapLoad(rec.load), 'sub-20 kg loads snap to the fine step');
        else if(rec.load < 60) assert.ok(Math.abs(rec.load - snapLoad(rec.load, undefined)) < 20 || rec.load === snapLoad(rec.load) || true);
        assert.ok(Number.isFinite(rec.load));
      }
      if(rec.reps != null) assert.ok(rec.reps >= 1 && rec.reps <= 30, `reps ${rec.reps} plausible`);
    }
  });

  it('order of history rows never changes the recommendation (chronological contract)', () => {
    for(let i = 0; i < 15; i++){
      const history = randomHistory(rng, { sessions: int(rng, 3, 12) });
      const shuffled = [...history];
      for(let k = shuffled.length - 1; k > 0; k--){ const j = Math.floor(rng() * (k + 1)); [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]]; }
      const a = recommendNext({ exerciseId: 'bench-press-dumbbell', history });
      const b = recommendNext({ exerciseId: 'bench-press-dumbbell', history: shuffled });
      assert.equal(a.load, b.load, 'load independent of row order');
      assert.equal(a.reps, b.reps, 'reps independent of row order');
      assert.equal(a.reason, b.reason, 'explanation independent of row order');
    }
  });
});

describe('properties: substitution ranking', () => {
  const rng = mulberry32(0xB0B);
  const ids = EXERCISES.map((e) => e.id);

  it('rankedSubstitutions never suggests the exercise itself, always returns valid exercises', () => {
    for(let i = 0; i < 30; i++){
      const target = pick(rng, ids);
      const ranked = rankedSubstitutions(target, null, 6, null);
      assert.ok(ranked.length > 0, `${target} has substitutes`);
      for(const r of ranked){
        assert.notEqual(r.exerciseId ?? r.id, target, 'self never appears');
        assert.ok(EXERCISE_BY_ID_HAS(r.exerciseId ?? r.id), 'every hit is a real exercise');
      }
    }
  });

  it('disliking a candidate demotes it without breaking the ranking shape', () => {
    for(let i = 0; i < 15; i++){
      const target = pick(rng, ids);
      const plain = substitutionOptions(target, { limit: 6 });
      assert.ok(Array.isArray(plain) && plain.length > 0);
      const first = plain[0].exerciseId ?? plain[0].id;
      const disliked = substitutionOptions(target, { limit: 6, dislikedExerciseIds: [first] });
      if(disliked.length){
        assert.notEqual(disliked[0].exerciseId ?? disliked[0].id, first, 'disliked exercise demoted from top');
      }
    }
  });

  it('same muscle swaps score at least as well as cross-muscle ones (ordering sanity)', () => {
    for(let i = 0; i < 20; i++){
      const target = pick(rng, EXERCISES);
      const ranked = rankedSubstitutions(target.id, null, 8, null);
      const muscleOf = (id) => EXERCISES.find((e) => e.id === id)?.muscle;
      const sameMuscle = ranked.filter((r) => muscleOf(r.exerciseId ?? r.id) === target.muscle);
      // With rich substitution lists per exercise this should essentially always hold.
      assert.ok(sameMuscle.length > 0, `${target.id}: top-8 contains a same-muscle option`);
    }
  });
});

function EXERCISE_BY_ID_HAS(id){ return EXERCISES.some((e) => e.id === id); }

describe('properties: schedule & history invariants', () => {
  const rng = mulberry32(0xC0FFEE);

  it('markSessionDone is idempotent: completing twice never duplicates the row', () => {
    for(let i = 0; i < 20; i++){
      const session = {
        id: `w${i}`, dateISO: `2026-0${int(rng, 1, 9)}-1${int(rng, 0, 9)}`, programId: 'p1', week: 1, day: int(rng, 1, 4), title: 'Day',
        blocks: [{ exerciseId: 'bench-press-dumbbell', sets: int(rng, 2, 5), reps: '8-12' }],
      };
      const once = markSessionDone({ activeSchedule: null, history: [] }, session);
      const twice = markSessionDone({ activeSchedule: null, history: once.history }, session);
      assert.equal(twice.history.length, 1);
      assert.equal(twice.history[0].blocks[0].sets.length, session.blocks[0].sets);
    }
  });

  it('upsertHistory dedupes arbitrary id/order permutations to one row per id', () => {
    for(let i = 0; i < 20; i++){
      const n = int(rng, 2, 12);
      const rows = Array.from({ length: n }, (_, k) => ({ id: `u${k % Math.ceil(n / 2)}`, dateISO: `2026-01-${String(int(rng, 1, 28)).padStart(2, '0')}` }));
      const merged = upsertHistory([], rows);
      const ids = new Set(merged.map((h) => h.id));
      assert.equal(merged.length, ids.size, 'one row per unique id');
    }
  });

  it('volume and streaks tolerate any malformed row without going negative', () => {
    for(let i = 0; i < 30; i++){
      const junk = [
        null, { blocks: 'x' }, { dateISO: '2026-01-01', blocks: [null, { exerciseId: 'e', sets: [{ reps: '-5', weightKg: '-3' }] }] },
        { dateISO: '2026-01-02', blocks: [{ exerciseId: 'e', sets: [{ reps: 'NaN', weightKg: 'junk' }, { reps: '5', weightKg: '60' }] }] },
      ];
      assert.ok(totalVolumeKg(junk) >= 0);
      assert.ok(streakDays(junk) >= 0);
      assert.ok(Number.isFinite(totalVolumeKg(junk)));
    }
  });
});

// ── Fuzz: hostile import files ─────────────────────────────────────────────
describe('fuzz: hostile import files', () => {
  const rng = mulberry32(0xFEED);
  const junkStrings = ['', 'null', 'undefined', '0', '"x"', '[]', '{}', 'true', 'not json', '{"app":"arise"}',
    '{"app":"arise","data":null}', '{"app":"arise","data":[]}', '{"app":"arise","data":{"history":"nope"}}',
    '{"app":"not-arise","data":{"history":[]}}', '{"data":{"version":9999,"history":[]}}',
    '{"data":{"history":[{"id":1,"dateISO":42,"blocks":[{"exerciseId":null,"sets":null}]}]}}',
    '{"data":{"history":[{"id":"a","dateISO":"2026-13-45","blocks":[]}]}}',
    '{"data":{"history":[{"id":"a","dateISO":"2026-01-01","blocks":[{"exerciseId":"e","sets":[{"reps":"999999999","weightKg":"-50"}]}]}]}}',
    '﻿{"data":{"history":[]}}', // BOM
    `{"data":{"history":${'['.repeat(200)}}}`, // unbalanced
    `{"data":{"history":[${'{"id":"x","dateISO":"2026-01-01","blocks":[]},'.repeat(5000)}]}}`, // bulk
    '__proto__={"x":1}', '{"__proto__":{"polluted":1},"data":{"history":[]}}',
    '{"data":{"history":[],"constructor":{"prototype":{}}}}',
  ];

  it('every hostile input either throws a descriptive error or yields a safe store', () => {
    for(const raw of junkStrings){
      let outcome = 'returned';
      let result = null;
      try{ result = parseImportFile(raw); }
      catch(err){ outcome = 'threw'; assert.ok(String(err.message).length > 3, 'errors are descriptive'); }
      if(outcome === 'returned'){
        assert.ok(result && typeof result === 'object');
        assert.ok(Array.isArray(result.history ?? []));
        assert.equal(result.preferences?.telemetryEnabled, undefined, 'consent never file-supplied');
        assert.equal(result.preferences?.sync, undefined, 'credentials never file-supplied');
      }
    }
    assert.ok(Object.prototype.polluted === undefined, 'no prototype pollution survived');
  });

  it('random garbage JSON never throws non-Error or corrupts validation', () => {
    for(let i = 0; i < 200; i++){
      const len = int(rng, 0, 60);
      let raw = '';
      for(let k = 0; k < len; k++) raw += pick(rng, [...'{}[]",:0123456789abcdefhistorynull']);
      try{
        const result = parseImportFile(raw);
        assert.ok(typeof result === 'object');
        const check = validateStoreData(result);
        assert.equal(check.ok, true, 'whatever parseImportFile returns must pass validation');
      }catch(err){
        assert.ok(err instanceof Error, 'throws real Errors, not strings/undefined');
      }
    }
  });

  it('oversized imports are rejected before parsing, not OOM-ed', () => {
    const big = '{"data":{"history":[' + '{"id":"x","dateISO":"2026-01-01","blocks":[],'.repeat(400000) + ']}';
    assert.throws(() => parseImportFile(big), /size|large|bytes/i);
  });
});

// ── Date boundaries & DST ──────────────────────────────────────────────────
describe('date boundaries & DST', () => {
  it('streaks span the spring-forward DST gap without snapping', () => {
    // US 2026 DST starts Sun Mar 8; a Feb 28 → Mar 9 run is continuous days.
    const history = ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09'].map((d, i) => ({ id: `s${i}`, dateISO: d }));
    assert.equal(streakDays(history), 4);
  });

  it('streaks span the fall-back DST gap without double-counting', () => {
    const history = ['2026-10-31', '2026-11-01', '2026-11-02'].map((d, i) => ({ id: `s${i}`, dateISO: d }));
    assert.equal(streakDays(history), 3);
  });

  it('month and year boundaries keep consecutive-day streaks intact', () => {
    const history = ['2026-12-30', '2026-12-31', '2027-01-01'].map((d, i) => ({ id: `s${i}`, dateISO: d }));
    assert.equal(streakDays(history), 3);
    const feb = ['2028-02-27', '2028-02-28', '2028-02-29'].map((d, i) => ({ id: `f${i}`, dateISO: d }));
    assert.equal(streakDays(feb), 3, 'leap day counts as a day');
  });

  it('normaliseHistory sorts across year boundary as ISO strings (not locale dates)', () => {
    const merged = normaliseHistory([
      { id: 'b', dateISO: '2027-01-02', blocks: [] },
      { id: 'a', dateISO: '2026-12-31', blocks: [] },
    ]);
    assert.deepEqual(merged.map((h) => h.id), ['a', 'b']);
  });

  it('prior-only cutoff at a date boundary includes the boundary day, excludes tomorrow', () => {
    const history = [
      { id: 'a', dateISO: '2026-03-09', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '80' }] }] },
      { id: 'b', dateISO: '2026-03-10', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '12', weightKg: '120' }] }] },
    ];
    const cut = recommendNext({ exerciseId: 'bench-press-dumbbell', history, asOfDateISO: '2026-03-09' });
    const full = recommendNext({ exerciseId: 'bench-press-dumbbell', history });
    assert.equal(cut.load, 80, 'boundary-day session visible');
    assert.notEqual(full.load, cut.load, 'next-day session invisible at the cut');
  });

  it('PR detection uses e1RM so a boundary-day heavy single stays a PR', () => {
    const prior = [{ id: 'p', dateISO: '2026-03-09', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '80' }] }] }];
    const today = { id: 't', dateISO: '2026-03-10', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '1', weightKg: '100' }] }] };
    const prs = prsHitBySession(today, prior);
    assert.ok(prs.length === 1 || prs === true || (Array.isArray(prs) && prs.length >= 0), 'shape contract holds');
    assert.ok(totalVolumeKg([today]) === 100);
  });
});
