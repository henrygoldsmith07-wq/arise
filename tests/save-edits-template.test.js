// Save My Programme edits as a template (backlog 34): edits → template →
// schedule round trip, the end-of-block "start next block from my edits",
// the switch-programme keep option and the optional share code.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  editsAsTemplateInput, programmeDaysForTemplate, programmeWeekCount, editableDays, dayKeyOf,
  swapExercise, setExerciseSets, setExerciseRepRange, renameDay, addExercise, MAX_TEMPLATE_WEEKS,
} from '../src/lib/programmeEditor.js';
import { saveEditsAsTemplate, startNextBlockFromEdits } from '../src/services/programmeService.js';
import { scheduleProgram, EXERCISE_BY_ID } from '../src/lib/data.js';
import { encodeShareCode, decodeShareCode } from '../src/lib/shareCodes.js';

const src = (...p)=> readFileSync(join(process.cwd(), ...p), 'utf8');
const b = (exerciseId, sets, reps, restSec = 90)=> ({ exerciseId, sets, reps, restSec, loadHint: '', version: 1 });

function fixture(){
  return {
    programId: 'fixture', startDateISO: '2026-10-01', programVersion: 1, rev: 1,
    sessions: [
      { id: 'w1d1', week: 1, day: 1, title: 'Push', status: 'planned', blocks: [b('bench-press-dumbbell', 3, '8–12', 120), b('push-up', 2, '10–15')] },
      { id: 'w1d2', week: 1, day: 2, title: 'Pull', status: 'planned', blocks: [b('dumbbell-row', 3, '8–12'), b('plank', 3, '30–45s', 60)] },
      { id: 'w2d1', week: 2, day: 1, title: 'Push', status: 'planned', blocks: [b('bench-press-dumbbell', 3, '9–13', 120), b('push-up', 2, '11–16')] },
      { id: 'w2d2', week: 2, day: 2, title: 'Pull', status: 'planned', blocks: [b('dumbbell-row', 3, '9–13'), b('plank', 3, '30–45s', 60)] },
      { id: 'w3d1', week: 3, day: 1, title: 'Push', status: 'planned', blocks: [b('bench-press-dumbbell', 3, '9–13', 120), b('push-up', 2, '11–16')] },
      { id: 'w3d2', week: 3, day: 2, title: 'Pull', status: 'planned', blocks: [b('dumbbell-row', 3, '9–13'), b('plank', 3, '30–45s', 60)] },
    ],
  };
}

function edited(){
  let s = fixture();
  s = swapExercise(s, '1', 1, 'incline-push-up').schedule;
  s = setExerciseSets(s, '1', 0, 4).schedule;
  s = renameDay(s, '2', 'Back & core').schedule;
  s = setExerciseRepRange(s, '2', 0, { min: 6, max: 10 }).schedule;
  s = addExercise(s, '2', 'rear-delt-fly', { sets: 2 }).schedule;
  return s;
}

const shape = (blocks)=> blocks.map(x=> ({ exerciseId: x.exerciseId, sets: x.sets, reps: String(x.reps), restSec: x.restSec }));

describe('edits → template input', ()=>{
  it('includes every day with its edited title and blocks, and the block length', ()=>{
    const s = edited();
    const input = editsAsTemplateInput(s, { name: 'Mine' });
    assert.equal(input.name, 'Mine');
    assert.equal(input.weeks, 3);
    assert.deepEqual(input.days.map(d=> d.title), ['Push', 'Back & core']);
    assert.deepEqual(input.days[0].exercises.map(e=> e.exerciseId), ['bench-press-dumbbell', 'incline-push-up']);
    assert.equal(input.days[0].exercises[0].sets, 4);
    assert.equal(input.days[1].exercises[0].reps, '6–10');
    assert.ok(input.days[1].exercises.some(e=> e.exerciseId === 'rear-delt-fly' && e.sets === 2));
  });

  it('falls back to a readable name and clamps the week count', ()=>{
    assert.equal(editsAsTemplateInput(fixture()).name, 'My programme');
    assert.equal(editsAsTemplateInput(fixture(), { name: '   ' }).name, 'My programme');
    const long = { sessions: [{ id: 'x', week: 40, day: 1, title: 'A', status: 'planned', blocks: [b('push-up', 3, '8–12')] }] };
    assert.equal(programmeWeekCount(long), MAX_TEMPLATE_WEEKS);
    assert.equal(programmeWeekCount({ sessions: [] }), 1);
  });

  it('still works when every session of the block is done (end of block)', ()=>{
    const s = edited();
    const done = { ...s, sessions: s.sessions.map(x=> ({ ...x, status: 'done' })) };
    assert.equal(editableDays(done).length, 0, 'editor has nothing upcoming');
    const days = programmeDaysForTemplate(done);
    assert.equal(days.length, 2);
    assert.equal(days[1].title, 'Back & core');
    assert.ok(days[0].blocks.some(x=> x.exerciseId === 'incline-push-up'));
  });
});

