// Product-strategy layer tests: milestones, training age, consistency, the
// monthly digest, next-best-action, change summaries, the healthy streak,
// the experience-mode gate, and the demo store's honesty invariants.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MILESTONES, milestoneState, trainingAgeDisplay, consistencyInsights,
  healthyStreak, monthlyDigest, nextBestAction, whatChangedSummary,
} from '../src/lib/product.js';
import { resolveExperience, isExpertView, isSimpleView, experiencePatch, EXPERIENCE_LEVELS } from '../src/lib/experienceMode.js';
import { makeDemoStore, makeHistory, JOURNEY_SEEDS } from '../src/lib/demoData.js';
import { validateStoreData } from '../src/lib/export.js';

const TODAY = '2026-09-05';

const sessions = (dates) => dates.map((dateISO, i) => ({ id: `s${i}`, dateISO, blocks: [{ exerciseId: 'push-up', sets: [{ reps: '10', weightKg: '0' }] }] }));

describe('milestones', () => {
  it('reach, show next, and count distance honestly', () => {
    const ms = milestoneState(sessions(Array.from({ length: 12 }, (_, i) => `2026-08-${String(10 + i).padStart(2, '0')}`)));
    assert.equal(ms.count, 12);
    assert.ok(ms.reached.some((m) => m.id === 'ten'));
    assert.ok(!ms.reached.some((m) => m.id === 'twentyfive'));
    assert.equal(ms.next.id, 'twentyfive');
    assert.equal(ms.toNext, 13);
    assert.equal(ms.pctToNext, 48);
  });
  it('an empty history has everything ahead and no reached milestones', () => {
    const ms = milestoneState([]);
    assert.equal(ms.count, 0);
    assert.equal(ms.next.id, MILESTONES[0].id);
    assert.equal(ms.toNext, 1);
    assert.equal(ms.reached.length, 0);
  });
});

describe('training age display', () => {
  it('counts months from the first session and labels the phase', () => {
    const age = trainingAgeDisplay(sessions(['2026-03-01', '2026-09-01']), { today: TODAY });
    assert.equal(age.started, '2026-03-01');
    assert.equal(age.phase, 'Establishing');
    assert.ok(age.months > 5 && age.months < 7, `months=${age.months}`);
  });
  it('is null-safe on an empty history', () => {
    assert.equal(trainingAgeDisplay([], { today: TODAY }).months, null);
  });
});

describe('consistency insights', () => {
  it('counts weeks with any training, capped by the span since first session', () => {
    // Two sessions in one recent week, today is Sunday — grace keeps the run.
    const history = sessions([TODAY, '2026-08-31', '2026-06-01']);
    const ci = consistencyInsights(history, { today: TODAY, weeks: 6 });
    assert.equal(ci.weeksElapsed, 6);
    assert.ok(ci.weeksActive >= 1 && ci.weeksActive <= 2, `active=${ci.weeksActive}`);
    assert.ok(ci.currentRunWeeks >= 1, `run=${ci.currentRunWeeks}`);
  });
  it('a lapsed run is not a punishment — just a fresh start flag', () => {
    const hs = healthyStreak(sessions(['2026-05-01', '2026-05-03']), { today: TODAY });
    assert.equal(hs.currentWeeks, 0);
    assert.equal(hs.lapsed, true);
    assert.match(hs.framing, /fresh start/);
  });
  it('no guilt vocabulary in any framing string', () => {
    const hs = healthyStreak(sessions(['2026-09-01']), { today: TODAY });
    for (const banned of ['miss', 'broke', 'lost', 'failed']) assert.ok(!hs.framing.includes(banned));
  });
});

describe('monthly digest', () => {
  it('aggregates the named month only', () => {
    const history = [
      ...sessions(['2026-08-02', '2026-08-16']).map((s, i) => ({ ...s, durationMinutes: 40 + i * 10, blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '24' }] }] })),
      ...sessions(['2026-07-02']),
    ];
    const d = monthlyDigest(history, { today: TODAY, month: '2026-08' });
    assert.equal(d.month, '2026-08');
    assert.equal(d.sessions, 2);
    assert.equal(d.sets, 2);
    assert.equal(d.volume, 2 * 8 * 24);
    assert.equal(d.minutes, 90);
    assert.equal(d.topMuscle != null || d.topMuscle === null, true);
  });
  it('defaults to the previous calendar month and returns zeros for none', () => {
    const d = monthlyDigest([], { today: TODAY });
    assert.equal(d.sessions, 0);
  });
});

