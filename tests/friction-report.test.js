import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  summariseSession, summariseParticipant, summariseCohort,
  compareWithSynthetic, FRICTION_COHORT_GATES,
} from '../src/lib/frictionReport.js';
import { syntheticModeExpectation, loadBaselines } from '../benchmark/friction-baselines.js';

let seq = 0;
let clock = 0;
const iso = ()=> new Date(Date.parse('2026-03-01T10:00:00Z') + (clock++) * 1000).toISOString();
const ev = (type, patch = {})=> ({ id: `f${seq++}`, ...patch, type });

// One scripted session: enter mode, log `sets` completions (each 60s apart
// after a 5s entry gap unless told otherwise), optionally undo, save.
function sessionFlow(sessionId, { mode = 'standard', sets = 2, undos = 0, timed = true, complete = true, abandon = false, swaps = 0, applyAll = false } = {}){
  const evs=[ev('session:start', { sessionId, at: iso() })];
  evs.push(ev('mode:enter', { sessionId, mode, at: iso() }));
  for(let i = 0; i < sets; i++){
    // Entry gap, then the completion 60s in.
    for(let k = 0; k < 55; k++) iso();
    evs.push(ev('complete-set', {
      sessionId, mode, setIndex: i, setId: `${sessionId}-s${i}`,
      ...(timed ? { elapsedMs: 4000 } : {}), at: iso(),
    }));
    if(i < undos){
      evs.push(ev('undo-set', { sessionId, mode, setIndex: i, setId: `${sessionId}-s${i}`, at: iso() }));
    }
  }
  for(let i = 0; i < swaps; i++){
    evs.push(ev('swap-open', { sessionId, exerciseId: 'e1', mode, at: iso() }));
    evs.push(ev('swap-commit', { sessionId, from: 'e1', to: 'e2', mode, ...(timed ? { elapsedMs: 9000 } : {}), at: iso() }));
  }
  if(applyAll) evs.push(ev('apply-all', { sessionId, exerciseId: 'e2', mode, at: iso() }));
  if(complete) evs.push(ev('session:complete', { sessionId, at: iso() }));
  if(abandon) evs.push(ev('session:abandon', { sessionId, at: iso() }));
  return { sessionId, events: evs };
}

const participant = (code, sessions)=> ({ code, sessions });
const LOOSE_GATES = { minParticipants: 2, minSessions: 2, minSessionsPerParticipant: 1, minModeNetSets: 2 };
const EXPECTED = { expectedCheapestMode: 'guided', basis: 'test synthetic expectation' };

describe('session summaries stay aggregate-only', ()=>{
  it('flags completion, abandonment and timing presence without raw events', ()=>{
    const s = summariseSession('s1', sessionFlow('s1', { sets: 2 }).events);
    assert.equal(s.completed, true);
    assert.equal(s.abandoned, false);
    assert.equal(s.timingObserved, true);
    assert.equal(s.netSets, 2);
    assert.ok(!('events' in s), 'no raw event stream leaves the session summary');
    const abandoned = summariseSession('s2', sessionFlow('s2', { sets: 1, complete: false, abandon: true }).events);
    assert.equal(abandoned.completed, false);
    assert.equal(abandoned.abandoned, true);
  });

  it('untimed sessions report missing timing data, counts intact', ()=>{
    const s = summariseSession('s1', sessionFlow('s1', { sets: 2, timed: false }).events);
    assert.equal(s.timingObserved, false);
    assert.equal(s.netSets, 2);
    assert.equal(s.stats.loggingMsMedian, null);
  });
});

describe('participant-balanced aggregation beats naive pooling', ()=>{
  it('a six-switch user gets one vote, not six', ()=>{
    // Heavy user: 6 gym intervals, all 60s first-sets. Light user: 1 at 10s.
    // (Interval gaps are scripted by sessionFlow; build explicit intervals.)
    const heavySessions = [];
    for(let i = 0; i < 6; i++){
      const sid = `heavy-${i}`;
      heavySessions.push({ sessionId: sid, events: [
        ev('session:start', { sessionId: sid, at: iso() }),
        ev('mode:enter', { sessionId: sid, mode: 'gym', at: iso() }),
        ev('complete-set', { sessionId: sid, mode: 'gym', setIndex: 0, setId: `${sid}-s0`, elapsedMs: 4000, at: iso() }),
        ev('session:complete', { sessionId: sid, at: iso() }),
      ]});
    }
    // Force the interval lengths: rewrite ats deterministically.
    const base = Date.parse('2026-03-01T10:00:00Z');
    heavySessions.forEach((s, i)=> {
      s.events[1].at = new Date(base + i * 3600000).toISOString();
      s.events[2].at = new Date(base + i * 3600000 + 60000).toISOString();
    });
    const lightSid = 'light-0';
    const light = [{ sessionId: lightSid, events: [
      ev('session:start', { sessionId: lightSid, at: iso() }),
      ev('mode:enter', { sessionId: lightSid, mode: 'gym', at: iso() }),
      ev('complete-set', { sessionId: lightSid, mode: 'gym', setIndex: 0, setId: `${lightSid}-s0`, elapsedMs: 4000, at: iso() }),
    ]}];
    // Fix the light interval to exactly 10s after its own entry.
    light[0].events[1].at = new Date(base + 99 * 3600000).toISOString();
    light[0].events[2].at = new Date(base + 99 * 3600000 + 10000).toISOString();
    const cohort = summariseCohort(
      [participant('heavy', heavySessions), participant('light', light)],
      { gates: LOOSE_GATES },
    );
    assert.equal(cohort.status, 'sufficient');
    const gym = cohort.modes.gym;
    // Raw pooled view: six 60s intervals + one 10s → median 60s.
    assert.equal(gym.firstSetMs.rawMedianMs, 60000);
    // Balanced view: one vote each → median(60s, 10s) = 35s.
    assert.equal(gym.firstSetMs.balancedMedianMs, 35000);
    assert.equal(gym.firstSetMs.participants, 2);
  });

  it('repeated sessions from one person aggregate under that person', ()=>{
    const sessions = [];
    for(let i = 0; i < 5; i++) sessions.push(sessionFlow(`u1-s${i}`, { sets: 2 }));
    const p = summariseParticipant('u1', sessions);
    assert.equal(p.sessionCount, 5);
    assert.equal(p.totals.netSets, 10);
    assert.equal(p.totals.interactions, 10);
    assert.equal(p.actionsPerNetSet, 1);
  });
});

