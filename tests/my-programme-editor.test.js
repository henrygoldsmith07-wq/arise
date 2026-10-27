// My Programme editor: the override layer on the ACTIVE programme
// (src/lib/programmeEditor.js) plus its wiring into Train, Today, Gym Mode,
// persistence, export/import, sync and integrity repair.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseRepRange, formatRepRange, validateRepRange, validateDay,
  editableDays, editSummary, templateDay, hasProgrammeEdits,
  swapExercise, addExercise, removeExercise, moveExercise,
  setExerciseSets, setExerciseRepRange, renameDay, resetDay, resetAllEdits, undoLastEdit,
  swapCandidates, addCandidates, MAX_SETS,
} from '../src/lib/programmeEditor.js';
import { EXERCISE_BY_ID, exerciseAvailable } from '../src/lib/data.js';
import { generateProgramme } from '../src/lib/programmeGenerator.js';
import { sessionForToday, nextSession, markSessionDone } from '../src/lib/schedule.js';
import { normaliseRunnerBlock } from '../src/lib/sessionRunnerModel.js';
import { exerciseHistory } from '../src/lib/programming.js';
import { buildExportPayload, parseImportFile, mergeStores } from '../src/lib/export.js';
import { mergeActiveSchedule } from '../src/lib/sync.js';
import { repairStore } from '../src/lib/integrity.js';
import { decompose } from '../src/lib/storage.js';
import { localDateISO } from '../src/lib/dateOnly.js';

const src = (...p)=> readFileSync(join(process.cwd(), ...p), 'utf8');
const GYM = ['barbell', 'dumbbells', 'bench', 'rack', 'cable', 'machine', 'pullup-bar'];