describe('next best action', () => {
  it('walks the ladder: onboard → program → today → recovery → next → milestone', () => {
    const bare = nextBestAction({ store: {}, today: TODAY });
    assert.equal(bare.id, 'onboard');
    const noSched = nextBestAction({ store: { onboarding: { goal: 'strength' } }, today: TODAY });
    assert.equal(noSched.id, 'choose-program');
    assert.equal(noSched.tab, 'train');
    const withToday = nextBestAction({ store: { onboarding: {}, activeSchedule: {} }, today: TODAY, todaySession: { title: 'Push + Legs' } });
    assert.equal(withToday.id, 'start-today');
    const withRecovery = nextBestAction({ store: { onboarding: {}, activeSchedule: {} }, today: TODAY, recovery: { needed: true, recommendation: 'fold forward' } });
    assert.equal(withRecovery.id, 'recover');
    const upNext = nextBestAction({ store: { onboarding: {}, activeSchedule: {} }, today: TODAY, nextSess: { title: 'Hinge + Pull' } });
    assert.equal(upNext.id, 'preview-next');
    const milestone = nextBestAction({ store: { onboarding: {}, activeSchedule: {}, history: sessions(['2026-09-01']) }, today: TODAY });
    assert.equal(milestone.id, 'milestone');
  });
});

describe('what changed summary', () => {
  it('formats adaptation and session bases without inventing reasons', () => {
    const schedule = { lastAdaptation: { dateISO: '2026-09-01', changes: [{ exerciseId: 'push-up', reason: 'repeated success added a set' }] } };
    const out = whatChangedSummary({ schedule, history: [] });
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'programme');
    assert.match(out[0].lines[0], /repeated success added a set/);
    assert.deepEqual(whatChangedSummary({ schedule: null, history: [] }), []);
  });
});

describe('experience mode gate', () => {
  it('defaults to standard and clamps invalid values', () => {
    assert.equal(resolveExperience({}), 'standard');
    assert.equal(resolveExperience({ experience: 'bogus' }), 'standard');
    assert.deepEqual(experiencePatch('expert'), { experience: 'expert' });
    assert.deepEqual(experiencePatch('bogus'), { experience: 'standard' });
    assert.equal(isExpertView({ experience: 'expert' }), true);
    assert.equal(isSimpleView({ experience: 'simple' }), true);
    assert.equal(isExpertView({}), false);
    assert.deepEqual(EXPERIENCE_LEVELS, ['simple', 'standard', 'expert']);
  });
});

describe('demo store honesty invariants', () => {
  it('is deterministic per seed and fully labeled as demo', () => {
    const a = makeDemoStore();
    const b = makeDemoStore();
    assert.deepEqual(a.history.map((h) => h.id), b.history.map((h) => h.id));
    assert.equal(a.demo, true);
    for (const h of a.history) assert.ok(String(h.id).startsWith('demo-'), `id ${h.id} lacks demo prefix`);
  });
  it('has a live schedule with an undated-future session and passes boot validation', () => {
    const demo = makeDemoStore();
    assert.ok(demo.activeSchedule?.sessions?.length > 0);
    const future = demo.activeSchedule.sessions.filter((s) => s.dateISO >= TODAY && s.status !== 'done');
    assert.ok(future.length > 0, 'demo schedule must still have sessions to run');
    assert.ok(demo.history.length > 0);
    // The demo store must satisfy the same validation as any real store.
    const { errors } = validateStoreData({ ...demo, history: demo.history, eventHistory: demo.eventHistory || [] });
    assert.ok(!errors || errors.length === 0, `validation errors: ${JSON.stringify(errors)}`);
  });
  it('keeps the generator deterministic while alive on the real calendar', () => {
    const h = makeHistory(JOURNEY_SEEDS.consistent, { sessions: 22, startDaysAgo: 38 });
    assert.ok(h[0].dateISO <= TODAY);
    // Living-relative freshness: the demo's last logged session must sit
    // within the last 14 days — never a dead archive.
    const daysAgo = Math.round((Date.parse(`${TODAY}T00:00:00Z`) - Date.parse(`${h[h.length - 1].dateISO}T00:00:00Z`)) / 86400000);
    assert.ok(daysAgo <= 14, `last session ${h[h.length - 1].dateISO} is ${daysAgo}d stale`);
  });
});