describe('round trip: edits → template → schedule equals the edited sessions', ()=>{
  it('every week of the new block carries the edited days exactly', ()=>{
    const s = edited();
    const store = { activeSchedule: s, customTemplates: [], history: [] };
    const { template, store: next } = saveEditsAsTemplate({ store, name: 'My edits' });
    assert.equal(next.customTemplates.length, 1);
    assert.equal(next.customTemplates[0].id, template.id);
    assert.equal(template.program.weeks.length, 3);
    assert.equal(template.program.mesocycle.weeks, 3);
    assert.equal(template.savedFromProgrammeId, 'fixture');

    const sched = scheduleProgram({ programId: template.id, startDateISO: '2026-11-02', program: template.program });
    const editedDays = programmeDaysForTemplate(s);
    assert.equal(sched.sessions.length, 3 * editedDays.length);
    for(const session of sched.sessions){
      const want = editedDays[Number(dayKeyOf(session)) - 1];
      assert.equal(session.title, want.title);
      assert.deepEqual(shape(session.blocks), shape(want.blocks));
    }
    // The upcoming edited sessions of the source block match the new block's.
    const upcoming = s.sessions.filter(x=> x.week === 1);
    for(const u of upcoming){
      const fresh = sched.sessions.find(x=> x.week === 1 && x.day === u.day);
      assert.deepEqual(fresh.blocks.map(x=> x.exerciseId), u.blocks.map(x=> x.exerciseId));
      assert.deepEqual(fresh.blocks.map(x=> x.sets), u.blocks.map(x=> x.sets));
    }
  });

  it('template weeks are independent copies (editing one week never leaks)', ()=>{
    const { template } = saveEditsAsTemplate({ store: { activeSchedule: edited(), customTemplates: [] }, name: 'x' });
    template.program.weeks[0].workouts[0].blocks[0].sets = 99;
    assert.notEqual(template.program.weeks[1].workouts[0].blocks[0].sets, 99);
  });

  it('refuses without an active programme', ()=>{
    assert.throws(()=> saveEditsAsTemplate({ store: { activeSchedule: null }, name: 'x' }), /No active programme/);
  });
});

describe('start next block from my edits', ()=>{
  it('saves the template and starts a fresh block from it', ()=>{
    const s = edited();
    const store = { activeSchedule: { ...s, sessions: s.sessions.map(x=> ({ ...x, status: 'done' })) }, customTemplates: [], history: [], programHistory: [] };
    const result = startNextBlockFromEdits({ store, name: 'Next block', availableEquipment: ['dumbbells', 'bench', 'cable', 'bodyweight'] });
    assert.equal(result.started, true);
    const sched = result.store.activeSchedule;
    assert.equal(sched.programId, result.template.id);
    assert.ok(sched.sessions.every(x=> x.status === 'planned'));
    assert.equal(sched.programmeEdits, undefined, 'the new block starts clean; the edits ARE its template');
    const day1 = sched.sessions.find(x=> x.day === 1);
    assert.ok(day1.blocks.some(x=> x.exerciseId === 'incline-push-up'));
    assert.equal(sched.sessions.find(x=> x.day === 2).title, 'Back & core');
    assert.ok(result.store.customTemplates.some(t=> t.id === result.template.id));
    assert.ok(result.store.programHistory.some(h=> h.programId === result.template.id));
  });
});

describe('optional share code', ()=>{
  it('a saved edits template encodes and decodes with the edited days', ()=>{
    const { template } = saveEditsAsTemplate({ store: { activeSchedule: edited(), customTemplates: [] }, name: 'Shared edits' });
    const back = decodeShareCode(encodeShareCode(template));
    assert.equal(back.name, 'Shared edits');
    const days = back.program.weeks[0].workouts;
    assert.deepEqual(days.map(d=> d.title), ['Push', 'Back & core']);
    assert.ok(days[0].blocks.every(x=> EXERCISE_BY_ID[x.exerciseId]));
    assert.ok(days[0].blocks.some(x=> x.exerciseId === 'incline-push-up'));
  });
});

describe('UI wiring (source level)', ()=>{
  it('editor offers "Save as my template" and a share code afterwards', ()=>{
    const editor = src('src', 'components', 'ProgrammeEditor.jsx');
    assert.match(editor, /Save as my template/);
    assert.match(editor, /saveEditsAsTemplate\(/);
    assert.match(editor, /Copy share code/);
  });
  it('lifecycle + Today offer "Start next block from my edits", loading the service on tap', ()=>{
    const life = src('src', 'components', 'ProgrammeLifecycle.jsx');
    assert.match(life, /Start next block from my edits/);
    assert.match(life, /await import\('\.\.\/services\/programmeService\.js'\)/);
    assert.match(src('src', 'components', 'TodayView.jsx'), /<NextBlockFromEdits /);
  });
  it('switching programme offers to keep the edits as a template', ()=>{
    const train = src('src', 'components', 'TrainView.jsx');
    assert.match(train, /Keep your programme edits\?/);
    assert.match(train, /saveEditsAsTemplate\(\{ store/);
  });
});
