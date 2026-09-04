// The generator IS part of the test surface: if its output drifted silently,
// every fixture built on it would drift with it. These tests pin determinism
// (same seed → byte-identical data), vary sensibly across seeds, and prove
// the journey fixtures pass the app's own boot validation — so anything the
// generator produces is a store the app would actually accept.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  JOURNEY_SEEDS, makeRng, makeHistory, makeUserContext, makeJourneyStore,
} from './helpers/test-data.js';
import { validateStoreData } from '../src/lib/export.js';
import { normaliseHistory, totalVolumeKg, streakDays, prsHitBySession } from '../src/lib/store.js';
import { recommendNext } from '../src/lib/progression.js';

describe('test-data generator: determinism', () => {
  it('the same seed yields byte-identical stores', () => {
    const a = JSON.stringify(makeJourneyStore(JOURNEY_SEEDS.consistent));
    const b = JSON.stringify(makeJourneyStore(JOURNEY_SEEDS.consistent));
    assert.equal(a, b);
  });

  it('different seeds yield different data (seeds actually matter)', () => {
    const a = JSON.stringify(makeJourneyStore(JOURNEY_SEEDS.beginner));
    const b = JSON.stringify(makeJourneyStore(JOURNEY_SEEDS.consistent));
    assert.notEqual(a, b);
  });

  it('the mulberry32 stream itself is pinned', () => {
    const { rng } = makeRng(42);
    const first = [rng(), rng(), rng()];
    const again = makeRng(42);
    assert.deepEqual([again.rng(), again.rng(), again.rng()], first);
  });
});

describe('test-data generator: journey fixtures are valid app data', () => {
  for(const [name, seed] of Object.entries(JOURNEY_SEEDS)){
    it(`journey "${name}" passes boot-time store validation`, () => {
      const store = makeJourneyStore(seed);
      const check = validateStoreData(store);
      assert.equal(check.ok, true, check.errors.join(' '));
    });

    it(`journey "${name}" survives normalisation and feeds every consumer`, () => {
      const store = makeJourneyStore(seed);
      const clean = normaliseHistory(store.history);
      assert.equal(clean.length, store.history.length, 'no rows lost');
      assert.ok(totalVolumeKg(clean) > 0, 'volume computable');
      assert.ok(streakDays(clean) >= 0);
      // The engine can prescribe from the fixture without throwing.
      const rec = recommendNext({ exerciseId: 'bench-press-dumbbell', history: clean });
      assert.ok(typeof rec.reason === 'string' && rec.reason.length > 0);
      // PR detection runs without error.
      for(const s of clean.slice(0, 3)) prsHitBySession(s, clean.filter((x) => x.id !== s.id));
    });
  }

  it('profile knobs shape the data: low adherence → fewer sessions, layoff → a long gap', () => {
    const diligent = makeHistory(JOURNEY_SEEDS.consistent, { sessions: 20, adherence: 1 });
    const flaky = makeHistory(JOURNEY_SEEDS.consistent, { sessions: 20, adherence: 0.3 });
    assert.ok(flaky.length < diligent.length, 'adherence gates session count');
    const gapped = makeHistory(JOURNEY_SEEDS.layoff, { sessions: 8, layoffAfter: 3, layoffDays: 14 });
    const dates = gapped.map((h) => h.dateISO);
    const gapDays = (Date.parse(`${dates[3]}T00:00:00Z`) - Date.parse(`${dates[2]}T00:00:00Z`)) / 86400000;
    assert.ok(gapDays >= 14, 'layoff creates a real multi-day gap');
  });

  it('a noisy journey contains noisy sessions (the fixture is what it claims)', () => {
    const noisy = makeHistory(JOURNEY_SEEDS.noisy, { sessions: 20, noise: 0.5 });
    const hasPain = noisy.some((h) => h.painDiscomfort);
    const hasShort = noisy.some((h) => h.durationMinutes < 35);
    assert.ok(hasPain || hasShort, 'noise knob produces detectably noisy rows');
  });
});
