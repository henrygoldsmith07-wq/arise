import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPilotRoster, assessParticipant } from '../src/lib/pilotHealth.js';
import { ingestParticipantFiles } from '../src/lib/cohortOps.js';

const NOW = '2026-04-03T00:00:00Z';
const LIVE = { origin: 'live-engine' };

function base(id, { consent = true, status = 'enrolled' } = {}){
  return {
    version: 9,
    studyParticipantId: id,
    preferences: { telemetryEnabled: consent },
    history: [],
    readinessLog: [],
    eventHistory: [],
    evaluationLedger: [],
    studyEnrollment: { studyVersion: 1, enrolledAtISO: '2026-02-01T00:00:00Z', assignments: {} },
    ...(status === 'withdrawn' ? { studyStatus: 'withdrawn' } : { studyStatus: 'enrolled' }),
  };
}

function session(n, dayISO){
  return { id: 's' + n, dateISO: dayISO, mode: 'guided', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '40', rpe: '' }] }] };
}

function ledgerRow(i, arm, sessionId){
  return { id: 'r' + i, recommendation: { load: 40, reps: 8 }, assignedArm: arm, exerciseId: 'bench-press-dumbbell', provenance: LIVE, outcomeProvenance: LIVE, outcome: { assignedMet: true, metTarget: true, sessionId, dateISO: '2026-02-05', followed: true } };
}

function pkg(id, store, exportedAt){
  return { name: id.slice(0, 8) + '.json', text: JSON.stringify({ app: 'arise', exportedAt, data: { ...store, exportedAt } }) };
}

function warnOf(entry, prefix){ return entry.warnings.find(w => w.startsWith(prefix)) || null; }

