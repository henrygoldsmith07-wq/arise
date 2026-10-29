import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleProgram, PROGRAM_BY_ID } from '../src/lib/data.js';
import {
  planWeeks, setWeekDeload, extendBlock, removeExtendedWeek, canRemoveWeek, volumeFlags,
  weekDeloadState, setsByMuscle, muscleTone, MAX_BLOCK_WEEKS, VOLUME_GUIDE,
} from '../src/lib/blockPlan.js';
import { weekPhaseFor, reviewCompletedWeek } from '../src/lib/mesocycle.js';

const START = '2026-11-02'; // Monday
const fresh = (programId = 'starter-3x') => scheduleProgram({ programId, startDateISO: START });
const sets = (s, week) => s.sessions.filter(x => x.week === week).flatMap(x => x.blocks.map(b => b.sets));
const total = (s, week) => sets(s, week).reduce((a, b) => a + b, 0);

describe('planWeeks', () => {
  it('groups sessions into weeks with per-muscle direct sets', () => {
    const weeks = planWeeks(fresh(), START);
    assert.deepEqual(weeks.map(w => w.week), [1, 2]);
    assert.equal(weeks[0].sessions.length, 3);
    assert.ok(weeks[0].current);
    assert.ok(!weeks[1].current);
    assert.equal(weeks[0].totalSets, Object.values(weeks[0].byMuscle).reduce((a, b) => a + b, 0));
    assert.ok(weeks[0].sessions.every(s => s.minutes >= 8));
  });
  it('excludes cardio blocks from muscle volume', () => {
    const byMuscle = setsByMuscle([{ blocks: [{ exerciseId: 'brisk-walk', sets: 1 }, { exerciseId: 'push-up', sets: 3 }] }]);
    assert.equal(byMuscle.Cardio, undefined);
    assert.equal(byMuscle.Chest, 3);
  });
  it('returns an empty view for no schedule', () => {
    assert.deepEqual(planWeeks(null), []);
  });
});

describe('setWeekDeload', () => {
  it('cuts upcoming sets by the engine deload factor and flags the week', () => {
    const base = fresh();
    const before = total(base, 2);
    const r = setWeekDeload(base, 2, true);
    assert.equal(r.error, null);
    assert.ok(total(r.schedule, 2) < before);
    assert.equal(weekDeloadState(r.schedule, 2).deload, true);
    assert.equal(weekDeloadState(r.schedule, 1).deload, false);
    assert.equal(total(r.schedule, 1), total(base, 1), 'other weeks untouched');
    assert.ok(r.schedule.sessions.filter(s => s.week === 2).every(s => s.blocks.every(b => b.adaptation?.kind === 'weekly-deload' || b.sets <= 1)));
    assert.ok(r.schedule.rev > base.rev);
  });
  it('turning it off restores the exact original sets and removes the plan', () => {
    const base = fresh('strength-4x');
    const on = setWeekDeload(base, 2, true).schedule;
    const off = setWeekDeload(on, 2, false);
    assert.equal(off.error, null);
    assert.deepEqual(sets(off.schedule, 2), sets(base, 2));
    assert.equal(off.schedule.blockPlan?.deload?.[2], false);
    assert.ok(off.schedule.sessions.every(s => s.blocks.every(b => !b.adaptation)));
    assert.deepEqual(off.schedule.blockPlan.cuts, {});
  });
  it('never rewrites finished sessions and refuses a finished week', () => {
    const base = fresh();
    base.sessions[3].status = 'done';
    const r = setWeekDeload(base, 2, true);
    assert.deepEqual(r.schedule.sessions[3].blocks.map(b => b.sets), base.sessions[3].blocks.map(b => b.sets));
    const finished = fresh();
    finished.sessions.filter(s => s.week === 1).forEach(s => { s.status = 'done'; });
    const bad = setWeekDeload(finished, 1, true);
    assert.match(bad.error, /already finished/);
    assert.equal(bad.schedule, finished);
    assert.match(setWeekDeload(fresh(), 9, true).error, /not in this block/);
  });
  it('is idempotent when the week is already set', () => {
    const on = setWeekDeload(fresh(), 2, true).schedule;
    const again = setWeekDeload(on, 2, true);
    assert.equal(again.unchanged, true);
    assert.equal(again.schedule, on);
  });
  it('leaves single-set blocks (cardio) alone', () => {
    const r = setWeekDeload(fresh(), 1, true);
    const walk = r.schedule.sessions.flatMap(s => s.blocks).find(b => b.exerciseId === 'brisk-walk');
    assert.equal(walk.sets, 1);
  });
});

