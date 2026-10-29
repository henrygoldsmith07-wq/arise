// Supersets + per-exercise rest (backlog 35): editor operations, the shared
// pair model, Gym Mode alternation (A1 → B1 → rest → A2 …), the rest the
// RestDock uses, the duration estimate, and persistence into templates.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pairWithNext, unpairExercise, setExerciseRest, moveExercise, removeExercise, swapExercise,
  editableDays, editSummary, undoLastEdit, editsAsTemplateInput, formatRestShort, REST_BOUNDS,
} from '../src/lib/programmeEditor.js';
import { normalisePairs, supersetPartner, supersetStep, pairRestSec } from '../src/lib/superset.js';
import { nextActionableBlockIndex, normaliseRunnerBlock } from '../src/lib/sessionRunnerModel.js';
import { restForBlock } from '../src/lib/gymMode.js';
import { predictSessionDuration } from '../src/lib/warmup.js';
import { buildEditorTemplate } from '../src/lib/templateEditor.js';
import { encodeShareCode, decodeShareCode } from '../src/lib/shareCodes.js';
import { repairStore } from '../src/lib/integrity.js';

const src = (...p)=> readFileSync(join(process.cwd(), ...p), 'utf8');
const b = (exerciseId, sets = 3, reps = '8–12', restSec = 90)=> ({ exerciseId, sets, reps, restSec, loadHint: '', version: 1 });
function fixture(){
  return {
    programId: 'fx', startDateISO: '2026-10-01', programVersion: 1, rev: 1,
    sessions: [
      { id: 'w1d1', week: 1, day: 1, title: 'Upper', status: 'planned', blocks: [b('bench-press-dumbbell'), b('dumbbell-row'), b('overhead-press-dumbbell'), b('plank', 3, '30–45s', 60)] },
      { id: 'w2d1', week: 2, day: 1, title: 'Upper', status: 'planned', blocks: [b('bench-press-dumbbell', 3, '9–13'), b('dumbbell-row', 3, '9–13'), b('overhead-press-dumbbell'), b('plank', 3, '30–45s', 60)] },
      { id: 'w0d1', week: 0, day: 1, title: 'Upper', status: 'done', blocks: [b('bench-press-dumbbell'), b('dumbbell-row')] },
    ],
  };
}
const run = (blocks)=> blocks.map(x=> ({ ...x, sets: Array.from({ length: x.sets }, ()=> ({ completed: false })) }));
const done = (blocks, bi, si)=> blocks.map((x, i)=> i !== bi ? x : { ...x, sets: x.sets.map((s, j)=> j === si ? { ...s, completed: true } : s) });

describe('editor: pair with next / unpair', ()=>{
  it('pairs two neighbours and materialises supersetWith into every upcoming session', ()=>{
    const r = pairWithNext(fixture(), '1', 0);
    assert.equal(r.error, null);
    const upcoming = r.schedule.sessions.filter(s=> s.status !== 'done');
    for(const s of upcoming) assert.equal(s.blocks[0].supersetWith, 'dumbbell-row');
    assert.equal(r.schedule.sessions.find(s=> s.status === 'done').blocks[0].supersetWith, undefined, 'completed sessions untouched');
    assert.equal(editableDays(r.schedule)[0].blocks[0].edited, true);
    assert.equal(editSummary(r.schedule).days, 1);
    assert.match(r.schedule.programmeEdits.undo.label, /Superset/);
  });

  it('refuses the last exercise, an already-paired exercise and tri-sets', ()=>{
    const s = pairWithNext(fixture(), '1', 0).schedule;
    assert.match(pairWithNext(fixture(), '1', 3).error, /no next exercise/);
    assert.match(pairWithNext(s, '1', 0).error, /already in a superset/);
    assert.match(pairWithNext(s, '1', 1).error, /already in a superset/, 'B of a pair cannot start another pair');
    assert.equal(pairWithNext(s, '1', 2).error, null, 'a second, separate pair is fine');
  });

  it('unpair works from either half and clears back to the template', ()=>{
    const s = pairWithNext(fixture(), '1', 0).schedule;
    for(const i of [0, 1]){
      const r = unpairExercise(s, '1', i);
      assert.equal(r.error, null);
      assert.ok(r.schedule.sessions.every(x=> x.blocks.every(y=> y.supersetWith === undefined)));
      assert.equal(r.schedule.programmeEdits?.days?.['1'], undefined, 'no edit left once it matches the template');
    }
    assert.match(unpairExercise(fixture(), '1', 0).error, /not in a superset/);
  });

  it('moving or removing a half drops the pair; swapping B keeps it', ()=>{
    const s = pairWithNext(fixture(), '1', 0).schedule;
    const moved = moveExercise(s, '1', 1, 1).schedule;
    assert.ok(editableDays(moved)[0].blocks.every(x=> !x.supersetWith));
    const removed = removeExercise(s, '1', 1).schedule;
    assert.ok(editableDays(removed)[0].blocks.every(x=> !x.supersetWith));
    const swapped = swapExercise(s, '1', 1, 'lat-pulldown');
    assert.equal(swapped.error, null);
    assert.equal(editableDays(swapped.schedule)[0].blocks[0].supersetWith, 'lat-pulldown');
  });

  it('undo restores the pre-pair programme', ()=>{
    const s = pairWithNext(fixture(), '1', 0).schedule;
    const u = undoLastEdit(s).schedule;
    assert.ok(u.sessions.every(x=> x.blocks.every(y=> !y.supersetWith)));
  });
});

