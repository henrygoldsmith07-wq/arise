// Tests for the DX/resilience/expansion round: support diagnostics, salvage
// export, quota guard, share codes, voice-input parsing, app-CSV importers,
// the printable report, and the units.ts slice boundary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { storeShapeSummary, buildSupportBundle } from '../src/lib/supportDiagnostics.js';
import { salvageHistory, buildSalvagePayload, SALVAGE_CONTRACT } from '../src/lib/salvageExport.js';
import { evaluateQuotaPrompt, isWriteSafe } from '../src/lib/quotaGuard.js';
import { encodeShareCode, decodeShareCode, templateToSharePayload, shareCodeRoundTrips } from '../src/lib/shareCodes.js';
import { parseSetPhrase } from '../src/lib/voiceInput.js';
import { parseAppCsv, rowsToHistory, resolveExerciseId } from '../src/lib/appCsvImport.js';
import { buildProgressReport } from '../src/lib/printReport.js';
import { asUnit, fmtWeight } from '../src/lib/units.ts';

const sess = (dateISO, exerciseId, sets, extra = {}) => ({ dateISO, blocks: [{ exerciseId, sets }], ...extra });
const set = (weightKg, reps, extra = {}) => ({ weightKg, reps, completed: true, ...extra });

describe('support diagnostics', () => {
  it('summarises shape without leaking any record contents', () => {
    const store = {
      history: [sess('2026-08-01', 'bench-press', [set(80, 6)])],
      activeSchedule: { sessions: [1, 2] },
      customTemplates: [],
      readinessLog: [{ dateISO: '2026-09-01', score: 7 }],
      version: 13,
      onboarding: { goal: 'strength' },
    };
    const shape = storeShapeSummary(store);
    assert.equal(shape.historyCount, 1);
    assert.equal(shape.historyFirstDate, '2026-08-01');
    assert.equal(shape.schemaVersion, 13);
    assert.equal(shape.onboardingComplete, true);
    const json = JSON.stringify(shape);
    assert.equal(json.includes('bench-press'), false, 'exercise ids must not appear');
    assert.equal(json.includes('strength'), false, 'onboarding content must not appear');
  });

  it('builds a full bundle with platform info and no training data', async () => {
    const bundle = await buildSupportBundle({ store: { history: [sess('2026-08-01', 'bench-press', [set(80, 6)])] }, appVersion: 'test' });
    assert.equal(bundle.app, 'arise-support-bundle');
    assert.equal(bundle.appVersion, 'test');
    assert.ok(bundle.platform.userAgent);
    assert.equal(bundle.storeShape.historyCount, 1);
    assert.equal(JSON.stringify(bundle).includes('bench-press'), false);
  });

  it('tolerates broken stores', async () => {
    const bundle = await buildSupportBundle({ store: null, appVersion: 'test' });
    assert.equal(bundle.storeShape.historyCount, 0);
  });
});

describe('salvage export', () => {
  it('rescues intact rows and counts dropped ones without throwing', () => {
    const rawHistory = [
      sess('2026-08-01', 'bench-press', [set(80, 6)]),
      { dateISO: '2026-08-02', blocks: 'not-an-array' },
      null,
      { blocks: [{ exerciseId: 'x', sets: [] }] }, // no usable sets
    ];
    const { entries, dropped } = salvageHistory(rawHistory);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].dateISO, '2026-08-01');
    assert.equal(dropped, 3);
  });

  it('builds a salvage envelope, or null when nothing survives', () => {
    const payload = buildSalvagePayload({ history: [sess('2026-08-01', 'bench-press', [set(80, 6)])] });
    assert.equal(payload.contract, SALVAGE_CONTRACT);
    assert.equal(payload.salvage, true);
    assert.equal(payload.data.history.length, 1);
    assert.equal(buildSalvagePayload({ history: [] }), null);
    assert.equal(buildSalvagePayload(null), null);
  });
});

describe('quota guard', () => {
  it('prompts once per escalation level and never nags twice', () => {
    const health = { level: 'warning' };
    assert.equal(evaluateQuotaPrompt(health, null).shouldPrompt, true);
    assert.equal(evaluateQuotaPrompt(health, 'warning').shouldPrompt, false);
    assert.equal(evaluateQuotaPrompt({ level: 'critical' }, 'warning').shouldPrompt, true, 'escalation re-prompts');
    assert.equal(evaluateQuotaPrompt({ level: 'ok' }, 'critical').shouldPrompt, false, 'recovery is silent');
    assert.equal(evaluateQuotaPrompt(null, null).shouldPrompt, false);
  });

  it('treats unknown health as write-safe (fail-soft)', () => {
    assert.equal(isWriteSafe({ level: 'critical' }), false);
    assert.equal(isWriteSafe(null), true);
    assert.equal(isWriteSafe({ level: 'warning' }), true);
  });
});