describe('sample-quality gates refuse thin cohorts', ()=>{
  const twoSessions = (code)=> participant(code, [sessionFlow(`${code}-a`, { sets: 3 }), sessionFlow(`${code}-b`, { sets: 3 })]);
  it('a lone participant is insufficient, never ranked', ()=>{
    const r = summariseCohort([twoSessions('solo')], { gates: FRICTION_COHORT_GATES });
    assert.equal(r.status, 'insufficient');
    assert.ok(r.reasons.some(x=> x.includes('participant')));
    assert.equal(r.modes, undefined);
    assert.match(r.note, /Insufficient real-user evidence/);
    assert.ok(!('comparison' in r));
  });

  it('too few sessions, thin attendance and thin modes each fail openly', ()=>{
    const fewSessions = summariseCohort(
      [twoSessions('a'), twoSessions('b')],
      { gates: { ...FRICTION_COHORT_GATES, minSessions: 50 } },
    );
    assert.equal(fewSessions.status, 'insufficient');
    assert.ok(fewSessions.reasons.some(x=> x.includes('sessions')));
    const thinAttendance = summariseCohort(
      ['a', 'b', 'c', 'd', 'e'].map(c=> participant(c, [sessionFlow(`${c}-only`, { sets: 3 })])),
      { gates: FRICTION_COHORT_GATES },
    );
    assert.equal(thinAttendance.status, 'insufficient');
    assert.ok(thinAttendance.reasons.some(x=> x.includes('sessions per participant')));
  });

  it('a mode below its observation gate is flagged, not ranked', ()=>{
    const ps = ['a', 'b'].map(c=> participant(c, [
      sessionFlow(`${c}-gym`, { mode: 'gym', sets: 1 }),
      sessionFlow(`${c}-std`, { mode: 'standard', sets: 6 }),
    ]));
    const r = summariseCohort(ps, { gates: { ...LOOSE_GATES, minModeNetSets: 10 }, synthetic: EXPECTED });
    assert.equal(r.status, 'sufficient');
    assert.equal(r.modes.gym.belowGate, true);
    assert.equal(r.modes.standard.belowGate, false);
    // The comparison only ranks gated modes.
    assert.ok(!(r.comparison.observedOrder || []).includes('gym'));
  });

  it('single-user domination cannot satisfy the breadth gate', ()=>{
    const heavy = participant('heavy', Array.from({ length: 10 }, (_, i)=> sessionFlow(`h-${i}`, { sets: 2 })));
    const lights = ['a', 'b', 'c', 'd', 'e'].map(c=> participant(c, [sessionFlow(`${c}-1`, { sets: 2 })]));
    const r = summariseCohort([heavy, ...lights], { gates: FRICTION_COHORT_GATES });
    assert.equal(r.status, 'insufficient', 'median 1 session/participant fails the attendance gate');
    assert.ok(r.reasons.some(x=> x.includes('sessions per participant')));
    // ...but the honest counts are still reported, not hidden.
    assert.equal(r.participants, 6);
    assert.equal(r.sessions, 15);
  });
});

describe('missing timing consent is reported, never reconstructed', ()=>{
  it('untimed cohort: null timings, intact counts, explicit missing rate', ()=>{
    const ps = ['a', 'b'].map(c=> participant(c, [sessionFlow(`${c}-1`, { sets: 2, timed: false }), sessionFlow(`${c}-2`, { sets: 2, timed: false })]));
    const r = summariseCohort(ps, { gates: LOOSE_GATES });
    assert.equal(r.status, 'sufficient');
    assert.equal(r.missingTimingRate, 1);
    assert.equal(r.modes.standard.firstSetMs.balancedMedianMs, null);
    assert.equal(r.modes.standard.firstSetMs.rawMedianMs, null);
    assert.equal(r.modes.standard.netSets, 8);
    assert.equal(r.modes.standard.actionsPerNetSet.median, 1);
  });
});

