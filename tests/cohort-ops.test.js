import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ingestParticipantFiles, summariseCohort, renderCohortReport, ANALYSIS_GATES } from '../src/lib/cohortOps.js';
import { computeProductSuccessReport } from '../src/lib/productSuccess.js';

function sess(id, dateISO, exerciseId, reps='8', kg='40'){ return { id, dateISO, blocks: [{ exerciseId, sets: [{ reps, weightKg: kg, rpe: '' }] }] }; }

function storeFixture(id, { sessions = 5, consent = true, enrolled = true, armFlipped = false } = {}){
  const history = [];
  for(let i = 0; i < sessions; i++) history.push(sess(`s${i}`, `2026-01-${String(1 + i * 3).padStart(2, '0')}`, 'bench-press-dumbbell'));
  const ledger = [{ id: 'l1', recommendation: { load: 40, reps: 8 }, assignedArm: 'arise', outcome: { assignedMet: true, dateISO: '2026-01-06' }, provenance: { origin: 'live-engine' } }];
  if(sessions > 5) ledger.push({ id: 'l2', recommendation: { load: 41, reps: 8 }, assignedArm: 'arise', outcome: { assignedMet: false, dateISO: '2026-01-09' }, provenance: { origin: 'live-engine' } });
  return {
    version: 9,
    studyParticipantId: id,
    preferences: { telemetryEnabled: consent },
    history,
    readinessLog: [{ dateISO: '2026-01-02', score: 70 }, {}], // second entry: undated → data-quality warning
    eventHistory: [{ id: 'e1', type: 'recommendation:shown' }, { id: 'e2', type: 'set:complete', elapsedMs: 3000 }],
    evaluationLedger: ledger,
    activeSchedule: { sessions: [ { id: 's0', dateISO: '2026-01-01', status: 'done' }, { id: 's1', dateISO: '2026-01-04', status: 'done' } ] },
    studyEnrollment: enrolled ? {
      studyVersion: 1,
      enrolledAtISO: '2026-01-01T00:00:00Z',
      assignments: {
        'bench-press-dumbbell': { arm: armFlipped ? 'double-progression' : 'arise', assignmentVersion: 1 },
        'goblet-squat': { arm: 'double-progression', assignmentVersion: 1 },
      },
    } : null,
  };
}

function pkg(id, opts = {}){ return JSON.stringify({ app: 'arise', exportedAt: opts.exportedAt || '2026-02-01T00:00:00Z', data: storeFixture(id, opts) }); }