// Hand-built schedule: two template days, two weeks, week 2 with its own
// progression (+1 rep) so reset fidelity and per-week preservation are real.
function fixture(){
  const b = (exerciseId, sets, reps)=> ({ exerciseId, sets, reps, restSec: 90, loadHint: 'as prescribed', version: 1 });
  const today = localDateISO();
  const day = (n)=> { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  return {
    programId: 'fixture', startDateISO: today, programVersion: 1, rev: 1, updatedAt: '2026-01-01T00:00:00.000Z',
    sessions: [
      { id: 'fx-w1-d1', programId: 'fixture', week: 1, day: 1, title: 'Push', dateISO: today, status: 'planned', blocks: [b('bench-press-dumbbell', 3, '8–12'), b('overhead-press-dumbbell', 3, '8–12'), b('push-up', 2, '10–15')] },
      { id: 'fx-w1-d2', programId: 'fixture', week: 1, day: 2, title: 'Pull', dateISO: day(2), status: 'planned', blocks: [b('dumbbell-row', 3, '8–12'), b('plank', 3, '30–45s')] },
      { id: 'fx-w2-d1', programId: 'fixture', week: 2, day: 1, title: 'Push +reps', dateISO: day(7), status: 'planned', blocks: [b('bench-press-dumbbell', 3, '9–13'), b('overhead-press-dumbbell', 3, '9–13'), b('push-up', 2, '11–16')] },
      { id: 'fx-w2-d2', programId: 'fixture', week: 2, day: 2, title: 'Pull +reps', dateISO: day(9), status: 'planned', blocks: [b('dumbbell-row', 3, '9–13'), b('plank', 3, '35–50s')] },
    ],
  };
}
const ok = (r)=> { assert.equal(r.error, null, r.error); return r.schedule; };
const dayOf = (s, key)=> editableDays(s).find(d=> d.key === key);
const ids = (s, sessionId)=> s.sessions.find(x=> x.id === sessionId).blocks.map(b=> b.exerciseId);

describe('fixture sanity', ()=>{
  it('uses real catalogue exercises', ()=>{
    for(const s of fixture().sessions) for(const b of s.blocks) assert.ok(EXERCISE_BY_ID[b.exerciseId], b.exerciseId);
  });
});

describe('rep ranges', ()=>{
  it('parses every template grammar', ()=>{
    assert.deepEqual(parseRepRange('8–12'), { min: 8, max: 12, unit: 'reps', each: false });
    assert.deepEqual(parseRepRange('5'), { min: 5, max: 5, unit: 'reps', each: false });
    assert.deepEqual(parseRepRange('8-12 each'), { min: 8, max: 12, unit: 'reps', each: true });
    assert.deepEqual(parseRepRange('30–45s'), { min: 30, max: 45, unit: 'seconds', each: false });
    assert.deepEqual(parseRepRange('30s each'), { min: 30, max: 30, unit: 'seconds', each: true });
    assert.deepEqual(parseRepRange('20 min'), { min: 20, max: 20, unit: 'minutes', each: false });
    assert.equal(parseRepRange('AMRAP'), null);
  });
  it('formats back to the same grammar', ()=>{
    for(const r of ['8–12', '5', '8–12 each', '30–45s', '30s each', '20 min']) assert.equal(formatRepRange(parseRepRange(r)), r);
  });
  it('enforces sane bounds and order', ()=>{
    assert.equal(validateRepRange({ min: 8, max: 12, unit: 'reps' }), null);
    assert.match(validateRepRange({ min: 12, max: 8, unit: 'reps' }), /must not be above/);
    assert.match(validateRepRange({ min: 0, max: 8, unit: 'reps' }), /between 1 and 50/);
    assert.match(validateRepRange({ min: 8, max: 60, unit: 'reps' }), /between 1 and 50/);
    assert.equal(validateRepRange({ min: 30, max: 45, unit: 'seconds' }), null);
    assert.match(validateRepRange({ min: 2, max: 45, unit: 'seconds' }), /between 5 and 300/);
    assert.match(validateRepRange(null), /not readable/);
  });
});

describe('reading the programme', ()=>{
  it('lists each template day once with its upcoming count', ()=>{
    const days = editableDays(fixture());
    assert.deepEqual(days.map(d=> [d.key, d.title, d.upcoming, d.edited]), [['1', 'Push', 2, false], ['2', 'Pull', 2, false]]);
    assert.equal(days[0].blocks[0].name, EXERCISE_BY_ID['bench-press-dumbbell'].name);
    assert.equal(hasProgrammeEdits(fixture()), false);
  });
  it('hides days whose sessions are all done', ()=>{
    const s = fixture();
    s.sessions = s.sessions.map(x=> x.day === 2 ? { ...x, status: 'done' } : x);
    assert.deepEqual(editableDays(s).map(d=> d.key), ['1']);
  });
  it('works on a real generated programme', ()=>{
    const g = generateProgramme({ goal: 'muscle', availableEquipment: GYM, daysPerWeek: 3, level: 'Beginner' });
    const days = editableDays(g);
    assert.ok(days.length >= 2);
    const r = setExerciseSets(g, days[0].key, 0, 5);
    assert.equal(r.error, null);
    assert.equal(dayOf(r.schedule, days[0].key).blocks[0].sets, 5);
  });
});

describe('operations', ()=>{
  it('swap rewrites every upcoming session of that day and marks it edited', ()=>{
    const s = ok(swapExercise(fixture(), '1', 0, 'incline-dumbbell-press'));
    assert.deepEqual(ids(s, 'fx-w1-d1'), ['incline-dumbbell-press', 'overhead-press-dumbbell', 'push-up']);
    assert.deepEqual(ids(s, 'fx-w2-d1'), ['incline-dumbbell-press', 'overhead-press-dumbbell', 'push-up']);
    assert.deepEqual(ids(s, 'fx-w1-d2'), ['dumbbell-row', 'plank'], 'other days untouched');
    const d = dayOf(s, '1');
    assert.equal(d.edited, true);
    assert.equal(d.blocks[0].edited, true);
    assert.equal(d.blocks[0].swappedFrom, 'bench-press-dumbbell');
    assert.equal(d.blocks[1].edited, false);
    assert.equal(s.sessions[0].blocks[0].userSwapFrom, 'bench-press-dumbbell');
    assert.equal(hasProgrammeEdits(s), true);
  });

  it('never rewrites a completed session', ()=>{
    const base = fixture();
    base.sessions[0] = { ...base.sessions[0], status: 'done' };
    const s = ok(swapExercise(base, '1', 0, 'incline-dumbbell-press'));
    assert.deepEqual(ids(s, 'fx-w1-d1'), ['bench-press-dumbbell', 'overhead-press-dumbbell', 'push-up']);
    assert.deepEqual(ids(s, 'fx-w2-d1')[0], 'incline-dumbbell-press');
  });

  it('swap keeps the slot prescription, but fixes a unit mismatch', ()=>{
    const s = ok(swapExercise(fixture(), '2', 1, 'dead-bug'));
    const block = dayOf(s, '2').blocks[1];
    const timed = EXERCISE_BY_ID['dead-bug'].progression === 'time';
    assert.equal(parseRepRange(block.reps).unit, timed ? 'seconds' : 'reps');
    const kept = ok(swapExercise(fixture(), '1', 0, 'incline-dumbbell-press'));
    assert.equal(dayOf(kept, '1').blocks[0].sets, 3);
    assert.equal(dayOf(kept, '1').blocks[0].reps, '8–12');
  });

  it('swap rejects duplicates, same exercise and unknown ids', ()=>{
    assert.match(swapExercise(fixture(), '1', 0, 'push-up').error, /already in this day/);
    assert.match(swapExercise(fixture(), '1', 0, 'bench-press-dumbbell').error, /already the exercise/);
    assert.match(swapExercise(fixture(), '1', 0, 'not-a-lift').error, /Unknown exercise/);
    assert.match(swapExercise(fixture(), '1', 9, 'incline-dumbbell-press').error, /no longer in this day/);
  });

  it('swapping back to the original clears the edit entirely', ()=>{
    const once = ok(swapExercise(fixture(), '1', 0, 'incline-dumbbell-press'));
    const back = ok(swapExercise(once, '1', 0, 'bench-press-dumbbell'));
    assert.equal(dayOf(back, '1').edited, false);
    assert.equal(hasProgrammeEdits(back), false);
    assert.deepEqual(back.sessions.map(x=> x.blocks), fixture().sessions.map(x=> x.blocks));
  });

  it('add appends with sensible defaults; rejects duplicates and overfull days', ()=>{
    const s = ok(addExercise(fixture(), '2', 'face-pull'));
    const added = dayOf(s, '2').blocks.at(-1);
    assert.equal(added.exerciseId, 'face-pull');
    assert.equal(added.sets, 3);
    assert.equal(added.reps, EXERCISE_BY_ID['face-pull'].progression === 'time' ? '30–45s' : '8–12');
    assert.equal(added.edited, true);
    assert.equal(s.sessions.find(x=> x.id === 'fx-w1-d2').blocks.at(-1).exerciseId, 'face-pull');
    assert.match(addExercise(fixture(), '2', 'plank').error, /already in this day/);
    let full = fixture();
    const extras = ['face-pull', 'bicep-curl', 'lateral-raise', 'dead-bug', 'glute-bridge', 'bodyweight-squat', 'calf-raise', 'goblet-squat', 'lunge', 'hammer-curl'].filter(id=> EXERCISE_BY_ID[id]);
    for(const id of extras){ const r = addExercise(full, '2', id); if(!r.error) full = r.schedule; }
    if(dayOf(full, '2').blocks.length === 12){
      assert.match(addExercise(full, '2', 'push-up').error, /at most 12/);
    }
  });

  it('remove drops one exercise but never empties a day', ()=>{
    const s = ok(removeExercise(fixture(), '1', 2));
    assert.deepEqual(dayOf(s, '1').blocks.map(b=> b.exerciseId), ['bench-press-dumbbell', 'overhead-press-dumbbell']);
    let one = ok(removeExercise(fixture(), '2', 1));
    assert.match(removeExercise(one, '2', 0).error, /at least one exercise/);
  });

  it('reorders up and down within bounds', ()=>{
    const s = ok(moveExercise(fixture(), '1', 2, -1));
    assert.deepEqual(dayOf(s, '1').blocks.map(b=> b.exerciseId), ['bench-press-dumbbell', 'push-up', 'overhead-press-dumbbell']);
    const d = ok(moveExercise(fixture(), '1', 0, 1));
    assert.deepEqual(dayOf(d, '1').blocks.map(b=> b.exerciseId), ['overhead-press-dumbbell', 'bench-press-dumbbell', 'push-up']);
    assert.match(moveExercise(fixture(), '1', 0, -1).error, /cannot move/);
    assert.match(moveExercise(fixture(), '1', 2, 1).error, /cannot move/);
  });

  it('sets are bounded 1–8', ()=>{
    const s = ok(setExerciseSets(fixture(), '1', 0, 5));
    assert.equal(s.sessions.find(x=> x.id === 'fx-w1-d1').blocks[0].sets, 5);
    assert.equal(s.sessions.find(x=> x.id === 'fx-w2-d1').blocks[0].sets, 5);
    assert.match(setExerciseSets(fixture(), '1', 0, 0).error, /1–8/);
    assert.match(setExerciseSets(fixture(), '1', 0, MAX_SETS + 1).error, /1–8/);
    assert.match(setExerciseSets(fixture(), '1', 0, 2.5).error, /1–8/);
  });

  it('rep range keeps unit and side marker, and validates', ()=>{
    const s = ok(setExerciseRepRange(fixture(), '1', 0, { min: 6, max: 8 }));
    assert.equal(dayOf(s, '1').blocks[0].reps, '6–8');
    const t = ok(setExerciseRepRange(fixture(), '2', 1, { min: 40, max: 60 }));
    assert.equal(dayOf(t, '2').blocks[1].reps, '40–60s');
    const fixed = ok(setExerciseRepRange(fixture(), '1', 0, { min: 5, max: 5 }));
    assert.equal(dayOf(fixed, '1').blocks[0].reps, '5');
    assert.match(setExerciseRepRange(fixture(), '1', 0, { min: 10, max: 6 }).error, /must not be above/);
    assert.match(setExerciseRepRange(fixture(), '1', 0, { min: 1, max: 99 }).error, /between 1 and 50/);
  });

  it('untouched prescriptions keep each week’s own template progression', ()=>{
    const s = ok(setExerciseSets(fixture(), '1', 0, 4));
    const w2 = s.sessions.find(x=> x.id === 'fx-w2-d1');
    assert.equal(w2.blocks[0].sets, 4, 'the edited value applies to week 2');
    assert.equal(w2.blocks[0].reps, '9–13', 'week 2’s +rep progression survives');
    assert.equal(w2.blocks[1].reps, '9–13');
    assert.equal(w2.title, 'Push +reps', 'week title kept when the day was not renamed');
  });

  it('rename validates and shows on every upcoming session', ()=>{
    const s = ok(renameDay(fixture(), '1', '  Chest & shoulders '));
    assert.equal(dayOf(s, '1').title, 'Chest & shoulders');
    assert.equal(dayOf(s, '1').renamed, true);
    assert.equal(s.sessions.find(x=> x.id === 'fx-w2-d1').title, 'Chest & shoulders');
    assert.match(renameDay(fixture(), '1', '   ').error, /name/);
    assert.match(renameDay(fixture(), '1', 'x'.repeat(41)).error, /under 40/);
  });

  it('every edit bumps rev and updatedAt so sync converges on it', ()=>{
    const base = fixture();
    const s = ok(setExerciseSets(base, '1', 0, 4));
    assert.equal(s.rev, base.rev + 1);
    assert.ok(s.updatedAt > base.updatedAt);
  });

  it('rejects edits on unknown or finished days and with no programme', ()=>{
    assert.match(setExerciseSets(fixture(), '9', 0, 4).error, /no upcoming sessions/);
    assert.match(setExerciseSets(null, '1', 0, 4).error, /No active programme/);
    const original = fixture();
    const r = setExerciseSets(original, '1', 0, 99);
    assert.equal(r.schedule, original, 'input returned unchanged on error');
  });
});

describe('reset and undo', ()=>{
  it('reset day restores each session exactly (week variations included)', ()=>{
    let s = ok(swapExercise(fixture(), '1', 0, 'incline-dumbbell-press'));
    s = ok(setExerciseSets(s, '1', 1, 6));
    s = ok(renameDay(s, '1', 'Mine'));
    s = ok(addExercise(s, '2', 'face-pull'));
    const r = ok(resetDay(s, '1'));
    const f = fixture();
    assert.deepEqual(r.sessions.filter(x=> x.day === 1).map(x=> [x.title, x.blocks]), f.sessions.filter(x=> x.day === 1).map(x=> [x.title, x.blocks]));
    assert.equal(dayOf(r, '2').edited, true, 'other days keep their edits');
    assert.match(resetDay(r, '1').error, /already matches/);
  });

  it('reset all restores the template and clears the layer', ()=>{
    let s = ok(swapExercise(fixture(), '1', 0, 'incline-dumbbell-press'));
    s = ok(addExercise(s, '2', 'face-pull'));
    assert.deepEqual(editSummary(s).days, 2);
    const r = ok(resetAllEdits(s));
    assert.deepEqual(r.sessions.map(x=> x.blocks), fixture().sessions.map(x=> x.blocks));
    assert.equal(hasProgrammeEdits(r), false);
    assert.match(resetAllEdits(fixture()).error, /already matches/);
  });

  it('undo reverts the last change only, then has nothing left', ()=>{
    let s = ok(setExerciseSets(fixture(), '1', 0, 5));
    s = ok(moveExercise(s, '1', 0, 1));
    assert.match(editSummary(s).undoLabel, /^Move .* down$/);
    const u = ok(undoLastEdit(s));
    const d = dayOf(u, '1');
    assert.deepEqual(d.blocks.map(b=> b.exerciseId), ['bench-press-dumbbell', 'overhead-press-dumbbell', 'push-up']);
    assert.equal(d.blocks[0].sets, 5, 'the earlier edit stays');
    assert.equal(editSummary(u).canUndo, false);
    assert.match(undoLastEdit(u).error, /Nothing to undo/);
  });

  it('undo after reset all brings every edit back', ()=>{
    let s = ok(swapExercise(fixture(), '1', 0, 'incline-dumbbell-press'));
    s = ok(setExerciseSets(s, '2', 0, 4));
    const r = ok(resetAllEdits(s));
    const u = ok(undoLastEdit(r));
    assert.deepEqual(ids(u, 'fx-w1-d1')[0], 'incline-dumbbell-press');
    assert.equal(u.sessions.find(x=> x.id === 'fx-w1-d2').blocks[0].sets, 4);
    assert.equal(u.sessions.find(x=> x.id === 'fx-w2-d1').blocks[1].reps, '9–13', 'week 2 still keeps its own reps');
  });

  it('template view stays the pre-edit programme', ()=>{
    const s = ok(swapExercise(fixture(), '1', 0, 'incline-dumbbell-press'));
    assert.equal(templateDay(s, '1').blocks[0].exerciseId, 'bench-press-dumbbell');
  });
});

describe('validation', ()=>{
  it('validateDay catches empty, duplicates, bad sets/reps and names', ()=>{
    const good = { title: 'A', blocks: [{ exerciseId: 'push-up', sets: 3, reps: '8–12' }] };
    assert.deepEqual(validateDay(good), []);
    assert.ok(validateDay({ title: 'A', blocks: [] }).some(e=> /at least one/.test(e)));
    assert.ok(validateDay({ title: 'A', blocks: [good.blocks[0], good.blocks[0]] }).some(e=> /already in this day/.test(e)));
    assert.ok(validateDay({ title: 'A', blocks: [{ ...good.blocks[0], sets: 9 }] }).some(e=> /Sets/.test(e)));
    assert.ok(validateDay({ title: 'A', blocks: [{ ...good.blocks[0], reps: '12–8' }] }).some(e=> /above/.test(e)));
    assert.ok(validateDay({ title: '', blocks: good.blocks }).some(e=> /name/.test(e)));
    assert.ok(validateDay({ title: 'A', blocks: [{ exerciseId: 'nope', sets: 3, reps: '8' }] }).some(e=> /Unknown/.test(e)));
    assert.deepEqual(validateDay(null), ['Day is missing.']);
  });
});

describe('swap ranking', ()=>{
  const kit = ['dumbbells', 'bench'];
  it('offers only kit-compatible, non-avoided, not-already-in-day alternatives', ()=>{
    const all = swapCandidates(fixture(), '1', 0, { availableEquipment: kit, limit: 20 });
    assert.ok(all.length > 0);
    for(const c of all){
      assert.ok(exerciseAvailable(c.id, [...kit, 'bodyweight']), `${c.id} fits the kit`);
      assert.ok(!['bench-press-dumbbell', 'overhead-press-dumbbell', 'push-up'].includes(c.id));
    }
    const avoided = all[0].id;
    const without = swapCandidates(fixture(), '1', 0, { availableEquipment: kit, dislikedExerciseIds: [avoided], limit: 20 });
    assert.ok(!without.some(c=> c.id === avoided), 'avoided never offered');
  });
  it('ranks same-muscle first and lifts liked ones', ()=>{
    const all = swapCandidates(fixture(), '1', 0, { availableEquipment: kit, limit: 10 });
    assert.equal(all[0].muscle, EXERCISE_BY_ID['bench-press-dumbbell'].muscle);
    const pick = all.at(-1).id;
    const liked = swapCandidates(fixture(), '1', 0, { availableEquipment: kit, preferredExerciseIds: [pick], limit: 10 });
    assert.ok(liked.findIndex(c=> c.id === pick) < all.findIndex(c=> c.id === pick), 'liked moves up');
    assert.equal(liked.find(c=> c.id === pick).liked, true);
  });
  it('a no-kit profile does not filter by equipment', ()=>{
    assert.ok(swapCandidates(fixture(), '1', 0, { availableEquipment: [] }).length > 0);
  });
  it('offers the original first after a swap', ()=>{
    const s = ok(swapExercise(fixture(), '1', 0, 'incline-dumbbell-press'));
    const c = swapCandidates(s, '1', 0, { availableEquipment: kit });
    assert.equal(c[0].id, 'bench-press-dumbbell');
    assert.equal(c[0].original, true);
  });
  it('add candidates: kit, avoid, search, liked first, nothing already in the day', ()=>{
    const res = addCandidates(fixture(), '1', { availableEquipment: kit, query: 'curl', preferredExerciseIds: ['hammer-curl'], limit: 50 });
    assert.ok(res.length > 0);
    for(const r of res) assert.ok(exerciseAvailable(r.id, [...kit, 'bodyweight']));
    if(res.some(r=> r.id === 'hammer-curl')) assert.equal(res[0].id, 'hammer-curl');
    assert.ok(!addCandidates(fixture(), '1', { query: 'push' }).some(r=> r.id === 'push-up'));
    assert.ok(!addCandidates(fixture(), '1', { query: 'curl', dislikedExerciseIds: ['bicep-curl'] }).some(r=> r.id === 'bicep-curl'));
  });
});

describe('Today, Gym Mode and progression read the edited programme', ()=>{
  it('Today’s session and the runner show the swapped exercise with the new set count', ()=>{
    let s = ok(swapExercise(fixture(), '1', 0, 'incline-dumbbell-press'));
    s = ok(setExerciseSets(s, '1', 0, 5));
    const today = sessionForToday(s) || nextSession(s);
    assert.equal(today.blocks[0].exerciseId, 'incline-dumbbell-press');
    assert.equal(today.blocks[0].sets, 5);
    const runner = normaliseRunnerBlock(today.blocks[0], [], null, 0);
    assert.equal(runner.exerciseId, 'incline-dumbbell-press');
    assert.equal(runner.sets.length, 5, 'Gym Mode renders five set rows');
  });

  it('completing an edited session logs the edited exercise', ()=>{
    const s = ok(swapExercise(fixture(), '1', 0, 'incline-dumbbell-press'));
    const store = markSessionDone({ activeSchedule: s, history: [] }, s.sessions[0]);
    assert.equal(store.history[0].blocks[0].exerciseId, 'incline-dumbbell-press');
    assert.equal(editableDays(store.activeSchedule).find(d=> d.key === '1').upcoming, 1);
  });

  it('history stays keyed by exercise id, so swapping back resumes it', ()=>{
    const history = [{ id: 'h1', dateISO: '2026-01-05', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '10', weightKg: '22.5', rpe: '' }] }] }];
    const before = exerciseHistory(history, 'bench-press-dumbbell');
    const swapped = ok(swapExercise(fixture(), '1', 0, 'incline-dumbbell-press'));
    const back = ok(swapExercise(swapped, '1', 0, 'bench-press-dumbbell'));
    assert.equal((sessionForToday(back) || nextSession(back)).blocks[0].exerciseId, 'bench-press-dumbbell');
    assert.deepEqual(exerciseHistory(history, 'bench-press-dumbbell'), before);
    assert.ok(before.length > 0);
  });
});

