import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NOTE_PROMPTS,
  fmtRest,
  newGuidedSet,
  initGuidedBlocks,
  nextGuidedStep,
  guidedProgress,
  guidedVolumeKg,
  sessionElapsedMs,
  formatElapsed,
  buildGuidedPayload,
} from '../src/lib/guidedMode.js';

const session = {
  id: 's1',
  dateISO: '2026-09-01',
  title: 'Day 1 — Push',
  week: 1,
  day: 1,
  programId: 'starter-3x',
  blocks: [
    { exerciseId: 'bench-press-dumbbell', sets: 2, reps: '8–12', restSec: 90, loadHint: '20kg' },
    { exerciseId: 'bodyweight-squat', sets: 2, reps: '12', restSec: 0 },
  ],
};

const history = [
  {
    id: 'h0', dateISO: '2026-08-30', title: 'Push',
    blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '10', weightKg: '20' }] }],
  },
];

describe('guidedMode — init', () => {
  it('flattens session blocks into per-set guided blocks with history prefill', () => {
    const blocks = initGuidedBlocks(session, history);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].sets.length, 2);
    assert.equal(blocks[0].sets[0].reps, '10');
    assert.equal(blocks[0].sets[0].weightKg, '20');
    assert.equal(blocks[0].sets[0].completed, false);
    assert.equal(blocks[1].sets[0].reps, '12');
  });

  it('prefers draft blocks over fresh init (crash recovery)', () => {
    const draftBlocks = [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '7', weightKg: '22', completed: true }], reps: '8–12', restSec: 90 }];
    const blocks = initGuidedBlocks(session, history, draftBlocks);
    assert.equal(blocks[0].sets.length, 1);
    assert.equal(blocks[0].sets[0].reps, '7');
    assert.equal(blocks[0].sets[0].weightKg, '22');
    assert.equal(blocks[0].sets[0].completed, true);
  });

  it('marks unilateral exercises from the exercise catalogue', () => {
    const uniSession = { id: 'u', dateISO: '2026-09-01', blocks: [{ exerciseId: 'bulgarian-split-squat', sets: 2, reps: '10', restSec: 60 }] };
    const blocks = initGuidedBlocks(uniSession, []);
    assert.equal(blocks[0].unilateral, true);
    assert.equal(blocks[0].sets[0].side, 'L');
  });
});

describe('guidedMode — steps and progress', () => {
  const blocks = initGuidedBlocks(session, history);

  it('returns the first unfinished set as the current step', () => {
    assert.deepEqual(nextGuidedStep(blocks), { blockIndex: 0, setIndex: 0 });
  });

  it('advances across block boundaries', () => {
    blocks[0].sets[0].completed = true;
    blocks[0].sets[1].completed = true;
    assert.deepEqual(nextGuidedStep(blocks), { blockIndex: 1, setIndex: 0 });
  });

  it('returns null when every set is resolved', () => {
    for(const b of blocks) for(const s of b.sets) s.completed = true;
    assert.equal(nextGuidedStep(blocks), null);
  });

  it('counts completed, skipped and pending correctly', () => {
    for(const b of blocks) for(const s of b.sets) s.completed = true;
    blocks[1].sets[1].completed = false;
    blocks[1].sets[1].skipped = true;
    const p = guidedProgress(blocks);
    assert.equal(p.total, 4);
    assert.equal(p.completed, 3);
    assert.equal(p.skipped, 1);
    assert.equal(p.pending, 0);
    assert.equal(p.pct, 100);
  });

  it('computes volume only over completed sets, honouring assisted subtraction', () => {
    const vol = guidedVolumeKg([
      { sets: [{ reps: '10', weightKg: '20', assistedKg: '', completed: true }, { reps: '10', weightKg: '20', completed: false }] },
      { sets: [{ reps: '12', weightKg: '', completed: true }] },
    ]);
    assert.equal(vol, 200);
  });
});

describe('guidedMode — timers', () => {
  it('formats rest times as m:ss or Ns', () => {
    assert.equal(fmtRest(90), '1:30');
    assert.equal(fmtRest(45), '45s');
    assert.equal(fmtRest(0), '0s');
  });

  it('never prints NaN, Infinity or a negative countdown', () => {
    assert.equal(fmtRest(NaN), '0s');
    assert.equal(fmtRest(Infinity), '0s');
    assert.equal(fmtRest(undefined), '0s');
    assert.equal(fmtRest(-5), '0s');
    assert.equal(fmtRest('45'), '45s');
  });

  it('formats elapsed milliseconds as m:ss', () => {
    assert.equal(formatElapsed(0), '0:00');
    assert.equal(formatElapsed(65000), '1:05');
    assert.equal(formatElapsed(3600000), '60:00');
  });

  it('clamps negative elapsed to zero and handles invalid input', () => {
    assert.equal(sessionElapsedMs('not-a-date'), 0);
    const now = Date.now();
    assert.equal(sessionElapsedMs(new Date(now + 60000).toISOString(), now), 0);
    assert.ok(sessionElapsedMs(new Date(now - 5000).toISOString(), now) >= 4900);
  });
});

