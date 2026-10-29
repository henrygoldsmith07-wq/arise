import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildHevyExport, selectForHevy, hevyNameFor, formatHevyTime, rangeStart, readExportMark, writeExportMark, HEVY_HEADER } from '../src/lib/hevyCsvExport.js';
import { parseHevyCsv, hevyRowsToHistory, parseCsvRecords, isHevyCsv, hevyDate } from '../src/lib/hevyCsvImport.js';
import { EXERCISE_BY_ID } from '../src/lib/data.js';

const set = (reps, weightKg, extra = {}) => ({ reps, weightKg, completed: true, rpe: '', ...extra });
const session = (id, dateISO, blocks, extra = {}) => ({ id, dateISO, title: 'Upper A', blocks, durationMinutes: 50, startedAt: `${dateISO}T10:00:00`, ...extra });
const HISTORY = [
  session('s2', '2026-10-25', [{ exerciseId: 'lat-pulldown', sets: [set(12, 45)] }]),
  session('s1', '2026-10-23', [
    { exerciseId: 'chest-press-machine', sets: [set(10, 50, { rpe: '8' }), set(9, 50, { rpe: '9.5' }), set(0, 0, { skipped: true, completed: false })] },
    { exerciseId: 'lat-pulldown', sets: [set(12, 45)] },
  ], { note: 'felt "good", slept well' }),
];