describe('pilot roster', ()=>{
  it('healthy participant produces no warnings and full roster facts', ()=>{
    const store = base('a'.repeat(16));
    for(let i = 0; i < 6; i++) store.history.push(session(i, '2026-02-0' + (2 + i)));
    for(let i = 0; i < 10; i++) store.evaluationLedger.push(ledgerRow(i, i % 2 ? 'arise' : 'double-progression', 's' + (i % 6)));
    const ingest = ingestParticipantFiles([pkg('a'.repeat(16), store, '2026-04-01T10:00:00Z')]);
    const roster = buildPilotRoster(ingest.participants, { nowISO: NOW, ingest });
    const r = roster.roster[0];
    assert.equal(r.status, 'enrolled');
    assert.equal(r.consented, true);
    assert.equal(r.sessionsLogged, 6);
    assert.equal(r.transitions.arise, 3);
    assert.equal(r.transitions['double-progression'], 3);
    assert.equal(r.lastExportedAtISO, '2026-04-01T10:00:00Z');
    assert.equal(r.exportAgeDays, 1);
    assert.equal(r.needsAttention, false, JSON.stringify(r.warnings));
    assert.deepEqual(roster.counts, { participants: 1, enrolled: 1, withdrawn: 0, other: 0, needsAttention: 0, consented: 1 });
  });

  it('flags stale exports and missing export timestamps', ()=>{
    const stale = base('b'.repeat(16));
    stale.history.push(session(0, '2026-02-02'));
    const fresh = base('c'.repeat(16));
    fresh.history.push(session(0, '2026-03-20'));
    const never = base('d'.repeat(16));
    never.history.push(session(0, '2026-03-20'));
    const ingest = ingestParticipantFiles([
      pkg('b'.repeat(16), stale, '2026-03-04T10:00:00Z'),   // 29d before NOW
      pkg('c'.repeat(16), fresh, '2026-04-02T10:00:00Z'),   // 1d
      pkg('d'.repeat(16), never, '2026-04-02T11:00:00Z'),   // fresh export → not stale
    ]);
    const roster = buildPilotRoster(ingest.participants, { nowISO: NOW, ingest });
    const byCode = Object.fromEntries(roster.roster.map(r => [r.code, r]));
    assert.equal(warnOf(byCode['bbbbbbbb'], 'stale-export'), 'stale-export-29d');
    assert.equal(byCode['cccccccc'].needsAttention, false);
    assert.equal(byCode['dddddddd'].needsAttention, false, 'a fresh export means not stale');
  });

  it('missing-export-timestamp needs the flag even with a fresh file when no export timestamp exists', ()=>{
    const store = base('e'.repeat(16));
    const text = JSON.stringify({ app: 'arise', data: store }); // no exportedAt anywhere
    const ingest = ingestParticipantFiles([{ name: 'eeeeeeee.json', text }]);
    const roster = buildPilotRoster(ingest.participants, { nowISO: NOW, ingest });
    assert.equal(roster.roster[0].warnings.includes('missing-export-timestamp'), true, JSON.stringify(roster.roster[0].warnings));
  });

  it('flags consent loss and no workouts', ()=>{
    const lost = base('f'.repeat(16), { consent: false });
    lost.history.push(session(0, '2026-03-20'));
    const empty = base('0'.repeat(16));
    const ingest = ingestParticipantFiles([
      pkg('f'.repeat(16), lost, '2026-04-02T10:00:00Z'),
      pkg('0'.repeat(16), empty, '2026-04-02T10:00:00Z'),
    ]);
    const roster = buildPilotRoster(ingest.participants, { nowISO: NOW, ingest });
    const byCode = Object.fromEntries(roster.roster.map(r => [r.code, r]));
    assert.equal(byCode['ffffffff'].warnings.includes('consent-lost'), true);
    assert.equal(byCode['00000000'].warnings.includes('no-workouts'), true);
  });

  it('withdrawn participants are exempt from staleness — that is the lifecycle working', ()=>{
    const store = base('9'.repeat(16), { status: 'withdrawn' });
    store.history.push(session(0, '2026-02-02'));
    const ingest = ingestParticipantFiles([pkg('9'.repeat(16), store, '2026-02-05T10:00:00Z')]);
    const roster = buildPilotRoster(ingest.participants, { nowISO: NOW, ingest });
    const r = roster.roster[0];
    assert.equal(r.status, 'withdrawn');
    assert.equal(r.needsAttention, false, 'withdrawn people are expected to stop exporting: ' + JSON.stringify(r.warnings));
    assert.deepEqual(roster.counts, { participants: 1, enrolled: 0, withdrawn: 1, other: 0, needsAttention: 0, consented: 1 });
  });

  it('flags single-arm evidence only above the volume floor', ()=>{
    const oneSided = base('1'.repeat(16));
    for(let i = 0; i < 8; i++) oneSided.evaluationLedger.push(ledgerRow(i, 'arise', 'sa' + i));
    const small = base('2'.repeat(16));
    for(let i = 0; i < 5; i++) small.evaluationLedger.push(ledgerRow(i, 'arise', 'sb' + i));
    const ingest = ingestParticipantFiles([
      pkg('1'.repeat(16), oneSided, '2026-04-01T10:00:00Z'),
      pkg('2'.repeat(16), small, '2026-04-01T10:00:00Z'),
    ]);
    const roster = buildPilotRoster(ingest.participants, { nowISO: NOW, ingest });
    const byCode = Object.fromEntries(roster.roster.map(r => [r.code, r]));
    assert.equal(byCode['11111111'].warnings.includes('single-arm-evidence'), true, JSON.stringify(byCode['11111111'].warnings));
    assert.equal(byCode['22222222'].warnings.includes('single-arm-evidence'), false, 'below the 8-transition floor: ' + JSON.stringify(byCode['22222222'].warnings));
  });

  it('flags high abandonment and override-heavy participants', ()=>{
    const abandoner = base('3'.repeat(16));
    abandoner.history.push(session(0, '2026-03-20'));
    abandoner.history.push(session(1, '2026-03-22'));
    for(let i = 0; i < 4; i++){
      abandoner.eventHistory.push({ id: 'st' + i, type: 'session:start', sessionId: 'w' + i });
      abandoner.eventHistory.push({ id: 'ab' + i, type: 'session:abandon', sessionId: 'w' + i });
    }
    const overrider = base('4'.repeat(16));
    for(let i = 0; i < 10; i++){
      overrider.evaluationLedger.push(ledgerRow(i, i % 2 ? 'arise' : 'double-progression', 'w' + i));
      overrider.evaluationLedger[i].outcome.userOverride = true;
    }
    const ingest = ingestParticipantFiles([
      pkg('3'.repeat(16), abandoner, '2026-04-01T10:00:00Z'),
      pkg('4'.repeat(16), overrider, '2026-04-01T10:00:00Z'),
    ]);
    const roster = buildPilotRoster(ingest.participants, { nowISO: NOW, ingest });
    const byCode = Object.fromEntries(roster.roster.map(r => [r.code, r]));
    const ab = warnOf(byCode['33333333'], 'high-abandonment');
    assert.ok(ab && ab.startsWith('high-abandonment-'), JSON.stringify(byCode['33333333'].warnings));
    const ov = warnOf(byCode['44444444'], 'override-heavy');
    assert.ok(ov === 'override-heavy-100pct', JSON.stringify(byCode['44444444'].warnings));
  });

  it('flags logging-time outliers against the cohort median', ()=>{
    // Four fast participants set the cohort median at ~4s; the slow one
    // (60s) is far beyond 2× → flagged. A fast one is not.
    const slow = base('6'.repeat(16));
    for(let i = 0; i < 6; i++){
      slow.history.push(session(i, '2026-03-2' + i));
      slow.eventHistory.push({ id: 't' + i, type: 'set:complete', elapsedMs: 60000 });
    }
    const fasts = ['a', 'b', 'c', 'd'].map((ch, idx)=>{
      const s = base(ch.repeat(16));
      for(let i = 0; i < 6; i++){
        s.history.push(session(i, '2026-03-2' + i));
        s.eventHistory.push({ id: 't' + i, type: 'set:complete', elapsedMs: 4000 + idx });
      }
      return s;
    });
    const ingest = ingestParticipantFiles([
      pkg('6'.repeat(16), slow, '2026-04-01T10:00:00Z'),
      ...fasts.map((s, i)=> pkg(s.studyParticipantId, s, '2026-04-01T10:00:0' + i + 'Z')),
    ]);
    const roster = buildPilotRoster(ingest.participants, { nowISO: NOW, ingest });
    const byCode = Object.fromEntries(roster.roster.map(r => [r.code, r]));
    assert.equal(byCode['aaaaaaaa'].warnings.includes('logging-time-outlier'), false, JSON.stringify(byCode['aaaaaaaa'].warnings));
    assert.equal(byCode['66666666'].warnings.includes('logging-time-outlier'), true, JSON.stringify(byCode['66666666'].warnings));
  });

  it('flags unresolved workout starts in the roster', ()=>{
    const store = base('7'.repeat(16));
    store.history.push(session(0, '2026-03-25'));
    store.eventHistory.push({ id: 'e1', type: 'session:start', sessionId: 'ghost-1' });
    const entry = assessParticipant({ code: '77777777', store }, { nowISO: NOW });
    assert.equal(entry.unresolvedStarts, 1);
  });

  it('orders attention-first and keeps counts honest across a mixed roster', ()=>{
    const stale = base('8'.repeat(16));
    stale.history.push(session(0, '2026-02-02'));
    const fine = base('a'.repeat(16));
    fine.history.push(session(0, '2026-03-30'));
    const ingest = ingestParticipantFiles([
      pkg('a'.repeat(16), fine, '2026-04-01T10:00:00Z'),
      pkg('8'.repeat(16), stale, '2026-03-01T10:00:00Z'), // 33d
    ]);
    const roster = buildPilotRoster(ingest.participants, { nowISO: NOW, ingest });
    assert.equal(roster.counts.needsAttention, 1);
    assert.equal(roster.roster[0].needsAttention, true, 'attention-first ordering');
    assert.equal(roster.roster[0].code, '88888888');
  });
});
