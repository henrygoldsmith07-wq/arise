import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ageRateMultiplier,
  shortBreakInfo,
  trainingAgeInfo,
  trainingAgeMonths,
  trainingBreakInfo,
  trainingPhase,
} from '../src/lib/progressionTrainingAge.js';

const CONFIG = {
  progression:{
    daysPerMonth:10,
    trainingAge:{
      noviceMaxMonths:2,
      intermediateMaxMonths:4,
      noviceMultiplier:1.7,
      intermediateMultiplier:1.1,
      advancedMultiplier:0.6,
      longBreakDays:20,
    },
    shortBreakPolicy:{
      enabled:true,
      minDays:5,
      moderateDays:10,
      lightLoadMultiplier:0.95,
      moderateLoadMultiplier:0.85,
    },
  },
};

const session = (dateISO, exerciseId = 'bench-press-dumbbell')=> ({
  dateISO,
  blocks:[{ exerciseId, sets:[] }],
});

describe('training-age policy boundaries', ()=>{
  it('handles empty, invalid, future and unsorted histories deterministically', ()=>{
    assert.equal(trainingAgeMonths([], { asOfDateISO:'2026-01-31', config:CONFIG }), 0);
    assert.equal(trainingAgeMonths(null, { asOfDateISO:'2026-01-31', config:CONFIG }), 0);
    assert.equal(trainingAgeMonths([session('2026-01-01')], { asOfDateISO:'bad', config:CONFIG }), 0);

    const history = [
      session('2026-01-21'),
      { dateISO:'bad', blocks:[] },
      session('2026-02-01'),
      session('2026-01-01'),
    ];
    assert.equal(trainingAgeMonths(history, { asOfDateISO:'2026-01-31', config:CONFIG }), 3);
    assert.equal(trainingAgeMonths([session('2026-01-31')], { asOfDateISO:'2026-01-31', config:CONFIG }), 0);
  });

  it('uses exact phase boundaries instead of fuzzy threshold comparisons', ()=>{
    assert.equal(trainingPhase(-1, { config:CONFIG }), 'unknown');
    assert.equal(trainingPhase(0, { config:CONFIG }), 'unknown');
    assert.equal(trainingPhase(1.99, { config:CONFIG }), 'novice');
    assert.equal(trainingPhase(2, { config:CONFIG }), 'intermediate');
    assert.equal(trainingPhase(3.99, { config:CONFIG }), 'intermediate');
    assert.equal(trainingPhase(4, { config:CONFIG }), 'advanced');
  });

  it('uses the matching multiplier at every phase boundary', ()=>{
    assert.equal(ageRateMultiplier(0, { config:CONFIG }), 1);
    assert.equal(ageRateMultiplier(1, { config:CONFIG }), 1.7);
    assert.equal(ageRateMultiplier(2, { config:CONFIG }), 1.1);
    assert.equal(ageRateMultiplier(4, { config:CONFIG }), 0.6);
  });

  it('returns a rounded coherent training-age summary', ()=>{
    const info = trainingAgeInfo([session('2026-01-01')], { asOfDateISO:'2026-01-16', config:CONFIG });
    assert.deepEqual(info, { months:1.5, phase:'novice', multiplier:1.7 });
  });
});

