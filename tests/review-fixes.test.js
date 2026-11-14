import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { strengthTrends } from '../src/lib/performance.js';
import { painTrendWarnings } from '../src/lib/safety.js';

const session = (dateISO, sets, extra = {}) => ({ id: dateISO, dateISO, blocks: [{ exerciseId: 'push-up', sets }], ...extra });
const set = (reps, weightKg = '') => ({ reps: String(reps), weightKg: String(weightKg), completed: true });

describe('review fixes', () => {
  it('a tiny e1RM change on a light load is reported as a percentage, never "0 kg"', () => {
    // push-ups with a 2 kg plate: e1RM moves by hundredths of a kilo
    const history = [
      session('2026-10-01', [set(12, 2)]), session('2026-10-04', [set(12, 2)]),
      session('2026-10-08', [set(11, 2)]), session('2026-10-11', [set(11, 2)]),
    ];
    const [t] = strengthTrends({ history, exerciseIds: ['push-up'] });
    assert.equal(t.status, 'declining');
    assert.doesNotMatch(t.explanation, /\b0 kg\b/);
    assert.match(t.explanation, /slipped \d+%/);
  });
  it('a real change keeps its kilograms', () => {
    const history = [
      session('2026-10-01', [set(8, 40)]), session('2026-10-04', [set(8, 40)]),
      session('2026-10-08', [set(8, 45)]), session('2026-10-11', [set(8, 45)]),
    ].map((h) => ({ ...h, blocks: [{ ...h.blocks[0], exerciseId: 'bench-press-dumbbell' }] }));
    const [t] = strengthTrends({ history, exerciseIds: ['bench-press-dumbbell'] });
    assert.equal(t.status, 'improving');
    assert.match(t.explanation, /rose \d+(\.\d)? kg/);
  });
  it('safety titles name the lift, not its id', () => {
    const pained = (d) => ({ id: d, dateISO: d, blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ ...set(8, 20), pain: true }] }] });
    const [w] = painTrendWarnings([pained('2026-11-01'), pained('2026-11-04')], { today: '2026-11-05' });
    assert.equal(w.title, 'Recurring pain with Dumbbell Bench Press');
  });
});
