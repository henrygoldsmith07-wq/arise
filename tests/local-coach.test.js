// local-coach.test.js — the on-device coach.
//
// The contract under test is the one the remote prompt was always written to
// enforce: the coach may restate the engines' findings with their evidence, and
// must never invent a prescription, load, set or programme change. It must also
// answer rather than dead-end, because the shipped build compiles the remote
// coach out and a question deserves an answer.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { localCoachAnswer, classifyCoachQuestion } from '../src/lib/coach/localCoach.js';
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
      ['I missed my session yesterday', 'missed'],
      ['am I improving?', 'progress'],
      ['why this programme?', 'programme'],
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