describe('training-break policy boundaries', ()=>{
  it('requires an as-of date and safely handles invalid/empty history', ()=>{
    assert.deepEqual(trainingBreakInfo([session('2026-01-01')], { config:CONFIG }), {
      hasBreak:false,
      daysSinceLast:null,
      longBreakDays:20,
    });
    assert.deepEqual(trainingBreakInfo([], { asOfDateISO:'2026-01-20', config:CONFIG }), {
      hasBreak:false,
      daysSinceLast:null,
      longBreakDays:20,
    });
    assert.deepEqual(trainingBreakInfo([session('2026-01-01')], { asOfDateISO:'bad', config:CONFIG }), {
      hasBreak:false,
      daysSinceLast:null,
      longBreakDays:20,
    });
  });

  it('uses the latest visible session and ignores future sessions', ()=>{
    const info = trainingBreakInfo([
      session('2026-01-01'),
      session('2026-02-01'),
      session('2026-01-10'),
    ], { asOfDateISO:'2026-01-21', config:CONFIG });
    assert.deepEqual(info, {
      hasBreak:false,
      daysSinceLast:11,
      longBreakDays:20,
      lastSessionDateISO:'2026-01-10',
    });
  });

  it('treats the configured long-break day as inclusive', ()=>{
    assert.equal(trainingBreakInfo([session('2026-01-10')], {
      asOfDateISO:'2026-01-29',
      config:CONFIG,
    }).hasBreak, false);
    const exact = trainingBreakInfo([session('2026-01-10')], {
      asOfDateISO:'2026-01-30',
      config:CONFIG,
    });
    assert.equal(exact.hasBreak, true);
    assert.equal(exact.daysSinceLast, 20);
    assert.equal(exact.lastSessionDateISO, '2026-01-10');
  });
});

describe('short-break policy boundaries', ()=>{
  it('is disabled without an as-of date or when policy is disabled', ()=>{
    assert.deepEqual(shortBreakInfo([session('2026-01-01')], 'bench-press-dumbbell', { config:CONFIG }), {
      hasShortBreak:false,
      daysSince:null,
      multiplier:1,
    });
    assert.deepEqual(shortBreakInfo([session('2026-01-01')], 'bench-press-dumbbell', {
      asOfDateISO:'2026-01-10',
    }), {
      hasShortBreak:false,
      daysSince:null,
      multiplier:1,
    });
  });

  it('uses only the requested exercise and the latest visible exposure', ()=>{
    const history = [
      session('2026-01-01'),
      session('2026-01-15', 'pull-up'),
      session('2026-02-01'),
      session('2026-01-10'),
    ];
    const info = shortBreakInfo(history, 'bench-press-dumbbell', {
      asOfDateISO:'2026-01-16',
      config:CONFIG,
    });
    assert.deepEqual(info, { hasShortBreak:true, daysSince:6, multiplier:0.95 });
  });

  it('uses exact light, moderate and long-break boundaries', ()=>{
    const history = [session('2026-01-01')];

    assert.deepEqual(shortBreakInfo(history, 'bench-press-dumbbell', {
      asOfDateISO:'2026-01-05',
      config:CONFIG,
    }), { hasShortBreak:false, daysSince:4, multiplier:1 });

    assert.deepEqual(shortBreakInfo(history, 'bench-press-dumbbell', {
      asOfDateISO:'2026-01-06',
      config:CONFIG,
    }), { hasShortBreak:true, daysSince:5, multiplier:0.95 });

    assert.deepEqual(shortBreakInfo(history, 'bench-press-dumbbell', {
      asOfDateISO:'2026-01-10',
      config:CONFIG,
    }), { hasShortBreak:true, daysSince:9, multiplier:0.95 });

    assert.deepEqual(shortBreakInfo(history, 'bench-press-dumbbell', {
      asOfDateISO:'2026-01-11',
      config:CONFIG,
    }), { hasShortBreak:true, daysSince:10, multiplier:0.85 });

    assert.deepEqual(shortBreakInfo(history, 'bench-press-dumbbell', {
      asOfDateISO:'2026-01-20',
      config:CONFIG,
    }), { hasShortBreak:true, daysSince:19, multiplier:0.85 });

    assert.deepEqual(shortBreakInfo(history, 'bench-press-dumbbell', {
      asOfDateISO:'2026-01-21',
      config:CONFIG,
    }), { hasShortBreak:false, daysSince:20, multiplier:1 });
  });

  it('returns no short break when the exercise has no prior exposure', ()=>{
    assert.deepEqual(shortBreakInfo([session('2026-01-01', 'pull-up')], 'bench-press-dumbbell', {
      asOfDateISO:'2026-01-10',
      config:CONFIG,
    }), { hasShortBreak:false, daysSince:null, multiplier:1 });
  });
});