describe('cohort ops: ingestion folds repeated exports into one participant', ()=>{
  it('two exports of the same id merge — sessions union, never duplicated', ()=>{
    const early = pkg('a'.repeat(16), { sessions: 3 });
    const later = pkg('a'.repeat(16), { sessions: 5, exportedAt: '2026-03-01T00:00:00Z' });
    const ingest = ingestParticipantFiles([{ name: 'early.json', text: early }, { name: 'later.json', text: later }]);
    assert.equal(ingest.counts.uniqueParticipants, 1);
    assert.equal(ingest.counts.files, 2);
    const cohort = summariseCohort(ingest.participants, { nowISO: '2026-04-01T00:00:00Z' });
    assert.equal(cohort.totals.participants, 1);
    assert.equal(cohort.totals.sessions, 5, 'cumulative snapshots union by id: 5 sessions, not 8');
    assert.equal(cohort.totals.exports, 2, 'export count still shows both files');
    assert.equal(ingest.participants[0].sourceFiles.length, 2);
  });

  it('distinct ids stay distinct people', ()=>{
    const ingest = ingestParticipantFiles([{ name: 'a.json', text: pkg('a'.repeat(16)) }, { name: 'b.json', text: pkg('b'.repeat(16)) }]);
    assert.equal(ingest.counts.uniqueParticipants, 2);
  });

  it('byte-identical duplicate files are counted, not merged twice', ()=>{
    const text = pkg('a'.repeat(16));
    const ingest = ingestParticipantFiles([{ name: 'one.json', text }, { name: 'two.json', text }]);
    assert.equal(ingest.counts.uniqueParticipants, 1);
    assert.equal(ingest.counts.duplicateFiles, 1);
    assert.ok(ingest.warnings.some(w => w.kind === 'duplicate-file' && w.file === 'two.json'));
    const cohort = summariseCohort(ingest.participants, { nowISO: '2026-04-01T00:00:00Z' });
    assert.equal(cohort.totals.sessions, 5, 'a duplicate contributes nothing to totals');
  });

  it('malformed participant ids are detected and routed to the unidentified pool', ()=>{
    const ingest = ingestParticipantFiles([{ name: 'bad.json', text: JSON.stringify({ app: 'arise', data: { ...storeFixture('zzz'), studyParticipantId: 'zzz' } }) }]);
    assert.equal(ingest.counts.uniqueParticipants, 0);
    assert.equal(ingest.counts.unidentifiedExports, 1);
    assert.ok(ingest.warnings.some(w => w.kind === 'malformed-id' && w.file === 'bad.json'));
  });

  it('conflicting records between exports are reported, never silently overwritten', ()=>{
    const base = storeFixture('a'.repeat(16));
    const edited = JSON.parse(JSON.stringify(base));
    edited.evaluationLedger[0].outcome.assignedMet = false; // same id, different outcome
    const ingest = ingestParticipantFiles([
      { name: 'one.json', text: JSON.stringify({ app: 'arise', data: base }) },
      { name: 'two.json', text: JSON.stringify({ app: 'arise', data: edited }) },
    ]);
    const conflict = ingest.warnings.find(w => w.kind === 'conflicting-record');
    assert.ok(conflict, 'a divergent same-id ledger row must produce a conflict warning');
    assert.match(conflict.detail, /ledger:l1/);
    // The merge still succeeds (resolved/newest copy wins) — but loudly.
    assert.equal(ingest.counts.uniqueParticipants, 1);
  });

  it('impossible arm changes are detected and the earliest frozen assignment wins', ()=>{
    const ingest = ingestParticipantFiles([
      { name: 'one.json', text: pkg('a'.repeat(16), { armFlipped: false }) },
      { name: 'two.json', text: pkg('a'.repeat(16), { armFlipped: true, exportedAt: '2026-03-01T00:00:00Z' }) },
    ]);
    const flip = ingest.warnings.find(w => w.kind === 'impossible-arm');
    assert.ok(flip, 'an arm flip across exports of one participant must warn');
    assert.match(flip.detail, /bench-press-dumbbell: arise→double-progression/);
    const arms = Object.values(ingest.participants[0].store.studyEnrollment.assignments).map(a => a.arm);
    assert.equal(arms.filter(a => a === 'arise').length, 1, 'earliest frozen assignment is kept');
  });

  it('study-version mismatches warn', ()=>{
    const sv = storeFixture('a'.repeat(16));
    sv.studyEnrollment.studyVersion = 99;
    const ingest = ingestParticipantFiles([{ name: 'sv.json', text: JSON.stringify({ app: 'arise', data: sv }) }]);
    assert.ok(ingest.warnings.some(w => w.kind === 'study-version'));
  });

  it('invalid files are counted as import errors, not silently dropped', ()=>{
    const ingest = ingestParticipantFiles([{ name: 'junk.json', text: '{"app":"arise","data":{"history":"not-an-array"}}' }]);
    assert.equal(ingest.counts.importErrors, 1);
    assert.ok(ingest.warnings.some(w => w.kind === 'import-error'));
  });
});

