// readiness-surface.test.js — the check-in channel's user-visible surface,
// completing the loop the Weekly Review's evidence line made visible:
//   * Today nudges (without nagging) when the week has zero check-ins;
//   * Progress's "Am I improving?" assessment carries a bounded,
//     direction-aware recovery line from the same readiness helpers;
//   * the Train recommendation hero ("no programme running" — the evaluator's
//     landing surface) mounts the on-device coach with the scorer's own
//     stored reasons, so "why this programme?" answers before day one;
//   * the personal training model's recovery row reads a 14-day window with
//     a direction instead of an age-blind average.
//
// Rendering uses the repo's source-text pin convention (DOM-free Node tests,
// as in more-surface.test.js): the wiring is asserted on real component
// sources, the behaviour on the pure helpers underneath.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTrainingProfile } from '../src/lib/coach/trainingProfile.js';
import { localCoachAnswer } from '../src/lib/coach/localCoach.js';

const root = (...p)=> join(process.cwd(), ...p);
const src = (...p)=> readFileSync(root(...p), 'utf8');
const checkin = src('src', 'components', 'ReadinessCheckIn.jsx');
const progress = src('src', 'components', 'ProgressView.jsx');
const train = src('src', 'components', 'TrainView.jsx');

// 2026-09-28 is a Monday; the trend fixtures span that week and week+1.
const trendLog = [
  { dateISO: '2026-09-15', score: 42 }, { dateISO: '2026-09-17', score: 44 },
  { dateISO: '2026-09-18', score: 46 }, { dateISO: '2026-09-19', score: 48 },
  { dateISO: '2026-09-26', score: 74 }, { dateISO: '2026-09-27', score: 80 },
];

describe('Today: the zero-coverage nudge nudges, and only then', ()=>{
  it('wires the nudge to the shared coverage helper and gates it on zero', ()=>{
    assert.match(checkin, /readinessWeekCoverage\(/, 'coverage comes from the shared helper');
    assert.match(checkin, /coverage\.inWeek === 0/, 'nudge condition is genuinely zero coverage');
    assert.match(checkin, /data-testid="readiness-nudge"/, 'the nudge line is locatable');
    assert.match(checkin, /No check-ins logged this week/, 'the nudge names WHY it appears');
  });

  it('never narges when today already has a row or the week has coverage', ()=>{
    // the collapsed one-line resting state stays the DEFAULT: the nudge fires
    // only when `!existing && !justSaved && coverage.inWeek === 0`.
    const gate = checkin.match(/const weekBlank = ([^\n]+);/)?.[1] || '';
    assert.match(gate, /!existing/);
    assert.match(gate, /!justSaved/);
    assert.match(gate, /coverage\.inWeek === 0/);
  });
});

describe('Progress: the readiness line in the "Am I improving?" card', ()=>{
  it('renders a bounded, direction-aware line from readinessTrend', ()=>{
    assert.match(progress, /readinessTrend\(/);
    assert.match(progress, /Recovery \(check-ins\):/, 'the line names its provenance');
    assert.match(progress, /not enough yet to call a direction/, 'sparse coverage says so instead of guessing');
    assert.match(progress, /!simple && readinessTrendLine\(readinessRead\)/, 'the line keeps out of the simple view');
  });

  it('the line\'s wording matches the helper\'s actual outputs (no drift)', ()=>{
    // mirrors readinessTrendLine() from the component source, then checks the wording
    const fn = progress.match(/function readinessTrendLine\(read\)\{[\s\S]*?\n\}/)?.[0]
      || progress.match(/const readinessTrendLine[\s\S]{0,400};/)?.[0];
    assert.ok(fn, 'readinessTrendLine exists as a pure helper');
    assert.ok(/improving/.test(fn) && /declining/.test(fn) && /steady/.test(fn));
  });
});

describe('Train: the evaluator\'s landing coach', ()=>{
  it('mounts the lazy CoachPanel under the recommendation hero with stored reasons', ()=>{
    assert.match(train, /lazy\(\(\) => import\('\.\/CoachPanel\.jsx'\)\)/, 'lazy — the coaching graph never rides the Train chunk');
    assert.match(train, /<CoachPanel/, 'the panel mounts');
    assert.match(train, /Suspense fallback=\{null\}/, 'no layout flash while it loads');
    const why = train.match(/programmeWhy=\{[\s\S]*?\}\s*\/>/)?.[0] || '';
    assert.match(why, /recommendation\?\.reasons\?\.length/, 'programmeWhy exists only when the scorer stored reasons');
    assert.match(why, /programId: recommendation\.programId/, 'the reasons are plan-scoped, not generic');
  });
});

describe('training profile: the recovery row reads the window, not the age', ()=>{
  it('gives a DIRECTION from real check-ins, with the window named', ()=>{
    const profile = buildTrainingProfile({ store: { history: [], readinessLog: trendLog, preferences: {} }, today: '2026-09-28' });
    const row = profile.rows.find(r => r.id === 'recovery-readiness');
    assert.ok(row, '6 in-window check-ins produce the row');
    assert.match(row.value, /trending up/, 'recent half 74+ vs 42+ earlier reads improving');
    assert.match(row.detail, /keep whatever you were doing/);
    assert.ok(row.evidence.join(' ').includes('2026-09-15'), 'the window is named in the evidence');
  });

  it('stays honest when coverage is thin: average, no direction', ()=>{
    const profile = buildTrainingProfile({
      store: { history: [], readinessLog: [
        { dateISO: '2026-09-24', score: 58 }, { dateISO: '2026-09-26', score: 62 },
      ], preferences: {} }, today: '2026-09-28',
    });
    const row = profile.rows.find(r => r.id === 'recovery-readiness');
    assert.ok(row, 'some recent data still earns a row');
    assert.match(row.value, /averaging/, 'no direction is invented');
    assert.match(row.detail, /Not enough/);
    assert.equal(row.confidence, 'low');
  });

  it('stays absent when there is nothing to read', ()=>{
    const profile = buildTrainingProfile({ store: { history: [], readinessLog: [], preferences: {} }, today: '2026-09-28' });
    assert.equal(profile.rows.find(r => r.id === 'recovery-readiness'), undefined);
  });
});

describe('coach: "am I improving?" closes the check-in channel', ()=>{
  it('quotes the recovery row as labelled context under the no-fabrication contract', ()=>{
    // Minimal, but sufficient profile-like history: training-age needs 2+
    // sessions; without them the row is skipped and recovery still shows.
    const store = {
      history: [],
      activeSchedule: null,
      readinessLog: trendLog,
      onboarding: {},
      customTemplates: [],
      experiments: [],
    };
    const r = localCoachAnswer('am I improving?', { store, today: '2026-09-28' });
    assert.equal(r.ok, true);
    assert.match(r.text, /Recovery context/);
    assert.match(r.text, /trending up/);
    const forbidden = [
      /increase (?:your )?(?:load|weight) .* to \d+/i,
      /you should (?:add|do) \d+\\s*(?:kg|lb|sets?)/i,
    ];
    for(const re of forbidden) assert.doesNotMatch(r.text, re);
  });
});
