import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeGoal, sanitizeLiftGoals, getLiftGoal, listLiftGoals, setLiftGoal, clearLiftGoal,
  mergeLiftGoals, e1rmSeries, goalHitOn, projectGoal, unseenGoalHits, markGoalHitSeen, describeProjection,
} from '../src/lib/liftGoals.js';
import { e1rm } from '../src/lib/trainingMath.js';
import { mergeGymPrefs } from '../src/lib/sync.js';
import { mergeStores } from '../src/lib/export.js';

const T1 = '2026-10-01T10:00:00.000Z';
const T2 = '2026-10-02T10:00:00.000Z';
const T3 = '2026-10-03T10:00:00.000Z';
const LAT = 'lat-pulldown';

const sess = (dateISO, kg, reps = 8, id = LAT) => ({
  id: `s-${dateISO}`, dateISO, blocks: [{ exerciseId: id, sets: [{ reps: String(reps), weightKg: String(kg), completed: true }] }],
});
// A lifter adding 1 kg a week to lat pulldown for 8 weeks: 50 → 57 kg × 8.
const risingHistory = () => Array.from({ length: 8 }, (_, i) => sess(new Date(Date.UTC(2026, 8, 7 + i * 7)).toISOString().slice(0, 10), 50 + i));

describe('liftGoals — storage', () => {
  it('stores a goal with timestamps and rejects impossible targets', () => {
    const { patch } = setLiftGoal(null, LAT, { kg: 80, reps: 8 }, T1);
    const g = getLiftGoal(patch, LAT);
    assert.deepEqual([g.kg, g.reps, g.createdAt, g.updatedAt], [80, 8, T1, T1]);
    assert.match(setLiftGoal(null, LAT, { kg: 0, reps: 8 }, T1).error, /load/);
    assert.match(setLiftGoal(null, LAT, { kg: 80, reps: 0 }, T1).error, /reps/);
    assert.match(setLiftGoal(null, LAT, { kg: 80, reps: 40 }, T1).error, /reps/);
    assert.match(setLiftGoal(null, '', { kg: 80, reps: 8 }, T1).error, /lift/);
  });

  it('requires a future deadline and a real date', () => {
    assert.match(setLiftGoal(null, LAT, { kg: 80, reps: 8, deadlineISO: '2026-09-30' }, T1).error, /after today/);
    assert.match(setLiftGoal(null, LAT, { kg: 80, reps: 8, deadlineISO: 'christmas' }, T1).error, /real date/);
    const ok = setLiftGoal(null, LAT, { kg: 80, reps: 8, deadlineISO: '2026-12-20' }, T1);
    assert.equal(getLiftGoal(ok.patch, LAT).deadlineISO, '2026-12-20');
  });

  it('re-targeting keeps the start date; an unchanged save keeps old stamps', () => {
    const first = setLiftGoal(null, LAT, { kg: 80, reps: 8 }, T1).patch;
    const same = setLiftGoal(first, LAT, { kg: 80, reps: 8 }, T3).patch;
    assert.equal(same.liftGoals[LAT].updatedAt, T1);
    assert.equal(same.updatedAt, undefined);
    const changed = setLiftGoal(first, LAT, { kg: 85, reps: 8 }, T3).patch;
    assert.equal(changed.liftGoals[LAT].createdAt, T1);
    assert.equal(changed.liftGoals[LAT].updatedAt, T3);
  });

  it('clearing leaves a tombstone that beats an older copy in a merge', () => {
    const first = setLiftGoal(null, LAT, { kg: 80, reps: 8 }, T1).patch;
    const cleared = clearLiftGoal(first, LAT, T2);
    assert.equal(getLiftGoal(cleared, LAT), null);
    assert.deepEqual(listLiftGoals(cleared), []);
    const merged = mergeLiftGoals(first.liftGoals, cleared.liftGoals);
    assert.equal(merged[LAT].deleted, true);
    // ...but a goal set again afterwards wins over the tombstone.
    const again = setLiftGoal(cleared, LAT, { kg: 90, reps: 5 }, T3).patch;
    assert.equal(mergeLiftGoals(cleared.liftGoals, again.liftGoals)[LAT].kg, 90);
  });

  it('sanitising drops junk ids and unusable rows', () => {
    const out = sanitizeLiftGoals({ ok: { kg: 50, reps: 5, updatedAt: T1 }, 'bad id!': { kg: 50, reps: 5 }, nope: { kg: -4, reps: 5 }, str: 'x' });
    assert.deepEqual(Object.keys(out), ['ok']);
    assert.equal(sanitizeGoal([1, 2]), null);
  });

  it('merge is commutative and newest wins', () => {
    const a = { [LAT]: sanitizeGoal({ kg: 80, reps: 8, updatedAt: T1 }) };
    const b = { [LAT]: sanitizeGoal({ kg: 85, reps: 8, updatedAt: T2 }), other: sanitizeGoal({ kg: 40, reps: 10, updatedAt: T1 }) };
    assert.deepEqual(mergeLiftGoals(a, b), mergeLiftGoals(b, a));
    assert.equal(mergeLiftGoals(a, b)[LAT].kg, 85);
    assert.ok(mergeLiftGoals(a, b).other);
  });

  it('goals travel through sync and backup merges', () => {
    const left = { liftGoals: { [LAT]: sanitizeGoal({ kg: 80, reps: 8, updatedAt: T1 }) }, updatedAt: T1 };
    const right = { liftGoals: { [LAT]: sanitizeGoal({ kg: 85, reps: 8, updatedAt: T2 }) }, updatedAt: T2 };
    assert.equal(mergeGymPrefs(left, right).liftGoals[LAT].kg, 85);
    assert.equal(mergeGymPrefs(right, left).liftGoals[LAT].kg, 85);
    const merged = mergeStores({ gymPrefs: left, history: [] }, { gymPrefs: right, history: [] });
    assert.equal(merged.gymPrefs.liftGoals[LAT].kg, 85);
  });
});

