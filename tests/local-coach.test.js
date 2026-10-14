// local-coach.test.js — the on-device coach.
//
// The contract under test is the one the remote prompt was always written to
// enforce: the coach may restate the engines' findings with their evidence, and
// must never invent a prescription, load, set or programme change. It must also
// answer rather than dead-end, because the shipped build compiles the remote
// coach out and a question deserves an answer.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { localCoachAnswer, classifyCoachQuestion, resolveFollowUp, suggestedCoachQuestions } from '../src/lib/coach/localCoach.js';
import { localDateISO } from '../src/lib/dateOnly.js';
import { makeDemoStore } from '../src/lib/demoData.js';

const store = makeDemoStore();

describe('coach intent classification', ()=>{
  it('routes each question kind to its intent', ()=>{
    const cases = [
      ['explain my week', 'week-review'],
      ['summarise my training', 'week-review'],
      ['what should I do today?', 'today'],
      ['why did my bench press stall?', 'exercise'],
      ['my squat is stuck', 'exercise'],
      ['am I stuck in a plateau?', 'plateau'],
      ['I feel tired, do I need a deload?', 'deload'],
      ['am I overdoing it?', 'deload'],
      ['I\u2019m worn down, should I back off?', 'deload'],
      ['I am completely burnt out', 'deload'],
      ['am I overtraining?', 'deload'],
      ['I missed my session yesterday', 'missed'],
      ['am I improving?', 'progress'],
      ['why this programme?', 'programme'],
      ['how do I progress my push ups?', 'progression'],
      ['what weight should I add to glute bridge?', 'progression'],
      ['should I go up a kg on rows?', 'progression'],
      ['make my squats harder', 'progression'],
      ['what is the capital of France', 'general'],
    ];
    for(const [q, expected] of cases){
      assert.equal(classifyCoachQuestion(q).id, expected, `"${q}" should classify as ${expected}`);
    }
  });

  it('treats an empty question as empty', ()=>{
    assert.equal(classifyCoachQuestion('').id, 'empty');
    assert.equal(classifyCoachQuestion(null).id, 'empty');
  });

  it('prefers the most specific intent when a question matches several', ()=>{
    // "why did my bench press stall" is both an exercise question and a plateau
    // question; the exercise one is more specific and wins.
    const r = classifyCoachQuestion('why did my bench press stall?');
    assert.equal(r.id, 'exercise');
    assert.ok(r.matches.includes('plateau'), 'both intents should be recorded');
  });
});

describe('localCoachAnswer', ()=>{
  it('answers the week-review question the shipped build used to dead-end on', ()=>{
    const r = localCoachAnswer('explain my week', { store });
    assert.equal(r.ok, true);
    assert.equal(r.source, 'local-coach');
    assert.ok(r.text.length > 40, 'an answer should say something substantive');
    assert.ok(r.text.length < 1200, 'an answer should not be a wall of text');
  });

  it('points at the engine without inventing a prescription for an unknown lift', ()=>{
    const r = localCoachAnswer('why did my bench press stall?', { store });
    assert.equal(r.ok, true);
    // The demo store is a hinge/pull programme; bench press is not in it, so the
    // coach must say so and name what the engine IS deciding, not a load.
    assert.match(r.text, /bench press/);
    assert.ok(!/\d+\s*(kg|lb).*bench/i.test(r.text), 'must not invent a load for the asked-about lift');
  });

  it('refuses honestly when the engines have nothing to say', ()=>{
    const empty = { history: [], activeSchedule: null, readinessLog: [] };
    const r = localCoachAnswer('why this programme?', { store: empty });
    assert.equal(r.ok, false);
    assert.match(r.error, /Not enough logged yet|nothing to say/i);
  });

  it('rejects an empty question before touching the engines', ()=>{
    const r = localCoachAnswer('   ', { store });
    assert.equal(r.ok, false);
    assert.match(r.error, /Ask a question first/);
  });

  it('is deterministic for the same store and question', ()=>{
    const a = localCoachAnswer('explain my week', { store });
    const b = localCoachAnswer('explain my week', { store: makeDemoStore() });
    assert.equal(a.text, b.text);
  });

  it('never returns a prescription-shaped directive', ()=>{
    // Fails if the coach ever starts emitting "add X kg to Y" — the exact
    // behaviour the architecture forbids.
    const forbidden = [
      /increase (?:your )?(?:load|weight) .* to \d+/i,
      /you should (?:add|do) \d+\s*(?:kg|lb|sets?)/i,
      /next (?:session|workout) (?:do|use) \d+ × \d+ @ \d+/i,
    ];
    for(const q of ['explain my week', 'what should I do today?', 'am I improving?', 'I feel tired, do I need a deload?', 'why did my squat stall?']){
      const r = localCoachAnswer(q, { store });
      if(!r.ok) continue;
      for(const re of forbidden){
        assert.doesNotMatch(r.text, re, `coach must not prescribe: "${q}" produced "${r.text}"`);
      }
    }
  });

  it('carries the engine confidence through so the UI can show it', ()=>{
    const r = localCoachAnswer('explain my week', { store });
    assert.equal(r.ok, true);
    assert.ok(r.confidence === null || typeof r.confidence === 'string');
  });

  it('survives a broken coaching state instead of throwing', ()=>{
    // buildCoachingState is called on user data; a malformed store must produce
    // a soft failure, not an exception in the coach UI.
    const r = localCoachAnswer('explain my week', { store: { history: 'not-an-array', activeSchedule: 7 } });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
  });
});