describe('Hevy CSV export', () => {
  it('writes Hevy\'s column layout, oldest workout first, skipped sets left out', () => {
    const out = buildHevyExport(HISTORY, { byId: EXERCISE_BY_ID });
    assert.equal(out.workouts, 2);
    assert.equal(out.sets, 4);
    assert.equal(out.firstDate, '2026-10-23');
    assert.equal(out.lastDate, '2026-10-25');
    const recs = parseCsvRecords(out.csv);
    assert.deepEqual(recs[0], HEVY_HEADER);
    assert.equal(recs.length, 5);
    assert.equal(recs[1][1], '23 Oct 2026, 10:00');
    assert.equal(recs[1][2], '23 Oct 2026, 10:50');
    assert.equal(recs[1][3], 'felt "good", slept well');
    assert.equal(recs[1][4], 'Chest Press (Machine)');
    assert.equal(recs[1][7], '0');
    assert.equal(recs[2][7], '1');
    assert.equal(recs[2][13], '9.5');
    assert.equal(isHevyCsv(out.csv), true);
  });

  it('round-trips through the Hevy importer: same lifts, loads, reps and RPE', () => {
    const out = buildHevyExport(HISTORY, { byId: EXERCISE_BY_ID });
    const parsed = parseHevyCsv(out.csv, { byId: EXERCISE_BY_ID });
    assert.equal(parsed.skipped, 0);
    assert.deepEqual(parsed.unmappedExercises, []);
    const back = hevyRowsToHistory(parsed.rows);
    assert.equal(back.length, 2);
    assert.deepEqual(back[0].blocks.map(b => b.exerciseId), ['chest-press-machine', 'lat-pulldown']);
    assert.deepEqual(back[0].blocks[0].sets.map(s => [s.reps, s.weightKg, s.rpe]), [[10, 50, '8'], [9, 50, '9.5']]);
    assert.equal(back[0].dateISO, '2026-10-23');
    assert.equal(back[1].dateISO, '2026-10-25');
  });

  it('leaves out workouts that came from Hevy so Hevy is not sent its own data back', () => {
    const imported = session('hevy-2026-10-20-abc', '2026-10-20', [{ exerciseId: 'lat-pulldown', sets: [set(10, 40)] }], { title: 'Pull (Hevy)', note: 'Imported from Hevy CSV' });
    const sel = selectForHevy([imported, ...HISTORY]);
    assert.equal(sel.entries.length, 2);
    assert.equal(sel.fromHevy, 1);
    assert.equal(selectForHevy([imported, ...HISTORY], { includeHevyOrigin: true }).entries.length, 3);
  });

  it('skips deleted sessions, empty sessions and malformed rows', () => {
    const deleted = { ...HISTORY[0], id: 'gone', deletedAt: '2026-10-26T00:00:00Z' };
    const empty = session('e', '2026-10-26', [{ exerciseId: 'lat-pulldown', sets: [set(0, 0, { skipped: true, completed: false })] }]);
    const sel = selectForHevy([deleted, empty, null, { id: 'x' }, ...HISTORY]);
    assert.equal(sel.entries.length, 2);
  });

  it('keeps unmapped lifts under their Arise name and reports them as custom exercises', () => {
    const id = Object.keys(EXERCISE_BY_ID).find(k => hevyNameFor(k).custom);
    assert.ok(id, 'catalogue has a lift Hevy has no mapped name for');
    const out = buildHevyExport([session('c', '2026-10-22', [{ exerciseId: id, sets: [set(8, 20)] }])], { byId: EXERCISE_BY_ID });
    assert.deepEqual(out.customExercises, [EXERCISE_BY_ID[id].name]);
    assert.equal(parseCsvRecords(out.csv)[1][4], EXERCISE_BY_ID[id].name);
  });

  it('exports in pounds with a weight_lbs column the importer converts back', () => {
    const out = buildHevyExport(HISTORY, { byId: EXERCISE_BY_ID, units: 'lb' });
    const recs = parseCsvRecords(out.csv);
    assert.equal(recs[0][9], 'weight_lbs');
    assert.equal(recs[1][9], '110.2');
    const back = parseHevyCsv(out.csv, { byId: EXERCISE_BY_ID });
    assert.equal(back.rows[0].sets[0].weightKg, 50);
  });

  it('marks failed sets and uses assisted counterweight for assisted lifts', () => {
    const out = buildHevyExport([session('f', '2026-10-21', [
      { exerciseId: 'lat-pulldown', sets: [set(6, 60, { failed: true })] },
      { exerciseId: 'assisted-dip', sets: [set(8, '', { assistedKg: 25 })] },
    ])], { byId: EXERCISE_BY_ID });
    const recs = parseCsvRecords(out.csv);
    assert.equal(recs[1][8], 'failure');
    assert.equal(recs[2][4], 'Chest Dip (Assisted)');
    assert.equal(recs[2][9], '25');
  });

  it('neutralises spreadsheet formulas in titles and notes', () => {
    const out = buildHevyExport([session('x', '2026-10-21', [{ exerciseId: 'lat-pulldown', sets: [set(8, 40)] }], { title: '=HYPERLINK("x")', note: '+1 more' })], { byId: EXERCISE_BY_ID });
    const rec = parseCsvRecords(out.csv)[1];
    assert.ok(rec[0].startsWith("'="));
    assert.ok(rec[3].startsWith("'+"));
  });

  it('uses the logged day even when the stored clock time falls on another day, and estimates a missing duration', () => {
    const odd = session('o', '2026-10-21', [{ exerciseId: 'lat-pulldown', sets: [set(8, 40)] }], { startedAt: '2026-10-19T08:00:00', durationMinutes: null });
    const rec = parseCsvRecords(buildHevyExport([odd], { byId: EXERCISE_BY_ID }).csv)[1];
    assert.equal(hevyDate(rec[1]), '2026-10-21');
    assert.equal(rec[1], '21 Oct 2026, 12:00');
    assert.equal(rec[2], '21 Oct 2026, 12:45');
  });

  it('honours date ranges and the "since last export" marker', () => {
    assert.equal(rangeStart('30', '2026-10-29'), '2026-09-30');
    assert.equal(rangeStart('all', '2026-10-29'), null);
    assert.equal(rangeStart('since-last', '2026-10-29', '2026-10-23'), '2026-10-24');
    assert.equal(rangeStart('since-last', '2026-10-29', null), null);
    const out = buildHevyExport(HISTORY, { byId: EXERCISE_BY_ID, since: '2026-10-24' });
    assert.equal(out.workouts, 1);
    assert.equal(out.firstDate, '2026-10-25');
  });

  it('keeps the last-export marker on this device only and ignores junk', () => {
    const mem = new Map();
    const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    assert.equal(readExportMark(storage), null);
    assert.equal(writeExportMark('nope', storage), false);
    assert.equal(writeExportMark('2026-10-25', storage), true);
    assert.equal(readExportMark(storage), '2026-10-25');
    mem.set('arise.hevyExport.v1', 'bad');
    assert.equal(readExportMark(storage), null);
  });

  it('formats times the way Hevy writes them', () => {
    assert.equal(formatHevyTime(new Date(2026, 0, 5, 7, 3)), '05 Jan 2026, 07:03');
  });
});

import { getExerciseImage } from '../src/lib/exerciseImages.js';
describe('exercise image registry compaction', () => {
  it('derives the frame URL from the Arise id when the upstream slug is identical', () => {
    const img = getExerciseImage('push-up');
    assert.ok(img.url.endsWith('/push-up/frame-1.svg'));
  });
});
