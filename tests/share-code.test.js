// Share-code hardening: a code is pasted, untrusted text. The trailing djb2
// checksum only catches accidental corruption (it is NOT a MAC), so decoding
// must validate every field and rebuild the template from an allow-list —
// never copy parsed objects/blocks into store.customTemplates.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { encodeShareCode, decodeShareCode } from '../src/lib/shareCodes.js';
import { installSharedTemplate } from '../src/services/programmeService.js';

const template = {
  program: {
    name: 'Push Pull', tagline: 'My split', level: 'Intermediate', daysPerWeek: 2,
    weeks: [{ week: 1, workouts: [
      { title: 'Push', blocks: [{ exerciseId: 'bench-press', sets: 3, reps: '8–12', restSec: 90 }] },
      { title: 'Pull', blocks: [{ exerciseId: 'pull-up', sets: 3, reps: 'AMRAP', restSec: 60, supersetWith: 'dumbbell-row' }] },
    ] }],
  },
};

// Mirror the public envelope format to FORGE hostile codes the encoder itself
// would never emit — this is what a determined sender can do by hand.
function forgeCode(payload){
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = '';
  for(const b of bytes) bin += String.fromCharCode(b);
  const body = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  let h = 5381;
  for(let i = 0; i < body.length; i++) h = ((h << 5) + h + body.charCodeAt(i)) >>> 0;
  return 'ARISE1.' + body + '.' + h.toString(36);
}

describe('share-code hardening', () => {
  it('still accepts a valid share code with its text reps and supersets intact', () => {
    const decoded = decodeShareCode(encodeShareCode(template));
    assert.equal(decoded.name, 'Push Pull');
    assert.equal(decoded.program.weeks[0].workouts.length, 2);
    const [push, pull] = decoded.program.weeks[0].workouts;
    assert.equal(push.blocks[0].reps, '8–12');
    assert.equal(push.blocks[0].sets, 3);
    assert.equal(pull.blocks[0].reps, 'AMRAP');
    assert.equal(pull.blocks[0].supersetWith, 'dumbbell-row');
  });

  it('installs a valid code through installSharedTemplate', () => {
    const { store } = installSharedTemplate({ customTemplates: [] }, encodeShareCode(template));
    assert.equal(store.customTemplates.length, 1);
    assert.equal(store.customTemplates[0].name, 'Push Pull');
  });

  it('drops prototype-pollution keys from a forged code', () => {
    const hostile = JSON.parse('{"name":"Evil","days":[{"blocks":[{"exerciseId":"bench-press","sets":3,"reps":"5","restSec":90,"__proto__":{"polluted":"yes"},"constructor":"x"}]}],"__proto__":{"polluted":"yes"}}');
    const decoded = decodeShareCode(forgeCode(hostile));
    const block = decoded.program.weeks[0].workouts[0].blocks[0];
    assert.equal(Object.prototype.hasOwnProperty.call(block, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(block, 'constructor'), false);
    assert.equal(({}).polluted, undefined);
  });

  it('rejects non-finite, out-of-range and script-bearing set details', () => {
    const block = { exerciseId: 'bench-press', sets: 3, reps: '5', restSec: 90 };
    const make = (overrides) => ({
      name: 'X', days: [{ blocks: [{ ...block, ...overrides }] }],
    });
    assert.throws(() => decodeShareCode(forgeCode(make({ sets: 1e9 }))), /invalid set details/);
    assert.throws(() => decodeShareCode(forgeCode(make({ sets: 'many' }))), /invalid set details/);
    assert.throws(() => decodeShareCode(forgeCode(make({ restSec: 'abc' }))), /invalid set details/);
    assert.throws(() => decodeShareCode(forgeCode(make({ reps: '<img src=x onerror=alert(1)>' }))), /invalid set details/);
  });

  it('rejects malformed block and day shapes', () => {
    assert.throws(() => decodeShareCode(forgeCode({ name: 'X', days: [{ blocks: [{ sets: 3, reps: '5', restSec: 90 }] }] })), /unknown exercise/);
    assert.throws(() => decodeShareCode(forgeCode({ name: 'X', days: [null] })), /usable program/);
    assert.throws(() => decodeShareCode(forgeCode({ name: 'X', days: [{ blocks: 'nope' }] })), /usable program/);
  });

  it('rejects oversized codes', () => {
    assert.throws(() => decodeShareCode('ARISE1.' + 'A'.repeat(70 * 1024) + '.x'), /too long/);
  });
});
