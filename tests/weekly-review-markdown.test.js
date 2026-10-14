// weekly-review-markdown.test.js — the Weekly Review Markdown export
// (backlog item 6).
//
// The export's contract is the review card's own honesty contract, carried
// over to a file:
//   * it renders EXACTLY what the card computed — no re-derivation, so the
//     file can never drift from (or improve on) what the user saw;
//   * every number in the output must come from the input data. The builder
//     is dumb on purpose: it formats, it never invents;
//   * empty sections are omitted, never rendered as placeholders — a week
//     with nothing to say exports a shorter file, not a padded one;
//   * the readiness verdict uses the SAME phrase source
//     (readinessVerdictLabel) the card speaks — no drift between screen and
//     file.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyReviewMarkdown, readinessVerdictLabel } from '../src/lib/weeklyReviewMarkdown.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = (...p)=> join(process.cwd(), ...p);
const card = readFileSync(root('src', 'components', 'WeeklyReviewCard.jsx'), 'utf8');

const FULL = {
  weekLabel: 'week 3',
  reviewedWeekKey: '2026-10-05',
  completion: { done: 3, total: 4 },
  volumeKg: 12345,
  volumeDelta: 8.2,
  improved: [{ name: 'push up', deltaPct: 4, conf: 'medium' }],
  steady: [{ name: 'goblet squat', note: 'level with last time' }],
  insufficient: ['dumbbell row'],
  prs: 2,
  noticed: [
    'Recovery: recovery supports the plan as written — 62 pts, medium confidence.',
    'Evidence: 3 readiness check-ins logged in the reviewed week.',
    'push up: you pushed hard in 2 sets — the load increase is earned.',
  ],
  learned: [{ question: 'Does 4 sets beat 3?', result: 'yes', confidence: 'medium', note: 'e1RM +3% over 4 weeks' }],
  readinessDecision: {
    recommendation: 'as-planned',
    score: 62,
    confidence: 'medium',
    factors: ['3-day readiness EMA', 'recent RPE cluster'],
    action: null,
  },
  readinessInWeek: 3,
  directives: [{ text: 'push up: sets → 4', reason: "Evidence supports the range; setDecision says add", }],
  deloadDecision: { yes: false, signals: [] },
};

