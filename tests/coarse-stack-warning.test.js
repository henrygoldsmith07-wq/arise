import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { coarseStackWarning } from '../src/lib/plates.js';

describe('coarseStackWarning', ()=>{
  it('is quiet for a normal 2.5 kg stack on a typical load', ()=>{
    assert.equal(coarseStackWarning(2.5), null);
  });
  it('warns for a 5 kg pin on a 25 kg load and suggests a micro step', ()=>{
    const w = coarseStackWarning(5);
    assert.equal(w.pct, 20);
    assert.equal(w.suggestedKg, 2.5);
  });
  it('respects a lighter typical load', ()=>{
    assert.equal(coarseStackWarning(2.5, 15).pct, 17);
  });
  it('ignores junk input', ()=>{
    assert.equal(coarseStackWarning(''), null);
    assert.equal(coarseStackWarning(-1), null);
    assert.equal(coarseStackWarning(5, 0), null);
  });
});