describe('guidedMode — save payload', () => {
  it('builds a history payload matching the standard schema with mode guided', () => {
    const blocks = initGuidedBlocks(session, history);
    blocks[0].sets[0].completed = true;
    blocks[0].sets[1].completed = true;
    blocks[1].sets[0].skipped = true;
    blocks[1].sets[1].completed = true;
    const payload = buildGuidedPayload({
      session,
      blocks,
      note: 'felt good',
      noteTags: ['felt-strong'],
      startedAtISO: new Date(Date.now() - 10 * 60000).toISOString(),
      availableEquipment: ['dumbbells'],
    });
    assert.equal(payload.id, 's1');
    assert.equal(payload.mode, 'guided');
    assert.equal(payload.durationMinutes, 10);
    assert.equal(payload.exerciseOrder.length, 2);
    assert.equal(payload.blocks[0].sets[0].completed, true);
    assert.equal(payload.blocks[1].sets[0].skipped, true);
    assert.equal(payload.skippedSetsCount, 1);
    assert.equal(payload.note, 'Felt strong · felt good');
    assert.deepEqual(payload.noteTags, ['felt-strong']);
    assert.deepEqual(payload.equipmentSnapshot, ['dumbbells']);
  });

  it('never records a NaN duration from a malformed recovered draft', () => {
    const base = { session, blocks: [], startedAtISO: '2026-09-26T10:00:00.000Z' };
    assert.equal(buildGuidedPayload({ ...base, startedAtISO: 'bad' }).durationMinutes, 1);
    assert.equal(buildGuidedPayload({ ...base, nowISO: 'bad' }).durationMinutes, 1);
  });

  it('records the performed date when a future guided session is started early', () => {
    const futureSession = { ...session, id:'guided-future', dateISO:'2026-09-29' };
    const blocks = initGuidedBlocks(futureSession, []);
    blocks[0].sets[0].completed = true;
    const payload = buildGuidedPayload({
      session:futureSession,
      blocks,
      startedAtISO:'2026-09-27T10:00:00.000Z',
      nowISO:'2026-09-27T10:30:00.000Z',
      performedDateISO:'2026-09-27',
    });
    assert.equal(payload.dateISO, '2026-09-27');
    assert.equal(payload.scheduledDateISO, '2026-09-29');
  });

  it('marks pain flag when the pain tag is selected', () => {
    const blocks = initGuidedBlocks(session, []);
    blocks[0].sets[0].completed = true;
    const payload = buildGuidedPayload({
      session, blocks, noteTags: ['pain-discomfort'],
      startedAtISO: new Date().toISOString(),
    });
    assert.equal(payload.painDiscomfort, true);
    assert.equal(payload.blocks[0].sets[0].pain, true);
  });

  it('omits note fields when empty', () => {
    const blocks = initGuidedBlocks(session, []);
    blocks[0].sets[0].completed = true;
    const payload = buildGuidedPayload({ session, blocks, startedAtISO: new Date().toISOString() });
    assert.equal(payload.note, undefined);
    assert.equal(payload.noteTags, undefined);
  });

  it('keeps note tag vocabulary aligned with the standard runner', () => {
    const ids = NOTE_PROMPTS.map(p => p.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes('pain-discomfort'));
  });
});

import { applyFoundLoadToBlock } from '../src/lib/guidedMode.js';
import { needsWorkingWeight } from '../src/lib/workingWeight.js';

describe('guidedMode — first-lift finder', () => {
  it('applies the found load to pending sets only and swaps the warm-ups', () => {
    const blocks = [{ exerciseId: 'a', sets: [{ completed: true, weightKg: '10' }, { skipped: true, weightKg: '' }, { weightKg: '' }, { weightKg: '5' }] }];
    const out = applyFoundLoadToBlock(blocks, 0, 22.5, [{ kg: 10 }]);
    assert.deepEqual(out[0].sets.map(s => s.weightKg), ['10', '', '22.5', '22.5']);
    assert.deepEqual(out[0].warmups, [{ kg: 10 }]);
    assert.notEqual(out, blocks);
  });
  it('ignores bad input and other blocks', () => {
    const blocks = [{ sets: [{ weightKg: '' }] }, { sets: [{ weightKg: '' }] }];
    assert.equal(applyFoundLoadToBlock(blocks, 5, 20), blocks);
    assert.equal(applyFoundLoadToBlock(blocks, 0, ''), blocks);
    const out = applyFoundLoadToBlock(blocks, 1, 20);
    assert.equal(out[0], blocks[0]);
    assert.equal(out[1].sets[0].weightKg, '20');
  });
  it('a guided first-ever loaded lift needs the finder; one with a load does not', () => {
    const b = { exerciseId: 'chest-press-machine', sets: [{ weightKg: '' }] };
    assert.equal(needsWorkingWeight({ block: b, history: [], takesLoad: true }), true);
    assert.equal(needsWorkingWeight({ block: { ...b, sets: [{ weightKg: '30' }] }, history: [], takesLoad: true }), false);
  });
});

// The unit suite has no DOM, so these pin the accessibility wiring as source
// contracts (the same pattern as stepper-keyboard.test.js).
const src = (...parts)=> readFileSync(join(process.cwd(), 'src', ...parts), 'utf8');