describe('persistence', ()=>{
  const edited = ()=> ok(setExerciseSets(ok(swapExercise(fixture(), '1', 0, 'incline-dumbbell-press')), '1', 0, 5));

  it('rides the IndexedDB programme store', ()=>{
    const parts = decompose({ activeSchedule: edited(), history: [], programHistory: [] });
    assert.ok(parts.programme.activeSchedule.programmeEdits.original['fx-w1-d1'], 'pre-edit snapshot persisted for reset');
    assert.equal(parts.programme.activeSchedule.programmeEdits.days['1'].blocks[0].exerciseId, 'incline-dumbbell-press');
  });

  it('survives export → import (replace and into an empty device)', ()=>{
    const store = { version: 1, onboarding: { goal: 'muscle', equipment: ['dumbbells'], location: 'home' }, activeSchedule: edited(), history: [], preferences: { units: 'kg' } };
    const parsed = parseImportFile(JSON.stringify(buildExportPayload(store)));
    assert.deepEqual(parsed.activeSchedule.programmeEdits.days, store.activeSchedule.programmeEdits.days);
    assert.deepEqual(parsed.activeSchedule.sessions, store.activeSchedule.sessions);
    const replaced = mergeStores({ activeSchedule: null, history: [] }, parsed, 'replace');
    assert.equal(replaced.activeSchedule.sessions[0].blocks[0].exerciseId, 'incline-dumbbell-press');
    const merged = mergeStores({ activeSchedule: null, history: [] }, parsed, 'merge');
    assert.equal(merged.activeSchedule.programmeEdits.days['1'].blocks[0].sets, 5);
    // reset still works after the round trip
    const r = ok(resetAllEdits(merged.activeSchedule));
    assert.deepEqual(r.sessions.map(x=> x.blocks), fixture().sessions.map(x=> x.blocks));
  });

  it('sync keeps the newer edited schedule from either side', ()=>{
    const base = fixture();
    const mine = edited();
    assert.equal(mergeActiveSchedule(base, mine).programmeEdits.days['1'].blocks[0].exerciseId, 'incline-dumbbell-press');
    assert.equal(mergeActiveSchedule(mine, base).programmeEdits.days['1'].blocks[0].exerciseId, 'incline-dumbbell-press');
  });

  it('integrity repair drops a malformed layer but keeps the programme', ()=>{
    const bad = { ...edited(), programmeEdits: { days: { 1: { blocks: 'oops' } } } };
    const fixed = repairStore({ activeSchedule: bad });
    assert.equal(fixed.activeSchedule.programmeEdits, undefined);
    assert.equal(fixed.activeSchedule.sessions[0].blocks[0].exerciseId, 'incline-dumbbell-press');
    const good = repairStore({ activeSchedule: edited() });
    assert.ok(good.activeSchedule.programmeEdits.days['1']);
  });
});

