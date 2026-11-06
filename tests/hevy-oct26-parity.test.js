import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dayNoteKey, getDayNote, setDayNote, mergeDayNotes } from '../src/lib/dayNotes.js';
import { buildSessionHistoryPayload, knownGyms, cleanGym } from '../src/lib/sessionRunnerModel.js';
import { mergeGymPrefs } from '../src/lib/sync.js';
import { recordsWall } from '../src/lib/personalRecords.js';
import { buildNoteIndex, searchNotes } from '../src/lib/noteSearch.js';

const T = (n) => `2026-11-0${n}T08:00:00.000Z`;
const day1 = { programId: 'starter-3x', day: 1, week: 2, title: 'Hinge + Pull' };

describe('routine (programme-day) notes', () => {
  it('follow the programme day across weeks; blank clears with a stamp', () => {
    assert.equal(dayNoteKey(day1), 'starter-3x:1');
    assert.equal(dayNoteKey({ title: 'Quick workout' }), null, 'unscheduled sessions have no day');
    let prefs = { ...setDayNote({}, day1, '  Use the far\u0007 cable stack ', T(1)) };
    assert.equal(getDayNote(prefs, { ...day1, week: 5 }), 'Use the far cable stack');
    assert.equal(setDayNote(prefs, day1, 'Use the far cable stack'), null, 'no-op saves never win a sync merge');
    prefs = { ...prefs, ...setDayNote(prefs, day1, '', T(2)) };
    assert.equal(getDayNote(prefs, day1), '');
    assert.deepEqual(prefs.dayNotes['starter-3x:1'], { text: '', updatedAt: T(2) });
  });
  it('sync merges per day, newest wins, whichever device is newer overall', () => {
    const phone = { updatedAt: T(5), dayNotes: { 'p:1': { text: 'old', updatedAt: T(1) } } };
    const laptop = { updatedAt: T(2), dayNotes: { 'p:1': { text: 'new', updatedAt: T(3) }, 'p:2': { text: 'b', updatedAt: T(2) } } };
    for (const m of [mergeGymPrefs(phone, laptop), mergeGymPrefs(laptop, phone)]) {
      assert.equal(m.dayNotes['p:1'].text, 'new');
      assert.equal(m.dayNotes['p:2'].text, 'b');
    }
    assert.deepEqual(mergeDayNotes(phone.dayNotes, laptop.dayNotes), mergeDayNotes(laptop.dayNotes, phone.dayNotes));
  });
});

describe('gym tag', () => {
  const save = (gym) => buildSessionHistoryPayload({
    session: { id: 's', dateISO: '2026-11-01', programId: 'p', title: 'Upper' },
    blocks: [{ exerciseId: 'bench-press-dumbbell', reps: '8', restSec: 90, unilateral: false, sets: [{ reps: '8', weightKg: '20', rpe: '', completed: true }] }],
    gym, startedAt: T(1), nowISO: T(1),
  });
  it('is saved cleaned, or left off when blank', () => {
    assert.equal(save('  PureGym\n  Leeds  ').gym, 'PureGym Leeds');
    assert.equal(save('').gym, undefined);
    assert.equal(cleanGym('x'.repeat(60)).length, 40);
  });
  it('known gyms: most recent first, case-blind de-dupe', () => {
    assert.deepEqual(knownGyms([{ gym: 'Home' }, { gym: 'PureGym' }, { gym: 'home' }, {}]), ['home', 'PureGym']);
  });
  it('is searchable in the notes journal', () => {
    const idx = buildNoteIndex([{ id: 'a', dateISO: '2026-11-01', title: 'Upper', note: 'seat 4', gym: 'PureGym Leeds' }]);
    assert.equal(searchNotes(idx, { query: 'leeds' }).length, 1);
  });
});

describe('annual records', () => {
  it('a year’s wall uses only that year’s sessions', () => {
    const s = (dateISO, kg) => ({ id: dateISO, dateISO, blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '5', weightKg: String(kg), completed: true }] }] });
    const history = [s('2025-06-01', 30), s('2026-02-01', 26), s('2026-03-01', 28)];
    const best = (rows) => rows[0].bands[5].kg;
    assert.equal(best(recordsWall(history, { todayISO: '2026-11-06' })), 30);
    assert.equal(best(recordsWall(history.filter((h) => h.dateISO.startsWith('2026')), { todayISO: '2026-11-06' })), 28);
  });
});