describe('editor: per-exercise rest', ()=>{
  it('sets rest in 15 s steps within bounds and writes it to upcoming sessions', ()=>{
    const r = setExerciseRest(fixture(), '1', 0, 150);
    assert.equal(r.error, null);
    for(const s of r.schedule.sessions.filter(x=> x.status !== 'done')) assert.equal(s.blocks[0].restSec, 150);
    assert.equal(editableDays(r.schedule)[0].blocks[0].edited, true);
    assert.match(r.schedule.programmeEdits.undo.label, /rest 2:30/);
    assert.match(setExerciseRest(fixture(), '1', 0, REST_BOUNDS.min - 1).error, /Rest must be/);
    assert.match(setExerciseRest(fixture(), '1', 0, REST_BOUNDS.max + 15).error, /Rest must be/);
    assert.equal(setExerciseRest(fixture(), '1', 0, 90).schedule.programmeEdits?.days?.['1'], undefined, 'same as template → no edit');
  });

  it('formats rest compactly', ()=>{
    assert.equal(formatRestShort(45), '45s');
    assert.equal(formatRestShort(90), '1:30');
    assert.equal(formatRestShort(300), '5:00');
  });
});

describe('pair model', ()=>{
  it('normalisePairs keeps valid pairs only', ()=>{
    const blocks = [{ exerciseId: 'a', supersetWith: 'b' }, { exerciseId: 'b', supersetWith: 'c' }, { exerciseId: 'c' }, { exerciseId: 'd', supersetWith: 'x' }, { exerciseId: 'e', supersetWith: 7 }];
    const out = normalisePairs(blocks);
    assert.equal(out[0].supersetWith, 'b');
    assert.equal(out[1].supersetWith, undefined, 'no tri-set chain');
    assert.equal(out[3].supersetWith, undefined, 'must point at the neighbour');
    assert.equal(out[4].supersetWith, undefined, 'must be a string');
    assert.equal(blocks[1].supersetWith, 'c', 'input not mutated');
  });

  it('supersetPartner finds both halves and ignores stale pointers', ()=>{
    const blocks = [{ exerciseId: 'a', supersetWith: 'b' }, { exerciseId: 'b' }, { exerciseId: 'c', supersetWith: 'z' }, { exerciseId: 'd' }];
    assert.equal(supersetPartner(blocks, 0), 1);
    assert.equal(supersetPartner(blocks, 1), 0);
    assert.equal(supersetPartner(blocks, 2), null);
    assert.equal(supersetPartner(blocks, 3), null);
  });

  it('pair rest is the longer of the two', ()=>{
    assert.equal(pairRestSec(60, 150), 150);
    assert.equal(pairRestSec(undefined, 90), 90);
  });
});

