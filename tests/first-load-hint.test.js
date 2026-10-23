import test from 'node:test';
import assert from 'node:assert/strict';
import { firstLoadHint } from '../src/lib/data.js';
test('hint shows for empty external load only', ()=>{
  assert.match(firstLoadHint({ takesLoad:true, weightKg:'' }), /start light/);
  assert.equal(firstLoadHint({ takesLoad:true, weightKg:'20' }), null);
  assert.equal(firstLoadHint({ takesLoad:false, weightKg:'' }), null);
});
