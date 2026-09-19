// classifierDeterminism.test.js — the training engine never touches the net.
// Proves workouts, readiness, progression and recommendations work identically
// with classifier.dev enabled, disabled, or unreachable. The engine modules
// under test must not import the feedback classifier, directly or indirectly.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const DETERMINISTIC_MODULES = [
  'src/lib/readinessClassifier.js',
  'src/lib/trainRecommendation.js',
  'src/lib/sessionGenerator.js',
  'src/lib/progression.js',
  'src/lib/substitutions.js',
  'src/lib/safety.js',
];
function src(p){ return readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'); }
describe('deterministic engine imports nothing cloudy', () => {
  for(const mod of DETERMINISTIC_MODULES){
    it(`${mod} has no classifier/fetch/network import`, () => {
      const text = src(mod);
      assert.ok(!/feedbackClassifier|classifier\.dev|classifyText|routeCoachRequest/.test(text), `${mod} references the classifier`);
      assert.ok(!/\bfetch\s*\(/.test(text), `${mod} calls fetch`);
      assert.ok(!/XMLHttpRequest|WebSocket|navigator\.sendBeacon|import\.meta\.env.*API/.test(text), `${mod} touches network APIs`);
    });
  }
  it('the classifier adapter imports no training-engine module', () => {
    const text = src('src/lib/feedbackClassifier.js');
    for(const banned of ['from \'./readinessClassifier', 'from \'./trainRecommendation', 'from \'./sessionGenerator', 'from \'./progression.js', 'from \'./substitutions', 'from \'./safety.js']){
      assert.ok(!text.includes(banned), `adapter must not import ${banned}`);
    }
  });
});
describe('engine outputs are identical with classifier on/off/unreachable', () => {
  it('progression + readiness + session + recommendation are bit-identical', async () => {
    class Mem {
      constructor(){ this.map = new Map(); }
      getItem(k){ return this.map.has(k) ? this.map.get(k) : null; }
      setItem(k, v){ this.map.set(k, String(v)); }
      removeItem(k){ this.map.delete(k); }
    }
    globalThis.localStorage = new Mem();
    const { recommendNext, readinessEMA } = await import('../src/lib/progression.js');
    const { generateSession } = await import('../src/lib/sessionGenerator.js');
    const { classifyReadiness } = await import('../src/lib/readinessClassifier.js');
    const { trainRecommendation } = await import('../src/lib/trainRecommendation.js');
    const { rankedSubstitutions } = await import('../src/lib/substitutions.js');
    const { safetyPanel } = await import('../src/lib/safety.js');
    const history = [
      { id: 'h1', dateISO: '2026-06-01', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '20', rpe: '7' }] }] },
      { id: 'h2', dateISO: '2026-06-04', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '22', rpe: '7' }] }] },
    ];
    const readinessLog = [
      { dateISO: '2026-06-15', score: 72 }, { dateISO: '2026-06-16', score: 74 },
      { dateISO: '2026-06-17', score: 71 }, { dateISO: '2026-06-18', score: 73 },
    ];
    const onboarding = { goal: 'muscle', level: 'Beginner', equipment: ['bodyweight', 'bands'], daysPerWeek: 3, availableMinutes: 45 };
    const runAll = () => JSON.stringify({
      rec: recommendNext({ exerciseId: 'bench-press-dumbbell', history, targetReps: '8-12' }),
      ema: readinessEMA([60, 62, 58, 61]),
      sess: generateSession({ goal: 'general', availableEquipment: ['bodyweight'], history: [], length: 3 }),
      ready: classifyReadiness({ history, readinessLog, todayISO: '2026-06-20' }),
      train: trainRecommendation({ onboarding, customTemplates: [], history: [] }),
      subs: rankedSubstitutions('bench-press-barbell', ['dumbbells'], 3, history).map((s) => s.id),
      safe: safetyPanel(history, readinessLog, { today: '2026-06-20' }),
    });
    const { saveClassifierSettings } = await import('../src/lib/feedbackClassifier.js');
    globalThis.localStorage = new Mem();
    const off = runAll();
    saveClassifierSettings({ enabled: true });
    const on = runAll();
    globalThis.fetch = async () => { throw new Error('network must never be touched by the engine'); };
    const unreachable = runAll();
    delete globalThis.fetch;
    delete globalThis.localStorage;
    assert.equal(on, off);
    assert.equal(unreachable, off);
  });
});
