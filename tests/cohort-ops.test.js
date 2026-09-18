import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ingestParticipantFiles, summariseCohort, renderCohortReport, ANALYSIS_GATES } from '../src/lib/cohortOps.js';
import { computeProductSuccessReport, measureProductSuccess, renderProductSuccessReport } from '../src/lib/productSuccess.js';

function sess(id, dateISO, exerciseId, reps='8', kg='40'){ return { id, dateISO, blocks: [{ exerciseId, sets: [{ reps, weightKg: kg, rpe: '' }] }] }; }

function storeFixture(id, { sessions = 5, consent = true, enrolled = true, armFlipped = false } = {}){
  const history = [];
  for(let i = 0; i < sessions; i++) history.push(sess(`s${i}`, `2026-01-${String(1 + i * 3).padStart(2, '0')}`, 'bench-press-dumbbell'));
  const ledger = [{ id: 'l1', recommendation: { load: 40, reps: 8 }, assignedArm: 'arise', outcome: { assignedMet: true, dateISO: '2026-01-06' }, provenance: { origin: 'live-engine' }, outcomeProvenance: { origin: 'live-engine' } }];
  if(sessions > 5) ledger.push({ id: 'l2', recommendation: { load: 41, reps: 8 }, assignedArm: 'arise', outcome: { assignedMet: false, dateISO: '2026-01-09' }, provenance: { origin: 'live-engine' }, outcomeProvenance: { origin: 'live-engine' } });
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
    assert.equal(ANALYSIS_GATES.minContributors, 10);
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
          // Distinct outcome session per row: real ledger rows resolve against
          // distinct sessions, and the canonical dedupe identity folds rows
          // that share (participant, exercise, prescription, outcome session).
          outcome: { assignedMet: t % 3 !== 0, dateISO: '2026-02-01', sessionId: `s${t}` }, provenance: { origin: 'live-engine' }, outcomeProvenance: { origin: 'live-engine' },
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

describe('cohort integrity: contributor gates, exhaustive conflicts, unresolved starts', ()=>{
  const ID = 'c'.repeat(16);

  // A store whose ledger row is a fully valid resolved assigned-arm
  // transition (live-engine provenance both sides, graded assignedMet).
  function contributorStore(id, { consent = true, arm = 'arise', met = true, valid = true } = {}){
    const s = storeFixture(id, { sessions: 3, consent, enrolled: true });
    s.evaluationLedger = [{
      id: 'l1', recommendation: { load: 40, reps: 8 }, assignedArm: arm,
      outcome: { assignedMet: valid ? met : null, dateISO: '2026-01-06' },
      provenance: { origin: 'live-engine' }, outcomeProvenance: { origin: 'live-engine' },
    }];
    return s;
  }

  it('9 non-contributors + 1 contributor: the participant gate counts ONE, never the enrolled nine', ()=>{
    const participants = [];
    // Nine enrolled, consented, session-logging people with NO valid resolved
    // assigned transition (outcome lacks assignedMet) — old gate counted
    // these as participants; the contributor gate must not.
    for(let i = 0; i < 9; i++){
      const id = (i + 1).toString(16).padStart(16, '0');
      participants.push({ code: id.slice(0, 8), studyParticipantId: id, store: contributorStore(id, { valid: false }) });
    }
    // One genuine contributor.
    const cid = 'f'.repeat(16);
    participants.push({ code: cid.slice(0, 8), studyParticipantId: cid, store: contributorStore(cid) });
    const cohort = summariseCohort(participants, { nowISO: '2026-02-01T00:00:00Z' });
    assert.equal(cohort.totals.enrolled, 10, 'all ten are enrolled');
    assert.equal(cohort.totals.contributors, 1, 'only one is a contributor');
    assert.equal(cohort.gate.participants, 1, 'the breadth gate reads contributors');
    assert.equal(cohort.gate.eligible, false, 'no usable assigned evidence → gate stays shut');
    assert.equal(cohort.gate.deficits.participants, ANALYSIS_GATES.minContributors - 1);
  });

  it('per-arm contributor counts split by assigned arm', ()=>{
    const mk = (hex, arm)=> ({ code: hex.slice(0, 8), studyParticipantId: hex, store: contributorStore(hex, { arm }) });
    const participants = [
      mk('1'.repeat(16), 'arise'),
      mk('2'.repeat(16), 'arise'),
      mk('3'.repeat(16), 'double-progression'),
      // A crossover contributor (valid rows in both arms) counts in both.
      (()=>{ const s = contributorStore('4'.repeat(16));
        s.evaluationLedger.push({ id: 'l2', recommendation: { load: 41, reps: 8 }, assignedArm: 'double-progression', outcome: { assignedMet: false, dateISO: '2026-01-09' }, provenance: { origin: 'live-engine' }, outcomeProvenance: { origin: 'live-engine' } });
        return { code: '44444444', studyParticipantId: '4'.repeat(16), store: s };
      })(),
    ];
    const cohort = summariseCohort(participants, { nowISO: '2026-02-01T00:00:00Z' });
    assert.equal(cohort.totals.contributors, 4);
    assert.equal(cohort.totals.contributorsArise, 3, 'two arise-only + one crossover');
    assert.equal(cohort.totals.contributorsDoubleProgression, 2, 'one dp-only + one crossover');
    assert.equal(cohort.gate.contributors.arise, 3);
    assert.equal(cohort.gate.contributors['double-progression'], 2);
  });

  it('unconsented people with valid rows are still not contributors', ()=>{
    const cid = 'd'.repeat(16);
    const cohort = summariseCohort(
      [{ code: cid.slice(0, 8), studyParticipantId: cid, store: contributorStore(cid, { consent: false }) }],
      { nowISO: '2026-02-01T00:00:00Z' },
    );
    assert.equal(cohort.totals.contributors, 0, 'consent is part of the contributor definition');
  });

  it('same session id with different reps/load/exercise is an exhaustive conflict', ()=>{
    const base = storeFixture(ID);
    const edited = JSON.parse(JSON.stringify(base));
    // Same id, materially different content — each dimension alone must trip it.
    edited.history[0].blocks[0].sets[0].reps = '12';
    const reps = ingestParticipantFiles([
      { name: 'one.json', text: JSON.stringify({ app: 'arise', data: base }) },
      { name: 'reps.json', text: JSON.stringify({ app: 'arise', data: JSON.parse(JSON.stringify({ ...edited })) }) },
    ]);
    assert.ok(reps.warnings.some(w => w.kind === 'conflicting-record' && /history:s0/.test(w.detail)), 'reps divergence detected');

    const load = JSON.parse(JSON.stringify(base)); load.history[0].blocks[0].sets[0].weightKg = '55';
    const loadIngest = ingestParticipantFiles([
      { name: 'one.json', text: JSON.stringify({ app: 'arise', data: base }) },
      { name: 'load.json', text: JSON.stringify({ app: 'arise', data: load }) },
    ]);
    assert.ok(loadIngest.warnings.some(w => w.kind === 'conflicting-record' && /history:s0/.test(w.detail)), 'load divergence detected');

    const exercise = JSON.parse(JSON.stringify(base)); exercise.history[0].blocks[0].exerciseId = 'goblet-squat';
    const exIngest = ingestParticipantFiles([
      { name: 'one.json', text: JSON.stringify({ app: 'arise', data: base }) },
      { name: 'ex.json', text: JSON.stringify({ app: 'arise', data: exercise }) },
    ]);
    assert.ok(exIngest.warnings.some(w => w.kind === 'conflicting-record' && /history:s0/.test(w.detail)), 'exercise divergence detected');
  });

  it('same-id history with identical content but reordered keys is NOT a conflict', ()=>{
    const base = storeFixture(ID);
    const same = JSON.parse(JSON.stringify(base));
    // Reverse key order of the session object — canonical comparison must
    // treat this as identical content.
    same.history[0] = Object.fromEntries(Object.entries(same.history[0]).reverse());
    const ingest = ingestParticipantFiles([
      { name: 'one.json', text: JSON.stringify({ app: 'arise', data: base }) },
      { name: 'two.json', text: JSON.stringify({ app: 'arise', data: same }) },
    ]);
    assert.ok(!ingest.warnings.some(w => w.kind === 'conflicting-record'), 'key order is not content');
    assert.equal(ingest.counts.duplicateFiles, 0, 'not byte-identical either — it merges normally');
  });

  it('a conflicting event row is reported, not dropped', ()=>{
    const base = storeFixture(ID);
    const edited = JSON.parse(JSON.stringify(base));
    edited.eventHistory[1].elapsedMs = 9999; // same id, different timing measurement
    const ingest = ingestParticipantFiles([
      { name: 'one.json', text: JSON.stringify({ app: 'arise', data: base }) },
      { name: 'two.json', text: JSON.stringify({ app: 'arise', data: edited }) },
    ]);
    const conflict = ingest.warnings.find(w => w.kind === 'conflicting-record');
    assert.ok(conflict, 'event divergence must be reported');
    assert.match(conflict.detail, /event:e2/);
  });

  it('duplicate detection is byte-exact: near-identical payloads are NOT duplicates', ()=>{
    const text = pkg(ID);
    const tweaked = pkg(ID, { exportedAt: '2026-02-02T00:00:00Z' }); // one byte-field different
    const ingest = ingestParticipantFiles([{ name: 'one.json', text }, { name: 'two.json', text: tweaked }]);
    assert.equal(ingest.counts.duplicateFiles, 0, 'different payloads are not duplicates');
    assert.equal(ingest.counts.uniqueParticipants, 1, 'same id still folds to one participant');
    const exact = ingestParticipantFiles([{ name: 'one.json', text }, { name: 'two.json', text }]);
    assert.equal(exact.counts.duplicateFiles, 1, 'byte-identical payloads are duplicates');
  });

  it('started-but-unresolved workouts appear as missing outcomes with n', ()=>{
    const s = storeFixture(ID);
    s.history = s.history.slice(0, 2); // two saved completions: s0, s1
    s.eventHistory = [
      { id: 'e1', type: 'session:start', sessionId: 's0' },
      { id: 'e2', type: 'session:start', sessionId: 's1' },
      { id: 'e3', type: 'session:start', sessionId: 'ghost' },   // neither saved nor abandoned
      { id: 'e4', type: 'session:abandon', sessionId: 'quit' }, // explicit abandonment (no start event — still counts)
    ];
    const m = measureProductSuccess(s, { nowISO: '2026-02-01T00:00:00Z' });
    assert.equal(m.completion.completed, 2);
    assert.equal(m.completion.abandonedWithoutSave, 1);
    assert.equal(m.completion.startedUnresolved, 1, 'the ghost start is counted, not dropped');
    assert.equal(m.completion.startedTotal, 3);
    const report = computeProductSuccessReport([{ code: 'cccccc…', store: s }], { nowISO: '2026-02-01T00:00:00Z' });
    assert.equal(report.startedUnresolved.count, 1);
    assert.equal(report.startedUnresolved.participants, 1);
    assert.equal(report.startedUnresolved.startedTotal, 3);
    const md = renderProductSuccessReport(report);
    assert.match(md, /Started but unresolved: 1 of 3/);
  });

  it('repeated exports stay deterministic: same files twice → identical reports', ()=>{
    const files = [
      { name: 'one.json', text: pkg('a'.repeat(16)) },
      { name: 'two.json', text: pkg('b'.repeat(16)) },
      { name: 'one-repeat.json', text: pkg('a'.repeat(16), { exportedAt: '2026-03-01T00:00:00Z' }) },
    ];
    const run = ()=> {
      const ingest = ingestParticipantFiles(files);
      return renderCohortReport(summariseCohort(ingest.participants, { nowISO: '2026-04-01T00:00:00Z' }), { ingest });
    };
    assert.equal(run(), run(), 'ingest → summarise → render is deterministic over repeated exports');
  });
});