describe('cohort ops: cohort summary', ()=>{
  it('totals, lifecycle and arm balance', ()=>{
    const cohort = summariseCohort([
      { code: 'aaaaa…', studyParticipantId: 'a'.repeat(16), store: storeFixture('a'.repeat(16)) },
      { code: 'bbbbb…', studyParticipantId: 'b'.repeat(16), store: storeFixture('b'.repeat(16), { sessions: 2, enrolled: false }) },
    ], { nowISO: '2026-02-01T00:00:00Z' });
    assert.equal(cohort.totals.participants, 2);
    assert.equal(cohort.totals.enrolled, 1);
    assert.ok(cohort.totals.sessions >= 7);
    assert.ok(cohort.totals.active >= 1, 'recent sessions → active');
    assert.equal(cohort.gate.eligible, false, 'tiny cohort cannot pass the gates');
    assert.ok(cohort.gate.deficits.participants > 0);
    assert.equal(cohort.armBalance.arise, 1);
    assert.equal(cohort.armBalance['double-progression'], 1);
    // Ledger transitions count from the rows themselves: an export can carry
    // assigned transitions without a live enrollment (e.g. a withdrawn
    // participant's history), and they still count as collected evidence.
    assert.equal(cohort.armBalance.ledgerTransitions.arise, 2);
  });

  it('withdrawn participants are counted as withdrawn, not active', ()=>{
    const s = storeFixture('a'.repeat(16));
    s.studyStatus = 'withdrawn';
    s.studyStatusChangedAtISO = '2026-01-20T00:00:00Z';
    const cohort = summariseCohort([{ code: 'aaaaa…', studyParticipantId: 'a'.repeat(16), store: s }], { nowISO: '2026-02-01T00:00:00Z' });
    assert.equal(cohort.totals.withdrawn, 1);
    assert.equal(cohort.totals.active, 0);
  });

  it('never ranks treatments while gates are unmet — report says so explicitly', ()=>{
    const cohort = summariseCohort(
      ['a', 'b'].map(c => ({ code: `${c}…`, studyParticipantId: c.repeat(16), store: storeFixture(c.repeat(16)) })),
      { nowISO: '2026-02-01T00:00:00Z' },
    );
    assert.equal(cohort.gate.eligible, false);
    assert.equal(cohort.gate.rankingAllowed, false);
    const md = renderCohortReport(cohort);
    assert.match(md, /Gates unmet — no treatment comparison is made/);
    assert.doesNotMatch(md, /arise (beats|wins|outperforms)/i);
    assert.equal(ANALYSIS_GATES.minParticipants, 10);
    assert.equal(ANALYSIS_GATES.minTransitions, 1000);
  });

  it('gate passes only when participants, transitions AND per-arm counts clear', ()=>{
    // Build a synthetic cohort that clears the gates.
    const stores = [];
    for(let i = 0; i < 12; i++){
      const s = storeFixture(i.toString(16).padStart(16, '0'), { sessions: 4 });
      s.evaluationLedger = [];
      for(let t = 0; t < 90; t++){
        s.evaluationLedger.push({
          id: `l${t}`, recommendation: { load: 40, reps: 8 }, assignedArm: t % 2 ? 'double-progression' : 'arise',
          outcome: { assignedMet: t % 3 !== 0, dateISO: '2026-02-01' }, provenance: { origin: 'live-engine' }, outcomeProvenance: { origin: 'live-engine' },
        });
      }
      stores.push({ code: i.toString(16).padStart(8, '0'), studyParticipantId: i.toString(16).padStart(16, '0'), store: s });
    }
    const cohort = summariseCohort(stores, { nowISO: '2026-03-01T00:00:00Z' });
    assert.equal(cohort.gate.eligible, true, JSON.stringify(cohort.gate));
    assert.equal(cohort.gate.rankingAllowed, true);
    const md = renderCohortReport(cohort);
    assert.match(md, /Gates met/);
    assert.match(md, /rankings come only from that prespecified pipeline/);
  });

  it('data-quality warnings surface per participant', ()=>{
    const cohort = summariseCohort([{ code: 'aaaaa…', studyParticipantId: 'a'.repeat(16), store: storeFixture('a'.repeat(16)) }], { nowISO: '2026-02-01T00:00:00Z' });
    assert.ok(cohort.quality.some(w => w.kind === 'undated-readiness'));
    assert.ok(cohort.missingObservations.readinessUndated >= 1);
  });

  it('logging-friction completeness reports both tiers', ()=>{
    const cohort = summariseCohort([{ code: 'aaaaa…', studyParticipantId: 'a'.repeat(16), store: storeFixture('a'.repeat(16)) }], { nowISO: '2026-02-01T00:00:00Z' });
    assert.equal(cohort.loggingFrictionCompleteness.withInteractionEvents, 1);
    assert.equal(cohort.loggingFrictionCompleteness.withTimingEvents, 1);
    assert.ok(cohort.loggingFrictionCompleteness.interactionCompleteness > 0);
  });

  it('unresolved recommendations are listed, not lost', ()=>{
    const s = storeFixture('a'.repeat(16));
    s.evaluationLedger.push({ id: 'open1', recommendation: { load: 40, reps: 8 }, assignedArm: 'arise', outcome: null });
    const cohort = summariseCohort([{ code: 'aaaaa…', studyParticipantId: 'a'.repeat(16), store: s }], { nowISO: '2026-02-01T00:00:00Z' });
    assert.equal(cohort.unresolvedRecommendations.total, 1);
    assert.equal(cohort.unresolvedRecommendations.byParticipant[0].code, 'aaaaa…');
  });

  it('contribution balance: one workhorse plus ghosts shows high concentration', ()=>{
    const stores = [];
    stores.push({ code: 'aaaaa…', studyParticipantId: 'a'.repeat(16), store: storeFixture('a'.repeat(16), { sessions: 20 }) });
    for(const c of ['b', 'c', 'd']) stores.push({ code: `${c}${c}${c}…`, studyParticipantId: c.repeat(16), store: storeFixture(c.repeat(16), { sessions: 1, enrolled: false }) });
    const cohort = summariseCohort(stores, { nowISO: '2026-02-01T00:00:00Z' });
    assert.ok(cohort.contribution.concentration > 0.5, `expected high concentration, got ${cohort.contribution.concentration}`);
    assert.ok(cohort.contribution.topQuintileSessionShare > 0.8);
  });

  it('report is deterministic (same inputs → same markdown)', ()=>{
    const files = [{ name: 'a.json', text: pkg('a'.repeat(16)) }, { name: 'b.json', text: pkg('b'.repeat(16)) }];
    const run = ()=> renderCohortReport(summariseCohort(ingestParticipantFiles(files).participants, { nowISO: '2026-02-01T00:00:00Z' }), { ingest: ingestParticipantFiles(files) });
    assert.equal(run(), run());
  });

  it('empty cohort renders honestly with zero everything', ()=>{
    const md = renderCohortReport(summariseCohort([], { nowISO: '2026-02-01T00:00:00Z' }));
    assert.match(md, /Participants \(unique people\) \| 0/);
    assert.match(md, /Gates unmet/);
  });
});

describe('cohort ops: unconsented exports stay out of product-success pooling', ()=>{
  it('product-success counts exclusions instead of averaging them in', ()=>{
    const files = [
      { name: 'a.json', text: pkg('a'.repeat(16), { consent: true }) },
      { name: 'b.json', text: pkg('b'.repeat(16), { consent: false }) },
      { name: 'bad.json', text: JSON.stringify({ app: 'arise', data: { ...storeFixture('zzz'), studyParticipantId: 'zzz' } }) },
    ];
    const ingest = ingestParticipantFiles(files);
    // Only IDENTIFIED participants are pooled: an export without a valid study
    // id cannot be proven to be a distinct person, so it stays out of the
    // averages entirely (same posture as the effectiveness gates).
    const report = computeProductSuccessReport(ingest.participants, { nowISO: '2026-02-15T00:00:00Z' });
    assert.equal(ingest.counts.unidentifiedExports, 1, 'the invalid id is detected upstream');
    assert.equal(report.consentedParticipants, 1);
    assert.equal(report.excludedUnconsented, 1);
    assert.equal(report.participants, 2);
  });
});