// "Am I overdoing it?" reads the user's own readiness check-ins through the
// safety layer. Two regressions this pins:
//   * answerDeload used to read a nonexistent `state.safety.items` field,
//     so readiness-driven warnings were NEVER quoted by the coach;
//   * the underlying deficit gate used to compare 0–100 check-in scores
//     against a raw-scale threshold of 4, so the warning never fired at all.
describe('coach overdoing-it answers from readiness check-ins', ()=>{
  const isoDaysAgo = (n)=> localDateISO(new Date(Date.now() - n * 86_400_000));

  it('quotes the engine\'s recovery-deficit finding when check-ins read low', ()=>{
    const lowReadinessStore = {
      ...store,
      readinessLog: [
        { dateISO: isoDaysAgo(6), score: 64 },
        { dateISO: isoDaysAgo(5), score: 64 },
        // three genuinely rough mornings on the 0–100 scale the checker writes
        { dateISO: isoDaysAgo(3), score: 28 },
        { dateISO: isoDaysAgo(2), score: 31 },
        { dateISO: isoDaysAgo(1), score: 25 },
      ].sort((a, b)=> a.dateISO.localeCompare(b.dateISO)),
    };
    const r = localCoachAnswer('Am I overdoing it?', { store: lowReadinessStore });
    assert.equal(r.ok, true);
    assert.match(r.text, /Recovery running a deficit/, 'the engine\'s own readiness-driven warning must be quoted');
    assert.match(r.text, /Latest check-in/, 'the latest check-in is named with its band');
    assert.equal(r.source, 'local-coach');
  });

  it('stays honest on a healthy readiness log without inventing a deload', ()=>{
    const healthyStore = {
      ...store,
      readinessLog: [
        { dateISO: isoDaysAgo(2), score: 82 },
        { dateISO: isoDaysAgo(1), score: 88 },
        { dateISO: isoDaysAgo(0), score: 90 },
      ],
    };
    const r = localCoachAnswer('Am I overdoing it?', { store: healthyStore });
    assert.equal(r.ok, true);
    assert.doesNotMatch(r.text, /Recovery running a deficit/);
    assert.match(r.text, /Latest check-in/);
    // no-signal path: nothing on the plan asks for a deload, and it says so
    assert.match(r.text, /deload|flat/i);
  });

  it('says where the signal would come from when nothing has been logged', ()=>{
    const empty = { history: [], activeSchedule: null, readinessLog: [] };
    const r = localCoachAnswer('am I overdoing it?', { store: empty });
    assert.equal(r.ok, true);
    assert.match(r.text, /no readiness check-ins/i, 'an absent signal must be named, not papered over');
    assert.match(r.text, /check-in/i);
  });
});

// Added in the bodyweight/progression coach pass: "how do I progress X" routes
// to the engine's prescriptions quoted verbatim — never a generic pep talk.
describe('coach progression intent answers with engine prescriptions', ()=>{
  it('answers a progression question with the engine\'s actual prescription and reason', ()=>{
    const r = localCoachAnswer('how do I progress my push ups?', { store });
    assert.equal(r.ok, true);
    // The demo programme includes push-up prescriptions from the engine — the
    // answer must quote engine content (an action with lifts × reps), not
    // invent one.
    assert.match(r.text, /(Why:|×|\d) /, 'answer carries engine content');
    assert.equal(r.source, 'local-coach');
  });

  it('falls back honestly when no plan exists', ()=>{
    const empty = { history: [], activeSchedule: null, readinessLog: [] };
    const r = localCoachAnswer('how do I progress my push ups?', { store: empty });
    // Either the honest "plan holds the decisions" pointer (no recommendations)
    // or the not-enough-data refusal.
    if(r.ok){
      assert.match(r.text, /plan|Progress|Today/i);
    }else{
      assert.match(r.error, /enough logged|not enough/i);
    }
  });
});