describe('UI wiring (source level)', ()=>{
  const train = src('src', 'components', 'TrainView.jsx');
  const editor = src('src', 'components', 'ProgrammeEditor.jsx');
  const today = src('src', 'components', 'TodayView.jsx');

  it('Train lazy-loads the editor and never imports the engine statically', ()=>{
    assert.match(train, /lazy\(\(\) => import\('\.\/ProgrammeEditor\.jsx'\)\)/);
    assert.doesNotMatch(train, /from '\.\.\/lib\/programmeEditor\.js'/);
    assert.match(train, /Edit programme/);
    assert.match(train, /data-testid="programme-customised-badge"/);
  });

  it('switching or clearing a customised programme warns first', ()=>{
    assert.match(train, /Replace your customised programme\?/);
    for(const fn of ['startRecommendation', 'start', 'startShelfItem', 'generateFromProfile', 'clearSchedule']){
      const body = train.match(new RegExp(`const ${fn} = async \\([^)]*\\)=>\\{([\\s\\S]*?)\\n  \\};`))?.[1] || '';
      assert.match(body, /await confirmDropEdits\(\)/, `${fn} confirms before dropping edits`);
    }
  });

  it('editor uses the shared dialogs, 44px targets and labelled controls', ()=>{
    assert.match(editor, /useDialogs\(\)/);
    assert.match(editor, /dialogs\.confirm\(\{[\s\S]*?destructive: true/);
    assert.match(editor, /aria-label="My programme"/);
    assert.match(editor, /aria-modal="true"/);
    assert.match(editor, /role="status"/);
    for(const label of ['Swap ', 'Move ', 'Remove ', 'Decrease ', 'Increase ', 'Undo ']) assert.ok(editor.includes(`aria-label={\`${label}`), `labelled: ${label}`);
    assert.match(editor, /min-h-11 min-w-11/);
    assert.doesNotMatch(editor, /window\.confirm|window\.prompt/);
    for(const op of ['swapExercise', 'addExercise', 'removeExercise', 'moveExercise', 'setExerciseSets', 'setExerciseRepRange', 'renameDay', 'resetDay', 'resetAllEdits', 'undoLastEdit']){
      assert.match(editor, new RegExp(`${op}\\(`), `editor calls ${op}`);
    }
    assert.match(editor, /Edited/);
  });

  it('Today marks a user swap', ()=>{
    assert.match(today, /b\.userSwapFrom && <span[^>]*>your swap<\/span>/);
  });
});
