import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveAttributes, levelFromAttributes } from '../src/lib/attributes.js';

describe('attributes derive from history', ()=>{
  it('empty history gives low base attrs', ()=>{
    const attrs = deriveAttributes([]);
    assert.ok(attrs.every(a=> a.value < 20));
    const lvl = levelFromAttributes(attrs);
    assert.ok(lvl.level >=1 && lvl.level <=3);
  });

  it('history raises attributes', ()=>{
    const h = [
      { dateISO:'2026-01-01', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[{reps:'8',weightKg:'20'},{reps:'8',weightKg:'20'}]}, { exerciseId:'bodyweight-squat', sets:[{reps:'12',weightKg:''}]}]},
      { dateISO:'2026-01-03', blocks:[{ exerciseId:'romanian-deadlift', sets:[{reps:'8',weightKg:'40'}]}, { exerciseId:'pull-up', sets:[{reps:'5',weightKg:''}]}]},
      { dateISO:'2026-01-05', blocks:[{ exerciseId:'run-easy', sets:[{reps:'20',weightKg:''}]}]},
    ];
    const attrs = deriveAttributes(h);
    const lvl = levelFromAttributes(attrs);
    assert.ok(lvl.level > 2, `expected level >2 got ${lvl.level}`);
    assert.ok(attrs.find(a=>a.id==='strength').value > 20);
  });
});
