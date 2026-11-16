// Import hardening: hostile JSON must be rejected (or neutralised) before it
// can reach the store — prototype pollution, depth bombs, size bombs, and
// impossible numeric values that would poison e1RM/volume/priors.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';

import { parseImportFile, parseBackupFile, validateStoreData } from '../src/lib/export.js';
import { buildImportPreview } from '../src/lib/exportPolicy.js';

function session(i = 1, extra = {}){
  return {
    id: `s-${i}`,
    dateISO: '2026-01-0' + i,
    blocks: [{ exerciseId: 'bench-press', sets: [{ reps: 5, weightKg: 80 }] }],
    ...extra,
  };
}

describe('import hardening', () => {
  it('refuses a foreign product at the PREVIEW gate, not only at apply time', () => {
    // The preview is the step that validates data before the user is asked to
    // confirm it. A file naming a different app must never reach it.
    const preview = buildImportPreview(
      { app:'some-other-app', data:{ history:[session()] } },
      { history:[] }
    );
    assert.equal(preview.ok, false);
    assert.match(preview.reason, /some-other-app/);
  });

  it('still accepts a genuinely unbranded Arise snapshot', () => {
    // No `app` field at all: supported by the unbranded adapter.
    const preview = buildImportPreview({ data:{ history:[session()] } }, { history:[] });
    assert.equal(preview.ok, true);
    assert.equal(preview.counts.sessions, 1);
  });
  it('strips __proto__/constructor/prototype keys at any depth', () => {
    const malicious = JSON.stringify({
      history: [session(1, {
        // classic pollution payloads, nested inside an allowlisted field
        __proto__: { telemetryEnabled: true, isAdmin: true },
        deep: { nested: { __proto__: { polluted: 'yes' }, constructor: 'x', prototype: 'y' } },
      })],
    });
    const clean = parseImportFile(malicious);
    const row = clean.history[0];
    // No dangerous OWN keys anywhere (prototype chain itself is rebuilt by the
    // normalisation round-trip — the threat is own-key pollution).
    for(const node of [row, row.deep, row.deep.nested]){
      assert.equal(Object.prototype.hasOwnProperty.call(node, '__proto__'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(node, 'constructor'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(node, 'prototype'), false);
    }
    // And Object.prototype is not polluted for the rest of the session.
    assert.equal(({}).polluted, undefined);
    assert.equal(({}).isAdmin, undefined);
    // harmless fields survive
    assert.equal(clean.history.length, 1);
    assert.equal(row.blocks[0].sets[0].weightKg, 80);
  });

  it('rejects files nested beyond the depth cap', () => {
    let v = 1;
    for(let i = 0; i < 200; i++) v = { v };
    const wrapped = { history: [session()], deep: v };
    assert.throws(() => parseImportFile(JSON.stringify(wrapped)), /levels deep/);
  });

  it('rejects oversized import files before parsing', () => {
    const big = JSON.stringify({ history: [session()], filler: 'x'.repeat(6 * 1024 * 1024) });
    assert.throws(() => parseImportFile(big), /too large/);
  });

  it('still accepts a normal, honest backup', () => {
    const ok = JSON.stringify({ app: 'arise', history: [session(), session(2)] });
    const parsed = parseImportFile(ok);
    assert.equal(parsed.history.length, 2);
  });

  it('validateStoreData flags negative weight/reps/RPE and non-finite values', () => {
    const bad = {
      version: 1,
      history: [{
        id: 's-bad', dateISO: '2026-01-01',
        blocks: [{ exerciseId: 'bench-press', sets: [
          { reps: 5, weightKg: -40 },
          { reps: -3, weightKg: 60 },
          { reps: 5, weightKg: 60, rpe: 11 },
          { reps: 5, weightKg: 'sixty' },
        ] }],
      }],
    };
    const result = validateStoreData(bad);
    assert.equal(result.ok, false);
    const joined = result.errors.join(' ');
    assert.match(joined, /negative weight/);
    assert.match(joined, /negative reps/);
    assert.match(joined, /RPE outside/);
    assert.match(joined, /non-numeric weight/);
  });

  it('validateStoreData flags implausible magnitudes', () => {
    const result = validateStoreData({
      version: 1,
      history: [{ id: 's-x', dateISO: '2026-01-01', blocks: [{ exerciseId: 'deadlift', sets: [{ reps: 2000, weightKg: 5000 }] }] }],
    });
    assert.equal(result.ok, false);
    const joined = result.errors.join(' ');
    assert.match(joined, /implausible reps/);
    assert.match(joined, /implausible weight/);
  });

  it('plausible sets still validate clean', () => {
    const result = validateStoreData({
      version: 1,
      history: [session()],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it('rejects an oversized JSON string at the PREVIEW gate, before apply', () => {
    const big = JSON.stringify({ app: 'arise', data: { history: [session()], filler: 'x'.repeat(6 * 1024 * 1024) } });
    const preview = buildImportPreview(big, { history: [] });
    assert.equal(preview.ok, false);
    assert.match(preview.reason, /too large/);
  });

  it('rejects a depth bomb at the PREVIEW gate', () => {
    let deep = 1;
    for(let i = 0; i < 200; i++) deep = { deep };
    const preview = buildImportPreview({ app: 'arise', data: { history: [session()], deep } }, { history: [] });
    assert.equal(preview.ok, false);
    assert.match(preview.reason, /levels deep/);
  });

  it('strips pollution keys at the PREVIEW gate, not only at apply', () => {
    const hostile = JSON.parse('{"app":"arise","data":{"history":[{"id":"s-1","dateISO":"2026-01-01","blocks":[{"exerciseId":"bench-press","sets":[{"reps":5,"weightKg":80}],"__proto__":{"polluted":"yes"}}]}],"__proto__":{"polluted":"yes"}}}');
    const preview = buildImportPreview(hostile, { history: [] });
    assert.equal(preview.ok, true);
    assert.equal(({}).polluted, undefined);
    const block = preview.envelope.data.history[0].blocks[0];
    assert.equal(Object.prototype.hasOwnProperty.call(block, '__proto__'), false);
  });

  it('refuses a gzip bomb at the PREVIEW gate (decompressed output is capped)', async () => {
    const bomb = JSON.stringify({ app: 'arise', data: { history: [session()], filler: 'x'.repeat(6 * 1024 * 1024) } });
    const envelope = {
      app: 'arise', format: 'arise+gzip', v: 1, encoding: 'base64',
      data: Buffer.from(gzipSync(Buffer.from(bomb))).toString('base64'),
    };
    // Tiny on the wire — the cap must be applied to the INFLATED bytes.
    assert.ok(JSON.stringify(envelope).length < 100 * 1024);
    await assert.rejects(() => parseBackupFile(JSON.stringify(envelope)), /expands beyond/);
  });

  it('still parses an honest compressed backup at the PREVIEW gate', async () => {
    const ok = JSON.stringify({ app: 'arise', data: { history: [session(), session(2)] } });
    const envelope = {
      app: 'arise', format: 'arise+gzip', v: 1, encoding: 'base64',
      data: Buffer.from(gzipSync(Buffer.from(ok))).toString('base64'),
    };
    const inner = await parseBackupFile(JSON.stringify(envelope));
    assert.equal(inner.data.history.length, 2);
  });
});
