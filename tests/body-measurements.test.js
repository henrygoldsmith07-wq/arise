import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { upsertBodyweight, removeBodyweight, upsertMeasures, measureSummary, parseMeasure, liveBodyweights, mergeBodyweightLogs } from '../src/lib/bodyweightLog.js';

const T = (n) => `2026-11-0${n}T08:00:00.000Z`;

describe('body measurements', () => {
  it('parses cm and body-fat % within sane ranges', () => {
    assert.equal(parseMeasure('waist', '82,45'), 82.5);
    assert.equal(parseMeasure('waist', '5'), null);
    assert.equal(parseMeasure('bf', '18'), 18);
    assert.equal(parseMeasure('bf', '90'), null);
    assert.equal(parseMeasure('arm', ''), null);
  });
  it('share the weigh-in row; weight and measurements survive each other', () => {
    let log = upsertBodyweight([], { dateISO: '2026-11-01', kg: 70, nowISO: T(1) });
    log = upsertMeasures(log, { dateISO: '2026-11-01', values: { waist: 82, bf: 18, arm: 'x' }, nowISO: T(2) });
    log = upsertBodyweight(log, { dateISO: '2026-11-01', kg: 71, nowISO: T(3) });
    assert.deepEqual(log, [{ dateISO: '2026-11-01', kg: 71, m: { waist: 82, bf: 18 }, updatedAt: T(3) }]);
    log = removeBodyweight(log, '2026-11-01', T(4));
    assert.equal(liveBodyweights(log).length, 0, 'weight readers see no weigh-in');
    assert.deepEqual(log[0].m, { waist: 82, bf: 18 }, 'measurements stay');
    log = upsertMeasures(log, { dateISO: '2026-11-01', values: {}, nowISO: T(5) });
    assert.equal(log[0].deleted, true, 'nothing left → tombstone, so sync cannot resurrect it');
  });
  it('summary: latest value and change since the first entry', () => {
    let log = upsertMeasures([], { dateISO: '2026-10-01', values: { waist: 84 } });
    log = upsertMeasures(log, { dateISO: '2026-11-01', values: { waist: 82.5, chest: 100 } });
    const s = measureSummary(log);
    assert.deepEqual(s.map((d) => [d.key, d.latest, d.change]), [['waist', 82.5, -1.5], ['chest', 100, null]]);
  });
  it('sync merge keeps the newer day row, measurements included', () => {
    const a = upsertMeasures([], { dateISO: '2026-11-01', values: { waist: 84 }, nowISO: T(1) });
    const b = upsertMeasures([], { dateISO: '2026-11-01', values: { waist: 83 }, nowISO: T(2) });
    assert.equal(mergeBodyweightLogs(a, b)[0].m.waist, 83);
    assert.equal(mergeBodyweightLogs(b, a)[0].m.waist, 83);
  });
});
