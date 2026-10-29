// Onboarding completion race (root cause of the flaky "planned deload dip"
// e2e): Onboarding closed its dialog BEFORE the parent finished generating the
// first plan, and the parent then wrote `{ ...staleStore, activeSchedule }`.
// Anything written in that window (a seeded or restored programme, a setting
// change) was clobbered when the late plan landed. The fix: the dialog waits
// for completion, and the plan merges into the LATEST store without replacing
// a programme that already exists.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeOnboardingCompletion, generateProgrammeFromProfile } from '../src/services/programmeService.js';

const payload = { goal: 'strength', equipment: ['bodyweight', 'dumbbells', 'bench'], location: 'gym', level: 'Intermediate', daysPerWeek: 3, availableMinutes: 45 };

function firstPlanFor(store){
  const started = generateProgrammeFromProfile({ ...store, onboarding: payload });
  assert.ok(started.programId && started.store.activeSchedule, 'generator produced a plan');
  return { started, firstPlan: { programId: started.programId, name: 'x', reasons: ['r'], selectionInputs: [], pickedAt: '2026-10-29' } };
}

describe('mergeOnboardingCompletion', () => {
  it('starts the generated plan on a store with no programme and records provenance', () => {
    const plan = firstPlanFor({ history: [] });
    const out = mergeOnboardingCompletion({ history: [], programHistory: [] }, payload, plan);
    assert.equal(out.activeSchedule, plan.started.store.activeSchedule);
    assert.equal(out.onboarding.firstPlan.programId, plan.started.programId);
    assert.equal(out.onboarding.goal, 'strength');
    assert.equal(out.programHistory.length, 1);
    assert.equal(out.programHistory[0].programId, plan.started.programId);
  });

  it('never replaces a programme that landed while the plan was generating', () => {
    const plan = firstPlanFor({ history: [] });
    const seeded = { programId: 'starter-3x', mesocycle: { weeks: 4, deloadWeek: 1 }, sessions: [{ id: 'e2e-deload', dateISO: '2026-10-26', week: 1, status: 'planned', blocks: [] }] };
    const latest = { history: [{ id: 'h1', dateISO: '2026-10-26', blocks: [] }], activeSchedule: seeded, programHistory: [] };
    const out = mergeOnboardingCompletion(latest, payload, plan);
    assert.equal(out.activeSchedule, seeded);
    assert.deepEqual(out.programHistory, []);
    assert.equal(out.onboarding.goal, 'strength');
    assert.equal(out.onboarding.firstPlan, undefined);
  });

  it('keeps every field written after Save was tapped', () => {
    const plan = firstPlanFor({ history: [] });
    const latest = { history: [{ id: 'h1', dateISO: '2026-10-28', blocks: [] }], preferences: { units: 'lb', theme: 'dark' }, programHistory: [{ programId: 'old', startDateISO: '2026-09-01', endDateISO: null }] };
    const out = mergeOnboardingCompletion(latest, payload, plan);
    assert.deepEqual(out.history, latest.history);
    assert.deepEqual(out.preferences, latest.preferences);
    assert.equal(out.programHistory.length, 2);
    assert.ok(out.programHistory[0].endDateISO, 'the earlier programme is closed off');
  });

  it('without a plan it only saves the answers', () => {
    const out = mergeOnboardingCompletion({ history: [], activeSchedule: null }, payload, null);
    assert.equal(out.activeSchedule, null);
    assert.equal(out.onboarding, payload);
  });
});

describe('onboarding completion ordering', () => {
  const root = join(import.meta.dirname, '..');
  it('the dialog closes only after the parent finished applying the answers', () => {
    const src = readFileSync(join(root, 'src/components/Onboarding.jsx'), 'utf8');
    const awaited = src.indexOf('await onComplete(payload)');
    assert.ok(awaited > 0, 'onComplete is awaited');
    assert.ok(src.indexOf('onClose()', awaited) > awaited, 'onClose runs after the awaited completion');
    assert.ok(!/onComplete\(payload\);\s*onClose\(\);/.test(src), 'no fire-and-forget completion');
  });

  it('App applies the first plan through a functional update, not a stale store spread', () => {
    const src = readFileSync(join(root, 'src/App.jsx'), 'utf8');
    const start = src.indexOf('const handleCompleteOnboarding');
    const body = src.slice(start, src.indexOf('\n  };', start));
    assert.match(body, /setStore\(prev=> mergeOnboardingCompletion\(prev,/);
    assert.ok(!/setStore\(next\)/.test(body));
  });
});
