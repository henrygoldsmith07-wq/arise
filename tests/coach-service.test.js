// coach-service.test.js — the user-facing coach workflow's lane order.
//
// The regression this pins: lane 4 (coach-cloud) used to call
// requestCoachInsight, which refuses before it looks at the key when the
// optional integrations are compiled out. Every shipped build compiled them
// out, so "explain my week" dead-ended while the app held a complete coaching
// state on device. Lane 4 must now answer locally.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCoachRequest, classifyCoachQuestion } from '../src/services/coachService.js';
import { makeDemoStore } from '../src/lib/demoData.js';
import { DEFAULT_BASE_URL } from '../src/lib/aiCoach.js';

class MemoryStorage {
  constructor(){ this.map = new Map(); }
  getItem(k){ return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v){ this.map.set(k, String(v)); }
  removeItem(k){ this.map.delete(k); }
  key(i){ return [...this.map.keys()][i] ?? null; }
  get length(){ return this.map.size; }
}

async function withStorage(fn){
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  globalThis.localStorage = local;
  globalThis.sessionStorage = session;
  try{ return await fn({ local, session }); }
  finally{ delete globalThis.localStorage; delete globalThis.sessionStorage; }
}

const store = makeDemoStore();

describe('coach service lane order', ()=>{
  it('answers a coach-cloud question on device with no endpoint configured', async ()=>{
    await withStorage(async ()=>{
      const r = await runCoachRequest({ question: 'explain my week', store });
      assert.equal(r.ok, true);
      assert.equal(r.source, 'local-coach');
      assert.equal(r.offline, true);
      assert.ok(r.text.length > 40);
    });
  });

  it('does not enable the AI feature merely because a question was asked', async ()=>{
    // runCoachRequest used to call saveAiSettings({enabled:true}) on every ask,
    // so typing anything flipped the preference.
    let stored = {};
    await withStorage(async ()=>{
      await runCoachRequest({ question: 'explain my week', store });
      stored = JSON.parse(globalThis.localStorage.getItem('arise.ai.settings.v1') || '{}');
    });
    assert.notEqual(stored.enabled, true, 'asking a question must not opt the user in');
  });

  it('keeps the issue-tracker lane for clear feedback', async ()=>{
    await withStorage(async ()=>{
      // Uses words that unambiguously match the feedback classifier (crash,
      // bug) without containing a question word near a training term.
      const r = await runCoachRequest({ question: 'the app crashes on startup, bug report', store });
      assert.equal(r.ok, true);
      assert.match(r.text, /open an issue/i);
    });
  });

  it('keeps the local-engine lane pointing at Train and Progress', async ()=>{
    await withStorage(async ()=>{
      const r = await runCoachRequest({ question: 'how much should I lift next session', store });
      assert.equal(r.ok, true);
      assert.match(r.text, /Train and Progress/);
    });
  });

  it('rejects an empty question before routing', async ()=>{
    await withStorage(async ()=>{
      const r = await runCoachRequest({ question: '  ', store });
      assert.equal(r.ok, false);
      assert.match(r.error, /Ask a question first/);
    });
  });

  it('does not contact a network for the default local endpoint', async ()=>{
    // The loopback default is not a "configured endpoint": it must not be
    // treated as consent to send training data anywhere.
    await withStorage(async ()=>{
      const r = await runCoachRequest({ question: 'explain my week', store, baseUrl: DEFAULT_BASE_URL });
      assert.equal(r.ok, true);
      assert.equal(r.source, 'local-coach');
    });
  });

  it('re-exports the intent classifier for callers that want it', ()=>{
    assert.equal(typeof classifyCoachQuestion, 'function');
  });
});