describe('a11y pass — GuidedRunner announcements and hit targets', () => {
  const source = src('components', 'GuidedRunner.jsx');

  it('the in-dialog status region carries only rest-completion notices', () => {
    const region = source.slice(source.indexOf('role="status" aria-live="polite"'), source.indexOf('</span>', source.indexOf('role="status" aria-live="polite"')));
    assert.match(region, /\{announcement\}/);
    // No step text and no "Rest started" fallback — those were the stale,
    // double-announced copy. Steps are spoken once via the global announcer.
    assert.doesNotMatch(region, /Rest started, \$\{restLabel/);
    assert.doesNotMatch(region, /Step \$\{progress\.completed/);
  });

  it('clears a stale completion notice whenever a new step begins', () => {
    const effect = source.slice(source.indexOf('const stepKey ='), source.indexOf('const guidedMeta ='));
    assert.match(effect, /setAnnouncement\(''\)/);
    assert.match(effect, /speakCurrentStep\(step, blocks, voiceOn\)/);
  });

  it('keeps the visible "Load kg"/"Load lb" string inside the input accessible name', () => {
    assert.ok(source.includes('aria-label={`Load ${unit} — in '));
    assert.ok(!source.includes('aria-label={`Load in '));
  });

  it('gives the unilateral L/R buttons and completion note chips a 44px hit area', () => {
    assert.match(source, /min-h-11 min-w-11 px-4 rounded-full border text-xs font-bold/);
    assert.ok(!source.includes('min-h-9'));
    assert.match(source, /min-h-11 text-xs font-semibold px-2\.5 py-1\.5 rounded-full border/);
  });
});

describe('a11y pass — SessionRunner rest announcement and scrolling', () => {
  const source = src('components', 'SessionRunner.jsx');
  const startRest = source.slice(source.indexOf('const startRest='), source.indexOf('// ── Preferences'));
  const voiceOn = startRest.slice(startRest.indexOf('if(appPrefs?.voiceCoach === true)'), startRest.indexOf('} else {'));

  it('routes voice-coach rest text through the global announcer as spoken, without the SR region', () => {
    assert.match(voiceOn, /speak\(restText, Number\(appPrefs\?\.voiceRate\) \|\| 1\)/);
    assert.match(voiceOn, /announce\(restText, \{ key: 'rest-start', spoken: true \}\)/);
    assert.doesNotMatch(voiceOn, /setRestAnnouncement/);
  });

  it('keeps the single in-runner announcement when the voice coach is off', () => {
    assert.match(startRest, /setRestAnnouncement\(`Rest started for \$\{label\}: \$\{formatRest\(sec\)\}\.`\)/);
  });

  it('routes all three smooth scrolls through the reduced-motion helper', () => {
    assert.match(source, /import \{ announce, useDialogA11y, scrollIntoViewWithReducedMotion \} from '\.\.\/lib\/a11y\.js';/);
    assert.equal((source.match(/scrollIntoViewWithReducedMotion\(/g) || []).length, 3);
    assert.ok(!source.includes('scrollIntoView({ behavior:\'smooth\''));
    assert.ok(!source.includes("scrollIntoView({ behavior: 'smooth'"));
  });

  it('gives the "Details & rationale" summary a 44px hit area', () => {
    assert.match(source, /<summary className="min-h-11 text-\[11px\] text-ink3 cursor-pointer select-none">Details & rationale<\/summary>/);
  });
});

describe('a11y pass — shared control touch targets and labels', () => {
  it('gives the TeachingPanel How-to trigger a 44px hit area without changing its name', () => {
    const source = src('components', 'TeachingPanel.jsx');
    assert.match(source, /min-h-11 text-\[11px\] font-bold px-2\.5 py-1 rounded-full border/);
    assert.ok(source.includes("'How-to'} — ${open ? 'Hide how to do it' : 'Show how to do it'} for ${t.name}`"));
  });

  it('names the SetRow Done button by set and state even when it shows only a tick', () => {
    const source = src('components', 'session', 'SetRow.jsx');
    assert.ok(source.includes("aria-label={`Set ${si+1}: ${s.completed ? 'completed, undo' : 'mark done'}`}"));
  });

  it('gives the AppShell theme toggle a 44px hit area', () => {
    const source = src('components', 'AppShell.jsx');
    assert.match(source, /min-h-11 min-w-11 px-2 grid place-items-center rounded-full/);
    assert.ok(!source.includes('min-h-9'));
  });

  it('announces ProgrammeEditor stepper values with the field label, not a bare number', () => {
    const stepper = src('components', 'ProgrammeEditor.jsx');
    const fn = stepper.slice(stepper.indexOf('function Stepper('), stepper.indexOf('export default function ProgrammeEditor'));
    assert.match(fn, /min-w-10 text-center text-sm font-black tabular-nums" aria-hidden="true">\{value\}<\/span>/);
    assert.ok(fn.includes('aria-live="polite">{`${label}: ${value}`}</span>'));
    assert.doesNotMatch(fn, /aria-live="polite"[^>]*>\{value\}/);
  });
});