// Follow-up memory: "and for rows?" after a progression question must resolve
// against the lift universe the engine already knows, without a full re-type.
// The memory is pure and caller-owned: localCoachAnswer returns what the NEXT
// turn may use, and no storage happens inside the coach.
describe('coach follow-up memory', ()=>{
  const KNOWN = ['push-up', 'dumbbell-row', 'goblet-squat', 'bench-press-dumbbell'];

  it('resolveFollowUp rewrites a named follow-up grounded in a known lift', ()=>{
    const r = resolveFollowUp('and for rows?', { last: { intent: 'progression', question: 'how do I progress my push ups?', actions: ['push-up — 3×8'] }, knownLifts: KNOWN });
    assert.equal(r.followUp, true);
    assert.equal(r.rewritten, 'how do I progress my rows');
    assert.equal(classifyCoachQuestion(r.rewritten).id, 'progression');
  });

  it('resolveFollowUp never rewrites a capture that matches no known lift', ()=>{
    const r = resolveFollowUp('and also I felt tired', { last: { intent: 'progression', question: 'how do I progress my push ups?', actions: [] }, knownLifts: KNOWN });
    assert.equal(r.followUp, false, 'an unmatched capture must not become an exercise question');
  });

  it('resolveFollowUp never overrides a question that stands on its own', ()=>{
    const r = resolveFollowUp('am I improving?', { last: { intent: 'progression', question: 'how do I progress my push ups?', actions: [] }, knownLifts: KNOWN });
    assert.equal(r.followUp, false);
  });

  it('answers "and for rows?" with the ROWS prescription, not the quoted lift', ()=>{
    const first = localCoachAnswer('how do I progress my push ups?', { store });
    assert.equal(first.ok, true);
    const second = localCoachAnswer('and for rows?', { store, last: first.remember });
    assert.equal(second.ok, true);
    assert.match(second.text, /row/i, 'the follow-up must be about rows');
    assert.doesNotMatch(second.text, /push up/i, 'the quoted lift must not leak into the follow-up answer');
    assert.equal(second.followUp?.exercise, 'rows');
    // The remembered antecedent is whichever row prescription the engine
    // actually quoted — assert the shape, not the demo lineup, which may
    // legitimately change.
    assert.match(second.remember?.exerciseId || '', /(^|\-)row$/);
  });

  it('a bare "and?" after a progression turn lists the remaining named engine decisions', ()=>{
    const first = localCoachAnswer('how do I progress my push ups?', { store });
    assert.equal(first.ok, true);
    const second = localCoachAnswer('and?', { store, last: first.remember });
    assert.equal(second.ok, true);
    assert.equal(second.followUp?.more, true);
    assert.ok(second.text.length > 20);
    for(const action of first.remember.actions){
      assert.ok(!second.text.includes(action), 'already-quoted decisions must not repeat');
    }
  });

  it('the memory object is plain serialisable data and never invents a prescription', ()=>{
    const first = localCoachAnswer('how do I progress my push ups?', { store });
    assert.equal(first.ok, true);
    assert.equal(typeof first.remember.intent, 'string');
    assert.ok(Array.isArray(first.remember.actions));
    assert.deepEqual(JSON.parse(JSON.stringify(first.remember)), first.remember);
    // reuse the no-fabrication contract on the follow-up answer
    const second = localCoachAnswer('and for rows?', { store, last: first.remember });
    const forbidden = [
      /increase (?:your )?(?:load|weight) .* to \d+/i,
      /you should (?:add|do) \d+\s*(?:kg|lb|sets?)/i,
    ];
    for(const re of forbidden){
      assert.doesNotMatch(second.text, re, 'follow-up answers stay under the no-fabrication contract');
    }
  });
});

