// exercise-history.test.js — the per-lift history sheet's data layer and its
// dialog presentation contracts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exerciseSessionHistory, sparklinePoints } from '../src/lib/exerciseHistory.js';

const mk = (d, w, reps)=> ({ dateISO:d, title:'T', blocks:[{ exerciseId:'lat-pulldown', sets:reps.map(r=> ({ weightKg:w, reps:r })) }, { exerciseId:'other', sets:[{ weightKg:5, reps:5 }] }] });

describe('exerciseSessionHistory', ()=>{
  const hist = [1,2,3,4,5,6,7].map(i=> mk(`2026-10-0${i}`, 40 + i, ['10','9']));
  it('returns the last 5 exposures of that lift, newest first', ()=>{
    const out = exerciseSessionHistory(hist, 'lat-pulldown');
    assert.equal(out.length, 5);
    assert.equal(out[0].dateISO, '2026-10-07');
    assert.equal(out[4].dateISO, '2026-10-03');
    assert.ok(out[0].bestE1rm > out[4].bestE1rm);
  });
  it('skips sessions without that lift and empty sets', ()=>{
    const h = [mk('2026-10-01', 40, ['10']), { dateISO:'2026-10-02', blocks:[{ exerciseId:'other', sets:[{ reps:'5' }] }] }, { dateISO:'2026-10-03', blocks:[{ exerciseId:'lat-pulldown', sets:[{ weightKg:'', reps:'' }] }] }];
    assert.deepEqual(exerciseSessionHistory(h, 'lat-pulldown').map(o=> o.dateISO), ['2026-10-01']);
    assert.deepEqual(exerciseSessionHistory(null, 'x'), []);
  });
  it('bodyweight sets have null load and no e1RM', ()=>{
    const out = exerciseSessionHistory([{ dateISO:'d', blocks:[{ exerciseId:'p', sets:[{ reps:'12' }] }] }], 'p');
    assert.equal(out[0].sets[0].weightKg, null);
    assert.equal(out[0].bestE1rm, null);
  });
});

describe('sparklinePoints', ()=>{
  it('needs two points', ()=>{ assert.equal(sparklinePoints([{ bestE1rm:50 }]), null); });
  it('rises left to right for improving lifts (newest first input)', ()=>{
    const pts = sparklinePoints([{ bestE1rm:60 }, { bestE1rm:50 }]).split(' ').map(p=> p.split(',').map(Number));
    assert.ok(pts[1][0] > pts[0][0]);
    assert.ok(pts[1][1] < pts[0][1]);
  });
  it('flat series sits mid-height', ()=>{ assert.match(sparklinePoints([{ bestE1rm:50 }, { bestE1rm:50 }]), /,16/); });
});

// The sheet's presentation contracts: it is a modal dialog, so it inherits the
// app-wide keyboard contract (Escape closes, focus returns to the opener via
// useDialogA11y's onClose wiring) and its header states the real count.
// Source-contract style, matching coach-panel.test.js.
describe('ExerciseHistorySheet dialog contract', ()=>{
  const sheet = readFileSync(join(process.cwd(), 'src', 'components', 'ExerciseHistorySheet.jsx'), 'utf8');

  it('wires Escape and focus restore through useDialogA11y onClose', ()=>{
    assert.match(sheet, /useDialogA11y\(\{ active: true, onClose \}\)/,
      'onClose enables Escape-to-close and focus restoration');
  });

  it('does not claim five sessions when none are logged', ()=>{
    // The old header rendered "last 5 sessions" for an empty history because
    // the fallback (sessions.length || 5) ran even at zero. Pin the exact old
    // JSX interpolation so the empty case cannot regress to it.
    assert.ok(!/last \{sessions\.length \|\| 5\} sessions/.test(sheet),
      'the bare fallback that showed "last 5 sessions" with zero sessions is gone');
    assert.match(sheet, /sessions\.length === 1 \? /, 'a single exposure reads as one session');
    assert.match(sheet, /Nothing logged for this lift yet/, 'the empty state stays');
  });
});