describe('liftGoals — projection', () => {
  it('builds a per-session best e1RM series and skips failed and unloaded sets', () => {
    const history = [sess('2026-09-07', 50), { id: 'x', dateISO: '2026-09-14', blocks: [{ exerciseId: LAT, sets: [{ reps: '8', weightKg: '90', failed: true }, { reps: '8', weightKg: '', completed: true }] }] }];
    const series = e1rmSeries(history, LAT);
    assert.equal(series.length, 1);
    assert.equal(series[0].e1rm, e1rm(50, 8));
  });

  it('is hit only by a real set at the target load for the target reps', () => {
    const goal = sanitizeGoal({ kg: 60, reps: 8, createdAt: '2026-09-01T00:00:00Z', updatedAt: T1 });
    assert.equal(goalHitOn([sess('2026-09-10', 60, 6)], LAT, goal), null, 'right load, too few reps');
    assert.equal(goalHitOn([sess('2026-09-10', 62, 8)], LAT, goal), '2026-09-10');
    assert.equal(projectGoal([sess('2026-09-10', 62, 8)], LAT, goal, '2026-10-01').status, 'hit');
  });

  it('ignores sets logged before the goal was created', () => {
    const goal = sanitizeGoal({ kg: 60, reps: 8, createdAt: '2026-10-01T00:00:00Z', updatedAt: T1 });
    assert.equal(goalHitOn([sess('2026-09-10', 65, 8)], LAT, goal), null);
  });

  it('says no-data rather than guessing with too few sessions', () => {
    const goal = sanitizeGoal({ kg: 80, reps: 8, createdAt: '2026-09-01T00:00:00Z', updatedAt: T1 });
    const p = projectGoal([sess('2026-09-28', 55), sess('2026-09-30', 56)], LAT, goal, '2026-10-01');
    assert.equal(p.status, 'no-data');
    assert.equal(p.etaISO, null);
  });

  it('projects an ETA for a rising lift and compares it with the deadline', () => {
    const history = risingHistory(); // last session 2026-10-26 at 57 kg × 8
    const today = '2026-10-27';
    const base = { kg: 70, reps: 8, createdAt: '2026-09-01T00:00:00Z', updatedAt: T1 };
    const open = projectGoal(history, LAT, sanitizeGoal(base), today);
    assert.equal(open.status, 'on-track');
    assert.ok(Math.abs(open.perWeekKg - 1 * (1 + 8 / 30)) < 0.05, `perWeek ${open.perWeekKg}`);
    // 13 kg more at 1 kg/week ≈ 13 weeks ahead of the last session.
    const weeks = open.daysLeft / 7;
    assert.ok(weeks > 11 && weeks < 14, `weeks ${weeks}`);
    const easy = projectGoal(history, LAT, sanitizeGoal({ ...base, deadlineISO: '2027-06-01' }), today);
    assert.equal(easy.status, 'ahead');
    const tight = projectGoal(history, LAT, sanitizeGoal({ ...base, deadlineISO: '2027-01-27' }), today);
    assert.ok(['on-track', 'ahead'].includes(tight.status));
    const missed = projectGoal(history, LAT, sanitizeGoal({ ...base, deadlineISO: '2026-11-20' }), today);
    assert.equal(missed.status, 'behind');
    assert.ok(missed.etaISO > '2026-11-20');
  });

  it('a flat or falling lift gets no ETA, and is behind when it has a deadline', () => {
    const flat = Array.from({ length: 6 }, (_, i) => sess(new Date(Date.UTC(2026, 8, 14 + i * 7)).toISOString().slice(0, 10), 50));
    const open = projectGoal(flat, LAT, sanitizeGoal({ kg: 70, reps: 8, createdAt: '2026-09-01T00:00:00Z', updatedAt: T1 }), '2026-10-20');
    assert.equal(open.status, 'flat');
    assert.equal(open.etaISO, null);
    const dated = projectGoal(flat, LAT, sanitizeGoal({ kg: 70, reps: 8, deadlineISO: '2026-12-25', createdAt: '2026-09-01T00:00:00Z', updatedAt: T1 }), '2026-10-20');
    assert.equal(dated.status, 'behind');
    assert.match(describeProjection(dated, { deadlineISO: '2026-12-25' }), /flat or falling/);
  });

  it('refuses a date more than two years out', () => {
    const slow = Array.from({ length: 6 }, (_, i) => sess(new Date(Date.UTC(2026, 8, 14 + i * 7)).toISOString().slice(0, 10), 50 + i * 0.05));
    const p = projectGoal(slow, LAT, sanitizeGoal({ kg: 200, reps: 8, createdAt: '2026-09-01T00:00:00Z', updatedAt: T1 }), '2026-10-20');
    assert.equal(p.etaISO, null);
  });

  it('reports milestones from the starting level to the target', () => {
    const goal = sanitizeGoal({ kg: 70, reps: 8, createdAt: '2026-09-01T00:00:00Z', updatedAt: T1 });
    const p = projectGoal(risingHistory(), LAT, goal, '2026-10-27');
    assert.equal(p.milestones.length, 4);
    assert.deepEqual(p.milestones.map((m) => m.reached), [true, false, false, false]);
    assert.ok(p.progress > 0.3 && p.progress < 0.7);
    assert.ok(p.milestones.every((m, i, a) => i === 0 || m.e1rm > a[i - 1].e1rm));
  });
});

describe('liftGoals — hit nudge', () => {
  it('nudges once per hit and not again after it is marked seen', () => {
    let gp = setLiftGoal(null, LAT, { kg: 60, reps: 8 }, '2026-09-01T00:00:00.000Z').patch;
    const history = [sess('2026-09-10', 61, 8)];
    const hits = unseenGoalHits(history, gp);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].hitDate, '2026-09-10');
    gp = { ...gp, ...markGoalHitSeen(gp, LAT, hits[0].hitDate) };
    assert.deepEqual(unseenGoalHits(history, gp), []);
  });

  it('removed goals never nudge', () => {
    const set = setLiftGoal(null, LAT, { kg: 60, reps: 8 }, '2026-09-01T00:00:00.000Z').patch;
    const gone = clearLiftGoal(set, LAT, '2026-09-02T00:00:00.000Z');
    assert.deepEqual(unseenGoalHits([sess('2026-09-10', 61, 8)], gone), []);
  });
});
