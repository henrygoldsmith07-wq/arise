import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeProductSuccessReport, measureProductSuccess, renderProductSuccessReport } from '../src/lib/productSuccess.js';

const T0 = '2026-01-05'; // a Monday
function iso(dayOffset){ const d = new Date(`${T0}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + dayOffset); return d.toISOString().slice(0, 10); }

// One participant whose anchor is T0 (first session). `weekMap` maps week
// index → number of sessions logged in that week (week 0 = the anchor week).
function storeFixture({ weekMap = { 0: 2 }, events = [], schedule = [], enrolledAt = '2026-01-05T00:00:00Z', modes = null } = {}){
  const history = [];
  let n = 0;
  for(const [weekIdx, count] of Object.entries(weekMap)){
    for(let i = 0; i < count; i++){
      const dayOffset = Number(weekIdx) * 7 + i;
      const mode = modes ? modes[`${weekIdx}-${i}`] : undefined;
      history.push({ id: `s${n++}`, dateISO: iso(dayOffset), mode: mode ?? 'standard', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '40', rpe: '' }] }] });
    }
  }
  return {
    version: 9,
    studyParticipantId: 'a'.repeat(16),
    preferences: { telemetryEnabled: true },
    history,
    readinessLog: [],
    eventHistory: events,
    evaluationLedger: [],
    activeSchedule: { sessions: schedule },
    studyEnrollment: { studyVersion: 1, enrolledAtISO: enrolledAt, assignments: {} },
  };
}

describe('product success: retention windows', ()=>{
  it('week-1 and week-4 retention with honest denominators', ()=>{
    // Two participants: one retained in both weeks, one churned after week 0.
    // Both are ≥5 weeks past anchor, so both count in every denominator.
    const p1 = { code: 'p1', store: storeFixture({ weekMap: { 0: 2, 1: 1, 4: 2 } }) };
    const p2 = { code: 'p2', store: storeFixture({ weekMap: { 0: 2 } }) };
    const report = computeProductSuccessReport([p1, p2], { nowISO: `${iso(42)}T00:00:00Z` });
    assert.equal(report.retention.week1.value, 0.5);
    assert.equal(report.retention.week1.n, 2);
    assert.equal(report.retention.week4.value, 0.5);
    assert.equal(report.retention.week4.n, 2);
    assert.equal(report.retention.week4.missing, 0);
  });

  it('participants without enough elapsed time are excluded from the denominator, not counted as churned', ()=>{
    // Enrolled 10 days ago: week 1 (days 7–13) is not yet decidable at day 10.
    const recent = { code: 'recent', store: storeFixture({ weekMap: { 0: 2 }, enrolledAt: `${iso(3)}T00:00:00Z` }) };
    const report = computeProductSuccessReport([recent], { nowISO: `${iso(10)}T00:00:00Z` });
    assert.equal(report.retention.week1.n, 0, 'not enough elapsed time → excluded from n');
    assert.equal(report.retention.week1.value, null);
    assert.equal(report.retention.week1.missing, 1, 'and the exclusion is visible');
  });

  it('sessions/user/week derives from observed weeks', ()=>{
    const p = { code: 'p1', store: storeFixture({ weekMap: { 0: 2, 1: 2 } }) };
    const m = measureProductSuccess(p.store, { nowISO: `${iso(20)}T00:00:00Z` });
    assert.equal(m.weeksObserved, 2);
    assert.equal(m.sessionsPerWeek, 2);
    assert.equal(m.week1SessionsPerWeek, 2);
  });
});

describe('product success: behaviour metrics', ()=>{
  const events = [
    { id: 'e1', type: 'recommendation:shown' },
    { id: 'e2', type: 'recommendation:shown' },
    { id: 'e3', type: 'recommendation:accepted' },
    { id: 'e4', type: 'session:start', sessionId: 'abandoned' },
    { id: 'e5', type: 'session:abandon', sessionId: 'abandoned' },
    { id: 'e6', type: 'set:complete', elapsedMs: 3000 },
    { id: 'e7', type: 'set:complete', elapsedMs: 5000 },
  ];
  const schedule = [
    { id: 's0', dateISO: iso(0), status: 'done' },
    { id: 'missed', dateISO: iso(-7), status: 'planned' }, // past and never done → missed
  ];

  it('completion, abandonment, acceptance and override rates carry n', ()=>{
    const store = storeFixture({ weekMap: { 0: 2 }, events, schedule });
    store.evaluationLedger = [
      { id: 'l1', recommendation: { load: 40, reps: 8 }, outcome: { assignedMet: true, userOverride: false } },
      { id: 'l2', recommendation: { load: 41, reps: 8 }, outcome: { assignedMet: false, userOverride: true } },
    ];
    const m = measureProductSuccess(store, { nowISO: `${iso(20)}T00:00:00Z` });
    assert.equal(m.completion.completed, 2);
    assert.equal(m.completion.abandonedWithoutSave, 1);
    assert.equal(m.completion.rate, 0.667, 'rates are rounded to 3dp');
    assert.equal(m.abandonmentRate, 0.333);
    assert.equal(m.acceptance.shown, 2);
    assert.equal(m.acceptance.rate, 0.5);
    assert.equal(m.overrideRate.value, 0.5);
    assert.equal(m.overrideRate.n, 2);
    assert.equal(m.adherence.scheduled, 2);
    assert.equal(m.adherence.done, 1);
    assert.equal(m.adherence.missed, 1);
    assert.equal(m.adherence.rate, 0.5);
  });

  it('median logging time and its missingness', ()=>{
    const withTiming = storeFixture({ events });
    const m1 = measureProductSuccess(withTiming, { nowISO: `${iso(20)}T00:00:00Z` });
    assert.equal(m1.medianLoggingTimeMs, 3000, 'lower median of [3000, 5000] — matching telemetry loggingTimeStats');
    assert.equal(m1.loggingTimeN, 2);
    const withoutTiming = storeFixture({ events: [{ id: 'e1', type: 'recommendation:shown' }] });
    const m2 = measureProductSuccess(withoutTiming, { nowISO: `${iso(20)}T00:00:00Z` });
    assert.equal(m2.medianLoggingTimeMs, null, 'no timing data → null, never a fabricated median');
    assert.ok(m2.missing.timingEvents > 0);
  });

  it('Guided/Gym/Standard usage is counted per saved session', ()=>{
    const store = storeFixture({ weekMap: { 0: 4 }, modes: { '0-0': 'guided', '0-1': 'gym', '0-2': 'standard', '0-3': 'guided' } });
    const m = measureProductSuccess(store, { nowISO: `${iso(20)}T00:00:00Z` });
    assert.deepEqual(m.modeUsage, { guided: 2, gym: 1, standard: 1, untagged: 0 });
  });

  it('dropout flags a >28-day silence, not a busy month', ()=>{
    const active = measureProductSuccess(storeFixture({ weekMap: { 0: 1, 4: 1 } }), { nowISO: `${iso(35)}T00:00:00Z` });
    assert.equal(active.dropout, false);
    const gone = measureProductSuccess(storeFixture({ weekMap: { 0: 1 } }), { nowISO: `${iso(40)}T00:00:00Z` });
    assert.equal(gone.dropout, true);
    assert.equal(gone.daysSinceLastSession, 40);
  });
});

describe('product success: consent + rendering', ()=>{
  it('unconsented exports are excluded entirely and counted', ()=>{
    const consented = { code: 'p1', store: storeFixture({}) };
    const unconsentedStore = storeFixture({});
    unconsentedStore.preferences = { telemetryEnabled: false };
    const report = computeProductSuccessReport([consented, { code: 'p2', store: unconsentedStore }], { nowISO: `${iso(42)}T00:00:00Z` });
    assert.equal(report.consentedParticipants, 1);
    assert.equal(report.excludedUnconsented, 1);
    assert.equal(report.participants, 2);
  });

  it('every rendered rate carries a denominator; empty data renders honestly', ()=>{
    const report = computeProductSuccessReport([], { nowISO: `${iso(42)}T00:00:00Z` });
    const md = renderProductSuccessReport(report);
    assert.match(md, /0 consenting participant/);
    assert.match(md, /No consenting participants yet/);
    assert.match(md, /—/, 'empty cells render as an em dash, not 0%');
  });

  it('full report renders every promised metric', ()=>{
    const events = [
      { id: 'e1', type: 'recommendation:shown' },
      { id: 'e2', type: 'recommendation:accepted' },
      { id: 'e3', type: 'set:complete', elapsedMs: 4200 },
    ];
    const p = { code: 'p1', store: storeFixture({ weekMap: { 0: 2, 1: 1, 4: 1 }, events }) };
    const md = renderProductSuccessReport(computeProductSuccessReport([p], { nowISO: `${iso(42)}T00:00:00Z` }));
    for(const heading of ['Week-1 retention', 'Week-4 retention', 'Sessions/user/week', 'Workout completion rate', 'Recommendation acceptance', 'Override rate', 'Abandonment', 'Median logging time', 'Guided / Gym / Standard usage', 'Study adherence', 'Participant dropout']){
      assert.ok(md.includes(heading), `report must include "${heading}"`);
    }
    assert.match(md, /n=/, 'denominators shown');
  });

  it('is deterministic for identical inputs', ()=>{
    const p = { code: 'p1', store: storeFixture({ weekMap: { 0: 2, 1: 1, 4: 1 }, events: [{ id: 'e1', type: 'recommendation:shown' }] }) };
    const a = renderProductSuccessReport(computeProductSuccessReport([p], { nowISO: `${iso(42)}T00:00:00Z` }));
    const b = renderProductSuccessReport(computeProductSuccessReport([p], { nowISO: `${iso(42)}T00:00:00Z` }));
    assert.equal(a, b);
  });
});