describe('mode switching attributes intervals per mode', ()=>{
  it('one session across two modes splits its intervals honestly', ()=>{
    const sid = 'mixed-1';
    const t0 = Date.parse('2026-04-01T10:00:00Z');
    const at2 = (s)=> new Date(t0 + s * 1000).toISOString();
    const mixerEvents = [
      ev('session:start', { sessionId: sid, at: at2(0) }),
      ev('mode:enter', { sessionId: sid, mode: 'standard', at: at2(5) }),
      ev('complete-set', { sessionId: sid, mode: 'standard', setIndex: 0, setId: `${sid}-a`, elapsedMs: 4000, at: at2(65) }),
      ev('mode:enter', { sessionId: sid, mode: 'gym', at: at2(600) }),
      ev('complete-set', { sessionId: sid, mode: 'gym', setIndex: 0, setId: `${sid}-b`, elapsedMs: 4000, at: at2(615) }),
      ev('session:complete', { sessionId: sid, at: at2(700) }),
    ];
    const p = summariseParticipant('mixer', [{ sessionId: sid, events: mixerEvents }]);
    assert.deepEqual(p.sessions[0].modes, ['gym', 'standard']);
    assert.equal(p.modes.standard.intervalsMs.length, 1);
    assert.equal(p.modes.gym.intervalsMs.length, 1);
    const r = summariseCohort(
      [participant('mixer', [{ sessionId: sid, events: mixerEvents }]), participant('other', [sessionFlow('other-s', { sets: 2 })])],
      { gates: LOOSE_GATES, synthetic: EXPECTED },
    );
    assert.equal(r.status, 'sufficient');
    assert.equal(r.modes.standard.netSets >= 1, true);
    assert.equal(r.modes.gym.netSets >= 1, true);
  });
});

describe('synthetic comparison stays descriptive', ()=>{
  const guidedCheap = (code)=> participant(code, [
    // Guided: 1 action/set. Standard: 2 actions/set (extra undo).
    sessionFlow(`${code}-g`, { mode: 'guided', sets: 2 }),
    sessionFlow(`${code}-s`, { mode: 'standard', sets: 2, undos: 1 }),
  ]);
  it('matching direction confirms descriptively with n reported', ()=>{
    const r = summariseCohort(['a', 'b'].map(guidedCheap), { gates: LOOSE_GATES, synthetic: EXPECTED });
    assert.equal(r.status, 'sufficient');
    assert.equal(r.comparison.verdict, 'direction-confirmed');
    assert.deepEqual(r.comparison.observedOrder[0], 'guided');
    assert.match(r.comparison.note, /descriptive only/i);
    assert.ok(!/\bproves?\b|\bcauses?\b|\bwill improve\b/i.test(r.comparison.note), 'no causal language');
  });

  it('reversed direction contradicts descriptively', ()=>{
    const standardCheap = (code)=> participant(code, [
      sessionFlow(`${code}-g`, { mode: 'guided', sets: 2, undos: 2 }),
      sessionFlow(`${code}-s`, { mode: 'standard', sets: 2 }),
    ]);
    const r = summariseCohort(['a', 'b'].map(standardCheap), { gates: LOOSE_GATES, synthetic: EXPECTED });
    assert.equal(r.comparison.verdict, 'direction-contradicted');
  });

  it('synthetic expectation derives from the validated doc, guided cheapest', ()=>{
    const expectation = syntheticModeExpectation(loadBaselines());
    assert.equal(expectation.expectedCheapestMode, 'guided');
    assert.ok(expectation.ranked.includes('standard') && expectation.ranked.includes('gym'));
    assert.match(expectation.basis, /friction-baseline/);
  });
});

describe('reports expose aggregates only — never histories or values', ()=>{
  it('no event streams, histories or workout values anywhere in the output', ()=>{
    const ps = ['a', 'b'].map(c=> participant(c, [sessionFlow(`${c}-1`, { sets: 2, applyAll: true }), sessionFlow(`${c}-2`, { sets: 1, swaps: 1 })]));
    const r = summariseCohort(ps, { gates: LOOSE_GATES, synthetic: EXPECTED });
    const seen = new Set();
    const walk = (v)=>{
      if(Array.isArray(v)){ v.forEach(walk); return; }
      if(v && typeof v === 'object'){
        for(const k of Object.keys(v)){
          seen.add(k);
          assert.ok(!['events', 'history', 'load', 'reps', 'weightKg', 'rir', 'target', 'sets'].includes(k), `forbidden key in report: ${k}`);
          walk(v[k]);
        }
        return;
      }
      assert.ok(v == null || ['string', 'number', 'boolean'].includes(typeof v), `non-scalar leaf in report: ${typeof v}`);
    };
    walk(r);
    assert.ok(!seen.has('events') && !seen.has('history'));
  });
});