describe('buildWeeklyReviewMarkdown', ()=>{
  it('renders each computed section with the card\'s own numbers', ()=>{
    const md = buildWeeklyReviewMarkdown(FULL);
    assert.match(md, /# Arise weekly review/);
    assert.match(md, /Week: week 3/);
    assert.match(md, /## What happened/);
    assert.match(md, /3\/4 workouts completed · 12,345 kg of work · \+8\.2% volume vs last week/);
    assert.match(md, /## Did I improve\?/);
    assert.match(md, /- push up ↑ 4% \(medium confidence\)/);
    assert.match(md, /- goblet squat — level with last time/);
    assert.match(md, /No clear trend yet on dumbbell row/);
    assert.match(md, /🏆 2 new personal bests/);
    assert.match(md, /## What Arise noticed/);
    assert.match(md, /^- push up: you pushed hard in 2 sets/m, 'card notice lines pass through verbatim');
    assert.match(md, /## What Arise learned/);
    assert.match(md, /“Does 4 sets beat 3\?” → yes \(medium confidence\): e1RM \+3% over 4 weeks/);
    assert.match(md, /## Recovery read/);
    assert.match(md, /- Verdict: recovery supports the plan as written — 62 pts, medium confidence/);
    assert.match(md, /- Based on: 3-day readiness EMA; recent RPE cluster\./);
    assert.match(md, /- 3 readiness check-ins logged this week\./);
    assert.match(md, /## Next week/);
    assert.match(md, /- push up: sets → 4 — Evidence supports the range; setDecision says add/);
    assert.match(md, /_Generated on-device by Arise from your own logs/);
  });

  it('a planned-deload week says so once, in its own line', ()=>{
    const md = buildWeeklyReviewMarkdown({ ...FULL, deloadDecision: { yes: true, signals: ['plateau'] } });
    assert.match(md, /Next week is a planned deload — volume is cut on purpose\./);
  });

  it('an empty/unlogged week exports a minimal honest file, not placeholders', ()=>{
    const md = buildWeeklyReviewMarkdown({});
    assert.match(md, /# Arise weekly review/);
    assert.ok(!md.includes('undefined'), 'an absent value must never concatenate as "undefined"');
    assert.ok(!md.includes('null'), 'an absent value must never concatenate as "null"');
    assert.ok(md.split('\n').length < 12, 'minimal week exports a short file');
  });

  it('malformed sections degrade to skips instead of throwing', ()=>{
    const md = buildWeeklyReviewMarkdown({
      completion: null,
      improved: 'not-an-array',
      noticed: null,
      learned: [{ }, null],
      readinessDecision: { recommendation: 'nonsense-band' },
      directives: 'broken',
    });
    assert.equal(typeof md, 'string');
    assert.doesNotMatch(md, /TypeError|undefined|NaN/);
  });

  it('is deterministic for the same data', ()=>{
    assert.equal(buildWeeklyReviewMarkdown(FULL), buildWeeklyReviewMarkdown(FULL));
  });

  it('renders no number that the input data did not contain', ()=>{
    const md = buildWeeklyReviewMarkdown(FULL);
    assert.match(md, /62 pts/, 'readiness score passes through verbatim');
    assert.ok(!/\b9[0-9]{2,}\b/.test(md), 'no invented magnitude');
    const noScore = buildWeeklyReviewMarkdown({
      ...FULL,
      readinessDecision: { ...FULL.readinessDecision, score: null },
      noticed: FULL.noticed.filter(n => !n.includes('pts')),
    });
    const readSection = (noScore.split('## Recovery read')[1] || '').split('##').join('\n---').split('\n---')[0] || '';
    assert.doesNotMatch(readSection, /\d+ pts/, 'an absent readiness score must not be formatted as pts');
    assert.ok(!noScore.includes('null'), 'an absent score must render as absent');
  });
});

describe('readinessVerdictLabel (shared with the card\'s recovery row)', ()=>{
  it('maps each recommendation to plain wording, null for unknown', ()=>{
    assert.equal(readinessVerdictLabel({ recommendation: 'as-planned' }), 'recovery supports the plan as written');
    assert.equal(readinessVerdictLabel({ recommendation: 'small-adjustment' }), 'a small adjustment is advised');
    assert.equal(readinessVerdictLabel({ recommendation: 'recovery-session' }), 'a recovery session is advised');
    assert.equal(readinessVerdictLabel({ recommendation: 'genuine-deload' }), 'a deload is advised');
    assert.equal(readinessVerdictLabel(null), null);
    assert.equal(readinessVerdictLabel({ recommendation: 'weird' }), null);
  });
});

// Wiring pin (source-text convention, as in more-surface.test.js): the card
// must speak the exported phrases from the shared builder and must NOT keep
// its own readiness averaging — a re-derivation is exactly the drift this
// module exists to end.
describe('WeeklyReviewCard wiring', ()=>{
  it('uses the shared label builder and passes the file the engine verdict', ()=>{
    assert.match(card, /readinessVerdictLabel\(/, 'recovery row speaks the shared phrase');
    assert.match(card, /buildWeeklyReviewMarkdown\(/, 'export builds from the shared builder');
    assert.match(card, /review\.readinessDecision/, 'export passes the graded verdict, not an average');
    assert.match(card, /readinessInWeek/, 'export names the week\'s check-in coverage');
    assert.doesNotMatch(card, /slice\(-8\)/, 'the naive 8-row average is gone');
    assert.match(card, /shareTextAsFile\(/, 'the file goes out through the existing share path');
  });
});