describe('extendBlock', () => {
  it('adds a planned week after the last, same weekdays, ids unique', () => {
    const base = fresh();
    const r = extendBlock(base);
    assert.equal(r.error, null);
    assert.equal(r.week, 3);
    assert.equal(r.added, 3);
    const w3 = r.schedule.sessions.filter(s => s.week === 3);
    const w2 = base.sessions.filter(s => s.week === 2);
    assert.deepEqual(w3.map(s => new Date(s.dateISO).getUTCDay()), w2.map(s => new Date(s.dateISO).getUTCDay()));
    assert.ok(w3.every(s => s.status === 'planned'));
    assert.equal(new Set(r.schedule.sessions.map(s => s.id)).size, r.schedule.sessions.length);
    assert.deepEqual(r.schedule.blockPlan.extended, [3]);
    assert.ok([...w3.map(s => s.dateISO)].sort()[0] > [...w2.map(s => s.dateISO)].sort().pop());
  });
  it('the programme deload week lands already cut when reached', () => {
    let s = fresh('strength-4x');
    assert.equal(PROGRAM_BY_ID['strength-4x'].mesocycle.deloadWeek, 4);
    s = extendBlock(s).schedule; // week 3: normal
    assert.equal(weekDeloadState(s, 3).deload, false);
    const w3 = total(s, 3);
    s = extendBlock(s).schedule; // week 4: programme deload
    assert.equal(weekDeloadState(s, 4).deload, true);
    assert.ok(total(s, 4) < w3);
    s = extendBlock(s).schedule; // week 5 copies a BUILD week, not the deload
    assert.equal(weekDeloadState(s, 5).deload, false);
    assert.equal(total(s, 5), w3);
  });
  it('caps the block length', () => {
    let s = fresh();
    for(let i = 0; i < 20; i++){ const r = extendBlock(s); if(r.error){ assert.match(r.error, /at most/); break; } s = r.schedule; }
    assert.equal(planWeeks(s).length, MAX_BLOCK_WEEKS);
  });
  it('removing the added week brings back the original schedule shape', () => {
    const base = fresh();
    const ext = extendBlock(base).schedule;
    assert.equal(canRemoveWeek(ext), true);
    assert.equal(canRemoveWeek(base), false);
    const back = removeExtendedWeek(ext);
    assert.equal(back.error, null);
    assert.equal(back.schedule.sessions.length, base.sessions.length);
    assert.equal(back.schedule.blockPlan, undefined);
    ext.sessions.find(s => s.week === 3).status = 'done';
    assert.equal(canRemoveWeek(ext), false);
    assert.ok(removeExtendedWeek(ext).error);
  });
  it('does not mutate its input', () => {
    const base = fresh();
    const snap = JSON.stringify(base);
    extendBlock(base); setWeekDeload(base, 2, true);
    assert.equal(JSON.stringify(base), snap);
  });
});

describe('volumeFlags', () => {
  const week = (n, byMuscle, deload = false) => ({ week: n, byMuscle, deload });
  it('flags only build weeks above the high bound; low volume and deloads stay quiet', () => {
    const flags = volumeFlags([
      week(1, { Chest: VOLUME_GUIDE.high + 4, Back: 10 }),
      week(2, { Chest: 12, Back: 2 }),
      week(3, { Chest: 40, Back: 40 }, true),
    ]);
    assert.deepEqual(flags.map(f => `${f.week}:${f.muscle}:${f.kind}`), ['1:Chest:high']);
    assert.ok(flags[0].message.includes('week 1'));
  });
  it('tone names the three bands', () => {
    assert.equal(muscleTone('Chest', 25), 'high');
    assert.equal(muscleTone('Chest', 12), 'ok');
    assert.equal(muscleTone('Chest', 3), 'low');
    assert.equal(muscleTone('Core', 40), 'neutral');
  });
});

describe('mesocycle integration', () => {
  it('weekPhaseFor honours an explicit normal week over the programme deload', () => {
    let s = fresh('strength-4x');
    s = extendBlock(extendBlock(s).schedule).schedule; // weeks 3,4
    const w4 = s.sessions.find(x => x.week === 4);
    assert.equal(weekPhaseFor(s, w4.dateISO).kind, 'deload');
    const normal = setWeekDeload(s, 4, false).schedule;
    assert.equal(weekPhaseFor(normal, w4.dateISO).kind, 'build');
  });
  it('after weeks are added the programme deload is one week, not every later week', () => {
    let s = fresh('strength-4x');
    for(let i = 0; i < 4; i++) s = extendBlock(s).schedule; // weeks 3-6
    const w6 = s.sessions.find(x => x.week === 6);
    assert.equal(weekPhaseFor(s, w6.dateISO).kind, 'build');
  });
  it('the weekly review does not re-cut a week the lifter already set', () => {
    let s = fresh('strength-4x');
    s = extendBlock(extendBlock(s).schedule).schedule;
    s.sessions.filter(x => x.week <= 3).forEach(x => { x.status = 'done'; });
    const w3end = s.sessions.filter(x => x.week === 3).map(x => x.dateISO).sort().pop();
    const normal = setWeekDeload(s, 4, false).schedule;
    const review = reviewCompletedWeek({ schedule: normal, history: [], todayISO: w3end });
    assert.equal(review.mesoDeloadDue, false);
  });
});