describe('suggestedCoachQuestions', ()=>{
  it('always offers the two evergreen questions and never invents a demo lift', ()=>{
    const s = suggestedCoachQuestions({});
    assert.ok(s.some(q => q.id === 'week-review' && q.text === 'Explain my week'));
    assert.ok(s.some(q => q.id === 'progress' && q.text === 'Am I improving?'));
    assert.equal(s.some(q => q.id === 'missed'), false, 'no missed chip on a healthy schedule');
  });

  it('offers the missed chip only when sessions are genuinely overdue, and it answers', ()=>{
    const yesterdayISO = localDateISO(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const schedule = { sessions: [{ id: 's1', title: 'Push', dateISO: yesterdayISO, status: null, week: 1, day: 1, programId: 'generic-full-body', blocks: [{ exerciseId: 'push-up', sets: 3, reps: '8-12' }] }] };
    const s = suggestedCoachQuestions({ schedule });
    const chip = s.find(q => q.id === 'missed');
    assert.ok(chip, 'an overdue session must surface the missed chip');
    const r = localCoachAnswer(chip.text, { store: { ...store, activeSchedule: schedule } });
    assert.equal(r.ok, true);
    assert.ok(/overdue/.test(r.text));
  });

  it('a done or future schedule row never produces the missed chip', ()=>{
    const future = localDateISO(new Date(Date.now() + 24 * 60 * 60 * 1000));
    for(const sess of [
      { id: 's1', title: 'Push', dateISO: future, status: null },
      { id: 's1', title: 'Push', dateISO: future, status: 'done' },
    ]){
      const s = suggestedCoachQuestions({ schedule: { sessions: [sess] } });
      assert.equal(s.some(q => q.id === 'missed'), false);
    }
  });

  it('personalises the progression chip with the most-logged lift', ()=>{
    const s = suggestedCoachQuestions({ history: store.history || [] });
    const counts = new Map();
    for(const h of store.history || []) for(const b of h.blocks || []) counts.set(b.exerciseId, (counts.get(b.exerciseId) || 0) + 1);
    const top = [...counts.entries()].sort((a, b)=> b[1] - a[1])[0];
    if(top){
      const chip = s.find(q => q.id === 'progression');
      assert.ok(chip, 'a top lift must produce a progression chip');
      assert.ok(chip.text.includes(top[0].replace(/-/g, ' ')), `chip should name the top lift ${top[0]}`);
      // and the question must actually classify to its intent, not just look plausible
      assert.equal(classifyCoachQuestion(chip.text).id, 'progression');
    }
  });

  it('adds the programme chip only when first-plan provenance exists', ()=>{
    assert.equal(suggestedCoachQuestions({}).some(q => q.id === 'programme'), false);
    assert.equal(suggestedCoachQuestions({ programmeWhy: { reasons: ['fits your kit'] } }).some(q => q.id === 'programme'), true);
  });

  it('offers the recovery chip only when recent check-ins actually read low', ()=>{
    const iso = (n)=> localDateISO(new Date(Date.now() - n * 86_400_000));
    // No check-ins, or healthy ones: no chip — the answer would be an honest
    // "nothing to see", and a chip that dead-ends is friction.
    assert.equal(suggestedCoachQuestions({ readinessLog: [] }).some(q => q.id === 'recovery'), false);
    assert.equal(suggestedCoachQuestions({ readinessLog: [{ dateISO: iso(1), score: 85 }] }).some(q => q.id === 'recovery'), false);
    assert.equal(suggestedCoachQuestions({ readinessLog: [
      { dateISO: iso(3), score: 85 }, { dateISO: iso(2), score: 84 },
    ] }).some(q => q.id === 'recovery'), false, 'healthy readings never suggest the recovery question');
    // Three rough mornings on the real 0–100 scale: chip appears, routes to
    // the deload answerer, and answers from the data.
    const s = suggestedCoachQuestions({ readinessLog: [
      { dateISO: iso(3), score: 30 }, { dateISO: iso(2), score: 32 }, { dateISO: iso(1), score: 28 },
    ] });
    const chip = s.find(q => q.id === 'recovery');
    assert.ok(chip, 'sustained low check-ins must surface the recovery question');
    assert.equal(chip.text, 'Am I overdoing it?');
    assert.equal(classifyCoachQuestion(chip.text).id, 'deload');
  });

  it('every suggestion classifies to the intent it claims (no dead-end chips)', ()=>{
    const s = suggestedCoachQuestions({ history: store.history || [], programmeWhy: { reasons: ['x'] } });
    for(const chip of s){
      assert.notEqual(classifyCoachQuestion(chip.text).id, 'general', `chip "${chip.text}" must route to a real intent`);
    }
  });

  it('answers each chip with a substantive on-device finding, offline', ()=>{
    const s = suggestedCoachQuestions({ history: store.history || [] });
    assert.ok(s.length >= 2, 'at least the evergreen chips exist');
    for(const chip of s){
      const r = localCoachAnswer(chip.text, { store });
      assert.equal(r.ok, true, `chip "${chip.text}" must answer from the demo store`);
      assert.ok(r.text.length > 40);
    }
  });

  it('survives malformed history without throwing', ()=>{
    const s = suggestedCoachQuestions({ history: 'not-an-array' });
    assert.ok(Array.isArray(s) && s.length >= 2, 'the evergreen chips always exist');
  });
});