describe('Gym Mode alternates A1 → B1 → rest → A2 → B2', ()=>{
  const plan = ()=> run([{ exerciseId: 'a', sets: 3, supersetWith: 'b' }, { exerciseId: 'b', sets: 3 }, { exerciseId: 'c', sets: 2 }]);

  it('walks the full pair with one rest per round', ()=>{
    let blocks = plan();
    const trace = [];
    let focus = 0;
    for(let n = 0; n < 6; n++){
      const si = blocks[focus].sets.findIndex(s=> !s.completed);
      blocks = done(blocks, focus, si);
      const step = supersetStep(blocks, focus);
      trace.push(`${focus === 0 ? 'A' : 'B'}${si + 1}:${step.rest}`);
      focus = step.focus ?? nextActionableBlockIndex(blocks, focus);
    }
    assert.deepEqual(trace, ['A1:none', 'B1:pair', 'A2:none', 'B2:pair', 'A3:none', 'B3:own']);
    assert.equal(focus, 2, 'then on to the next exercise');
  });

  it('uneven pairs fall back to straight sets once the partner is finished', ()=>{
    let blocks = run([{ exerciseId: 'a', sets: 3, supersetWith: 'b' }, { exerciseId: 'b', sets: 1 }]);
    blocks = done(blocks, 0, 0);
    assert.deepEqual(supersetStep(blocks, 0), { focus: 1, rest: 'none' });
    blocks = done(blocks, 1, 0);
    assert.deepEqual(supersetStep(blocks, 1), { focus: 0, rest: 'pair' });
    blocks = done(blocks, 0, 1);
    assert.deepEqual(supersetStep(blocks, 0), { focus: null, rest: 'own' });
  });

  it('straight sets are unchanged', ()=>{
    const blocks = done(run([{ exerciseId: 'a', sets: 3 }, { exerciseId: 'b', sets: 3 }]), 0, 0);
    assert.deepEqual(supersetStep(blocks, 0), { focus: null, rest: 'own' });
  });

  it('nextActionableBlockIndex prefers an open partner', ()=>{
    let blocks = plan();
    assert.equal(nextActionableBlockIndex(blocks, 0), 1);
    assert.equal(nextActionableBlockIndex(blocks, 1), 0);
    blocks = done(done(done(blocks, 0, 0), 0, 1), 0, 2);
    assert.equal(nextActionableBlockIndex(blocks, 0), 1);
  });

  it('the runner block keeps supersetWith and marks an editor rest as exact', ()=>{
    const runner = normaliseRunnerBlock({ exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–12', restSec: 150, supersetWith: 'dumbbell-row', userEdited: true }, [], null, 0);
    assert.equal(runner.supersetWith, 'dumbbell-row');
    assert.equal(runner.restExact, true);
    const plain = normaliseRunnerBlock({ exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–12', restSec: 90 }, [], null, 0);
    assert.equal('supersetWith' in plain, false);
    assert.equal('restExact' in plain, false);
  });
});

describe('RestDock uses the per-exercise rest', ()=>{
  it('an editor rest is used to the second; template rests still snap; a remembered preset wins', ()=>{
    assert.equal(restForBlock({}, { exerciseId: 'x', restSec: 150, restExact: true }), 150);
    assert.equal(restForBlock({}, { exerciseId: 'x', restSec: 150 }), 120, 'template rest snaps to a preset choice');
    assert.equal(restForBlock({ restPresets: { x: 60 } }, { exerciseId: 'x', restSec: 150, restExact: true }), 60);
    assert.equal(restForBlock({}, null), 0);
  });
});

describe('duration estimate', ()=>{
  it('a superset saves the inner rests and one transition', ()=>{
    const straight = predictSessionDuration([{ exerciseId: 'a', sets: 3, restSec: 90 }, { exerciseId: 'b', sets: 3, restSec: 90 }]);
    const paired = predictSessionDuration([{ exerciseId: 'a', sets: 3, restSec: 90, supersetWith: 'b' }, { exerciseId: 'b', sets: 3, restSec: 90 }]);
    // straight: 2×(135 + 180 + 90) = 810 s; paired: 270 + 2×90 + 90 = 540 s.
    assert.equal(straight, 14);
    assert.equal(paired, 9);
    assert.ok(paired < straight);
  });

  it('uses the longer rest of the pair and ignores a stale pointer', ()=>{
    const longer = predictSessionDuration([{ exerciseId: 'a', sets: 3, restSec: 60, supersetWith: 'b' }, { exerciseId: 'b', sets: 3, restSec: 180 }]);
    assert.equal(longer, Math.round((270 + 2 * 180 + 90) / 60));
    const stale = predictSessionDuration([{ exerciseId: 'a', sets: 3, restSec: 90, supersetWith: 'z' }, { exerciseId: 'b', sets: 3, restSec: 90 }]);
    assert.equal(stale, 14);
  });
});

describe('pairs and rests travel with templates, share codes and repair', ()=>{
  it('edits → template keeps supersetWith and rest', ()=>{
    let s = pairWithNext(fixture(), '1', 0).schedule;
    s = setExerciseRest(s, '1', 1, 120).schedule;
    const tpl = buildEditorTemplate(editsAsTemplateInput(s, { name: 'SS' }));
    const blocks = tpl.program.weeks[0].workouts[0].blocks;
    assert.equal(blocks[0].supersetWith, 'dumbbell-row');
    assert.equal(blocks[1].restSec, 120);
    const back = decodeShareCode(encodeShareCode(tpl));
    assert.equal(back.program.weeks[0].workouts[0].blocks[0].supersetWith, 'dumbbell-row');
  });

  it('integrity repair keeps a paired programme', ()=>{
    const s = pairWithNext(fixture(), '1', 0).schedule;
    const fixed = repairStore({ activeSchedule: s, history: [] });
    const store = fixed.store || fixed;
    assert.ok(store.activeSchedule.programmeEdits);
    assert.equal(store.activeSchedule.sessions[0].blocks[0].supersetWith, 'dumbbell-row');
  });
});

describe('UI wiring (source level)', ()=>{
  const editor = src('src', 'components', 'ProgrammeEditor.jsx');
  const runner = src('src', 'components', 'SessionRunner.jsx');
  it('editor: Pair with next / Unpair and a rest stepper, all 44px targets', ()=>{
    assert.match(editor, /Pair with next/);
    assert.match(editor, /Unpair/);
    assert.match(editor, /label=\{`rest for \$\{block\.name\}`\}/);
    for(const m of editor.matchAll(/aria-label=\{`(?:Pair|Unpair)[^`]*`\} className="([^"]+)"/g)) assert.match(m[1], /min-h-11/);
  });
  it('runner: superset step drives focus + rest, rest comes from restForBlock', ()=>{
    assert.match(runner, /supersetStep\(afterDone, bi\)/);
    assert.match(runner, /pairRestSec\(/);
    assert.match(runner, /restForBlock\(gymPrefs, b\)/);
    assert.match(runner, /data-testid="superset-badge"/);
  });
});
