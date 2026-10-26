import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAppCsv, rowsToHistory } from '../src/lib/appCsvImport.js';
import { exerciseTokenKey, stemToken, isHevyCsv, parseCsvRecords, hevyDate, parseHevyCsv, HEVY_EXERCISE_MAP } from '../src/lib/hevyCsvImport.js';
import { EXERCISE_BY_ID } from '../src/lib/data.js';
import { importAppCsv } from '../src/services/restoreService.js';

const HEAD = 'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe';
const CSV = [
  HEAD,
  '"Upper A, heavy","23 Oct 2026, 18:30","23 Oct 2026, 19:20","felt ""good"",\nslept well","Chest Press (Machine)",,"",0,warmup,20,12,,,',
  '"Upper A, heavy","23 Oct 2026, 18:30","23 Oct 2026, 19:20","","Chest Press (Machine)",,"",1,normal,50,10,,,8',
  '"Upper A, heavy","23 Oct 2026, 18:30","23 Oct 2026, 19:20","","Chest Press (Machine)",,"",2,normal,50,9,,,9',
  '"Upper A, heavy","23 Oct 2026, 18:30","23 Oct 2026, 19:20","","Lat Pulldown (Cable)",,"",0,normal,45,12,,,',
  '"Upper A, heavy","23 Oct 2026, 18:30","23 Oct 2026, 19:20","","Zercher Mystery Lift",,"",0,normal,30,8,,,',
  '"Easy spin","25 Oct 2026, 07:00","25 Oct 2026, 08:00","","Cycling (Outdoor)",,"",0,normal,,,30,3600,',
].join('\n');

describe('Hevy CSV import', () => {
  it('detects Hevy exports and not the generic format', () => {
    assert.equal(isHevyCsv(CSV), true);
    assert.equal(isHevyCsv('date,exercise,weight,reps\n2026-01-01,bench,50,5'), false);
  });
  it('parses quoted commas, escaped quotes and newlines inside cells', () => {
    const recs = parseCsvRecords(CSV);
    assert.equal(recs.length, 7);
    assert.equal(recs[1][0], 'Upper A, heavy');
    assert.equal(recs[1][3], 'felt "good",\nslept well');
  });
  it('reads Hevy date formats as the calendar day written', () => {
    assert.equal(hevyDate('23 Oct 2026, 18:30'), '2026-10-23');
    assert.equal(hevyDate('2026-10-23 18:30:00'), '2026-10-23');
    assert.equal(hevyDate('Oct 23, 2026, 6:30 PM'), '2026-10-23');
    assert.equal(hevyDate('nonsense'), null);
  });
  it('groups sets into one workout, drops warm-ups, reports unknown lifts', () => {
    const r = parseHevyCsv(CSV, { byId: EXERCISE_BY_ID });
    assert.equal(r.warmupsDropped, 1);
    assert.equal(r.workouts, 1);
    assert.deepEqual(r.unmappedExercises.sort(), ['Cycling (Outdoor)', 'Zercher Mystery Lift'].sort());
    const press = r.rows.find(x => x.exerciseId === 'chest-press-machine');
    assert.deepEqual(press.sets.map(s => [s.weightKg, s.reps, s.rpe]), [[50, 10, '8'], [50, 9, '9']]);
  });
  it('parseAppCsv routes Hevy files and rowsToHistory titles the real workout', () => {
    const r = parseAppCsv(CSV, { byId: EXERCISE_BY_ID });
    const h = rowsToHistory(r.rows, { byId: EXERCISE_BY_ID });
    assert.equal(h.length, 1);
    assert.equal(h[0].dateISO, '2026-10-23');
    assert.equal(h[0].title, 'Upper A, heavy (Hevy)');
    assert.equal(h[0].blocks.length, 2);
  });
  it('converts lbs exports and separates two workouts on one day', () => {
    const csv = [
      'title,start_time,exercise_title,set_index,set_type,weight_lbs,reps,rpe',
      'AM,"23 Oct 2026, 07:00",Face Pull,0,normal,44,15,',
      'PM,"23 Oct 2026, 18:00",Face Pull,0,normal,44,15,',
    ].join('\n');
    const r = parseAppCsv(csv, { byId: EXERCISE_BY_ID });
    const h = rowsToHistory(r.rows);
    assert.equal(h.length, 2);
    assert.equal(h[0].blocks[0].sets[0].weightKg, 20);
  });
  it('end-to-end through importAppCsv merges into the store', async () => {
    const res = await importAppCsv({ text: CSV, store: { history: [], eventHistory: [] }, byId: EXERCISE_BY_ID, parse: parseAppCsv, rowsToHistory });
    assert.equal(res.ok, true);
    assert.equal(res.source, 'hevy');
    assert.equal(res.warmupsDropped, 1);
    assert.equal(res.store.history.length, 1);
  });
  it('every mapped id exists in the exercise library', () => {
    for(const [name, id] of Object.entries(HEVY_EXERCISE_MAP)) assert.ok(EXERCISE_BY_ID[id], `${name} → ${id}`);
  });
});

describe('imported sessions survive the merge (regression: id-less entries were dropped)', () => {
  it('generic CSV import lands in history and re-import does not duplicate', async () => {
    const csv = 'date,exercise,weight,reps\n2026-10-23,Face Pull,20,12';
    const a = await importAppCsv({ text: csv, store: { history: [] }, byId: EXERCISE_BY_ID, parse: parseAppCsv, rowsToHistory });
    assert.equal(a.store.history.length, 1);
    assert.match(a.store.history[0].id, /^csv-2026-10-23-/);
    const b = await importAppCsv({ text: csv, store: a.store, byId: EXERCISE_BY_ID, parse: parseAppCsv, rowsToHistory });
    assert.equal(b.store.history.length, 1);
  });
  it('Hevy re-import is idempotent', async () => {
    const a = await importAppCsv({ text: CSV, store: { history: [] }, byId: EXERCISE_BY_ID, parse: parseAppCsv, rowsToHistory });
    const b = await importAppCsv({ text: CSV, store: a.store, byId: EXERCISE_BY_ID, parse: parseAppCsv, rowsToHistory });
    assert.equal(b.store.history.length, 1);
    assert.match(b.store.history[0].id, /^hevy-2026-10-23-/);
  });
});

test('exerciseTokenKey keeps words ending in ss intact and stems plurals', async () => {
  assert.equal(stemToken('press'), 'press');
  assert.equal(stemToken('curls'), 'curl');
  assert.equal(stemToken('benches'), 'bench');
  assert.ok(exerciseTokenKey('Bench Press (Dumbbell)').includes('press'));
  assert.equal(exerciseTokenKey('Bench Press (Dumbbell)'), exerciseTokenKey('Dumbbell Bench Press'));
});