describe('share codes', () => {
  const template = {
    program: {
      name: 'Push Pull', tagline: 'My split', level: 'Intermediate', daysPerWeek: 2,
      weeks: [{ week: 1, workouts: [
        { title: 'Push', blocks: [{ exerciseId: 'bench-press', sets: 3, reps: '8–12', restSec: 90 }] },
        { title: 'Pull', blocks: [{ exerciseId: 'pull-up', sets: 3, reps: 'AMRAP' }] },
      ] }],
    },
  };

  it('round-trips a template through a URI-safe code', () => {
    const code = encodeShareCode(template);
    assert.ok(code.startsWith('ARISE1.'));
    assert.match(code, /^[A-Za-z0-9_.-]+$/);
    const back = decodeShareCode(code);
    assert.equal(back.name, 'Push Pull');
    assert.equal(back.program.weeks[0].workouts.length, 2);
    assert.ok(back.id, 'fresh id minted');
    assert.ok(shareCodeRoundTrips(template));
  });

  it('rejects truncated, junk, and tampered codes loudly', () => {
    const code = encodeShareCode(template);
    assert.throws(() => decodeShareCode(code.slice(0, -4)), /damaged/);
    assert.throws(() => decodeShareCode('not a code'), /share code/);
    assert.throws(() => decodeShareCode('ARISE1.e30.A'), /damaged|usable/);
  });

  it('carries only the template definition — never history or ids', () => {
    const payload = templateToSharePayload({ ...template, id: 'tpl-123', history: [sess('2026-08-01', 'bench-press', [set(1, 1)])] });
    const json = JSON.stringify(payload);
    assert.equal(json.includes('tpl-123'), false);
    assert.equal(json.includes('history'), false);
  });
});

describe('voice input parsing', () => {
  it('parses spoken loads and reps including decimals', () => {
    assert.deepEqual(parseSetPhrase('sixty for eight'), { weightKg: 60, reps: 8 });
    assert.deepEqual(parseSetPhrase('twenty two point five for eight'), { weightKg: 22.5, reps: 8 });
    assert.deepEqual(parseSetPhrase('forty two point five by six'), { weightKg: 42.5, reps: 6 });
    assert.deepEqual(parseSetPhrase('one hundred for five'), { weightKg: 100, reps: 5 });
    assert.deepEqual(parseSetPhrase('80 x 5'), { weightKg: 80, reps: 5 });
  });

  it('treats a lone number as reps and rejects noise', () => {
    assert.deepEqual(parseSetPhrase('twelve'), { reps: 12 });
    assert.equal(parseSetPhrase('hello gym'), null);
    assert.equal(parseSetPhrase(''), null);
  });
});

describe('app CSV importers', () => {
  const { EXERCISE_BY_ID } = (() => {
    // data.js is imported lazily here so a catalogue change fails loudly here.
    return {};
  })();

  it('maps loose columns, delimiters and lb units into portable rows', () => {
    const csv = '01/08/2026;Pull Ups;22 lbs;10\n03/08/2026;Mystery Machine;50;8';
    const { rows, unmappedExercises, skipped } = parseAppCsv(csv, { byId: { 'pull-up': {} } });
    assert.equal(rows.length, 1, 'only the resolvable exercise maps');
    assert.equal(rows[0].exerciseId, 'pull-up');
    assert.equal(rows[0].sets[0].weightKg, 10, '22 lb ≈ 10 kg');
    assert.equal(rows[0].sets[0].reps, 10);
    assert.deepEqual(unmappedExercises, ['Mystery Machine']);
    assert.equal(skipped, 1);
  });

  it('handles headerless comma CSVs', () => {
    const { rows } = parseAppCsv('2026-08-01,Bench Press,80,6');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].exerciseId, 'bench-press');
    assert.equal(rows[0].sets.length, 1);
  });

  it('expands a set-count column when headers name it', () => {
    const { rows } = parseAppCsv('date,exercise,weight,sets,reps\n2026-08-01,Bench Press,80,3,6');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sets.length, 3, 'set count column expands rows');
  });

  it('resolves names via catalogue when provided', () => {
    assert.equal(resolveExerciseId('Back Squat', { 'squat': {} }), 'squat');
    assert.equal(resolveExerciseId('Totally Unknown', { 'squat': {} }), null);
  });

  it('groups parsed rows into day-level history entries', () => {
    const csv = 'date,exercise,weight (kg),reps\n2026-08-01,Bench Press,80,6\n2026-08-01,Bench Press,82.5,5\n2026-08-03,Deadlift,140,3';
    const history = rowsToHistory(parseAppCsv(csv).rows);
    assert.equal(history.length, 2, 'one entry per day');
    assert.equal(history[0].blocks.length, 2);
    assert.equal(history[1].blocks[0].exerciseId, 'deadlift');
  });
});

describe('printable report', () => {
  it('renders an aggregate HTML document from real history', () => {
    const store = {
      history: [
        sess('2026-08-01', 'bench-press', [set(80, 6)], { note: '' }),
        sess('2026-08-08', 'bench-press', [set(82.5, 6)]),
      ],
    };
    const html = buildProgressReport(store, { today: '2026-09-06', units: 'lb' });
    assert.ok(html.includes('Training progress report'));
    assert.ok(html.includes('2 sessions'));
    assert.ok(html.includes('Bench Press') || html.includes('Bench press') || html.includes('bench-press'), 'PR table lists the exercise');
    assert.ok(html.includes('lb'), 'respects unit preference');
    assert.ok(html.includes('Not medical advice'));
  });

  it('includes set detail only when requested', () => {
    const store = { history: [sess('2026-08-01', 'bench-press', [set(80, 6)])] };
    assert.equal(buildProgressReport(store).includes('Set detail'), false);
    assert.equal(buildProgressReport(store, { includeSets: true }).includes('Set detail'), true);
  });
});

describe('units.ts slice', () => {
  it('keeps the formatter contract identical after the TS migration', () => {
    assert.equal(asUnit('lb'), 'lb');
    assert.equal(asUnit('imperial'), 'kg');
    assert.equal(asUnit(undefined), 'kg');
    assert.equal(fmtWeight(102.5, 'lb'), '226 lb');
    assert.equal(fmtWeight(100, 'kg'), '100 kg');
    assert.equal(fmtWeight(null, 'kg'), '—');
    assert.equal(fmtWeight('', 'lb'), '—');
  });
});
