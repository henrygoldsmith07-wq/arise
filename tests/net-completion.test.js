import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loggingFrictionStats } from '../src/lib/telemetry.js';

class MemoryStorage {
  constructor(){ this.map = new Map(); }
  getItem(k){ return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v){ this.map.set(k, String(v)); }
  removeItem(k){ this.map.delete(k); }
}
globalThis.localStorage = new MemoryStorage();
const { KEY: STORE_KEY } = await import('../src/lib/store.js');
const { recordEvent, getEventHistory } = await import('../src/lib/telemetry.js');
function setConsent(enabled, options = {}){
  globalThis.localStorage.setItem(STORE_KEY, JSON.stringify({
    version: 9, preferences: { telemetryEnabled: enabled, telemetryOptions: options },
  }));
}
beforeEach(()=> { globalThis.localStorage = new MemoryStorage(); });

const T0 = Date.parse('2026-03-01T10:00:00.000Z');
const at = (ms)=> new Date(T0 + ms).toISOString();
let seq = 0;
const ev = (type, patch = {})=> ({ id: `e${seq++}`, at: at(seq * 1000), ...patch, type });
const complete = (sessionId, ids, extra = {})=> ev('complete-set', { sessionId, mode: 'gym', ...ids, ...extra });
const undo = (sessionId, ids, extra = {})=> ev('undo-set', { sessionId, mode: 'gym', ...ids, ...extra });

describe('net completion counts work left completed, not actions', ()=>{
  it('complete once → 1 net set, 1 event', ()=>{
    const s = loggingFrictionStats([
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }),
    ]);
    assert.equal(s.completedSets, 1);
    assert.equal(s.completionEvents, 1);
    assert.equal(s.undos, 0);
  });

  it('complete → undo → complete → 1 net set, 2 events, 1 correction, 3 interactions', ()=>{
    const s = loggingFrictionStats([
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }),
      undo('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }),
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }),
    ]);
    assert.equal(s.completedSets, 1);
    assert.equal(s.completionEvents, 2);
    assert.equal(s.undos, 1);
    assert.equal(s.correctionsPerSession, 1);
    // All three interactions count, over ONE net set: the session reads
    // friction-heavy, exactly as a corrected session should.
    assert.equal(s.actionsPerCompletedSet, 3);
  });

  it('two different sets → 2 net sets', ()=>{
    const s = loggingFrictionStats([
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }),
      complete('s1', { setId: 'a2', exerciseId: 'e1', setIndex: 1 }),
    ]);
    assert.equal(s.completedSets, 2);
    assert.equal(s.completionEvents, 2);
  });

  it('stray undos with no matching completion change nothing', ()=>{
    const s = loggingFrictionStats([
      undo('s1', { setId: 'ghost', exerciseId: 'e1', setIndex: 9 }),
    ]);
    assert.equal(s.completedSets, 0);
    assert.equal(s.completionEvents, 0);
    assert.equal(s.undos, 1); // the correction attempt still counts as friction
    assert.equal(s.actionsPerCompletedSet, null); // no rate invented over zero work
  });
});

describe('failed/unfailed transitions never fabricate work', ()=>{
  it('failed → unfailed leaves net at zero without going negative', ()=>{
    const s = loggingFrictionStats([
      ev('set:failed', { sessionId: 's1', setId: 'a1', exerciseId: 'e1', setIndex: 0, mode: 'gym' }),
      ev('undo-set', { sessionId: 's1', setId: 'a1', exerciseId: 'e1', setIndex: 0, mode: 'gym' }),
    ]);
    assert.equal(s.completedSets, 0);
    assert.equal(s.completionEvents, 0);
    assert.equal(s.failedMarks, 1);
    assert.equal(s.undos, 1);
  });

  it('a set left failed is not left completed', ()=>{
    const s = loggingFrictionStats([
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }),
      ev('set:failed', { sessionId: 's1', setId: 'a1', exerciseId: 'e1', setIndex: 0, mode: 'gym' }),
    ]);
    assert.equal(s.completedSets, 0);
    assert.equal(s.completionEvents, 1);
  });

  it('unmarking failure never re-completes', ()=>{
    const s = loggingFrictionStats([
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }),
      ev('set:failed', { sessionId: 's1', setId: 'a1', exerciseId: 'e1', setIndex: 0, mode: 'gym' }),
      ev('undo-set', { sessionId: 's1', setId: 'a1', exerciseId: 'e1', setIndex: 0, mode: 'gym' }),
    ]);
    assert.equal(s.completedSets, 0);
    assert.equal(s.completionEvents, 1);
  });
});

describe('identity across swaps, duplicates and legacy gaps', ()=>{
  it('the same setId under a swapped exercise is one net set, not two', ()=>{
    const s = loggingFrictionStats([
      complete('s1', { setId: 'a1', exerciseId: 'bench-press', setIndex: 0 }),
      // Same physical set re-completed after its block was swapped to a new
      // exercise: stable identity must not fork on exerciseId.
      complete('s1', { setId: 'a1', exerciseId: 'dumbbell-press', setIndex: 0 }),
    ]);
    assert.equal(s.completedSets, 1);
    assert.equal(s.completionEvents, 2);
  });

  it('duplicate telemetry event ids count once', ()=>{
    const first = complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 });
    const dupe = { ...first };
    const s = loggingFrictionStats([first, dupe]);
    assert.equal(s.completedSets, 1);
    assert.equal(s.completionEvents, 1);
    assert.equal(s.actionsPerCompletedSet, 1);
  });

  it('legacy events fall back to session+exercise+setIndex identity', ()=>{
    const s = loggingFrictionStats([
      ev('set:complete', { sessionId: 's1', exerciseId: 'e1', setIndex: 0 }),
      ev('set:uncomplete', { sessionId: 's1', exerciseId: 'e1', setIndex: 0 }),
      ev('set:complete', { sessionId: 's1', exerciseId: 'e1', setIndex: 1 }),
    ]);
    assert.equal(s.completedSets, 1);
    assert.equal(s.completionEvents, 2);
    assert.equal(s.undos, 1);
  });

  it('events with no usable identity count as actions but never invent a net set', ()=>{
    const s = loggingFrictionStats([
      // sessionId only: no setId, no exercise/setIndex — unattributable.
      ev('set:complete', { sessionId: 's1' }),
    ]);
    assert.equal(s.completionEvents, 1);
    assert.equal(s.completedSets, 0);
    assert.equal(s.actionsPerCompletedSet, null);
  });
});

describe('denominators and mode segmentation use net completions', ()=>{
  it('actions/set divides by net work, corrections still counted', ()=>{
    const s = loggingFrictionStats([
      ev('load-field-commit', { sessionId: 's1', exerciseId: 'e1', setIndex: 0, mode: 'gym' }),
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }),
      undo('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }),
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }),
      complete('s1', { setId: 'a2', exerciseId: 'e1', setIndex: 1 }),
    ]);
    // 5 interactions (commit + 2 completes + undo + complete) over 2 net sets.
    assert.equal(s.completedSets, 2);
    assert.equal(s.completionEvents, 3);
    assert.equal(s.actionsPerCompletedSet, 2.5);
  });

  it('mode buckets net their own in-scope events honestly', ()=>{
    const s = loggingFrictionStats([
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0, mode: 'gym' }),
      complete('s1', { setId: 'a2', exerciseId: 'e1', setIndex: 1, mode: 'standard' }),
      undo('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0, mode: 'gym' }),
    ]);
    assert.equal(s.completedSets, 1); // overall: a1 undone, a2 stands
    assert.equal(s.completionEvents, 2);
    assert.equal(s.byMode.gym.completedSets, 0); // gym sees complete+undo of a1
    assert.equal(s.byMode.gym.completionEvents, 1);
    assert.equal(s.byMode.standard.completedSets, 1);
    assert.equal(s.byMode.standard.completionEvents, 1);
  });
});

describe('mode buckets attribute final work globally, actions locally', ()=>{
  it('Gym complete → Standard undo leaves no stale work in Gym', ()=>{
    const s = loggingFrictionStats([
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }, { mode: 'gym' }),
      undo('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }, { mode: 'standard' }),
    ]);
    assert.equal(s.completedSets, 0);
    assert.equal(s.completionEvents, 1);
    assert.equal(s.byMode.gym.completedSets, 0);
    assert.equal(s.byMode.gym.completionEvents, 1); // the action stays where it happened
    assert.equal(s.byMode.standard.completedSets, 0);
    assert.equal(s.byMode.standard.undos, 1); // ...and so does the correction
  });

  it('Gym complete → Standard undo → Standard re-complete attributes work to Standard', ()=>{
    const s = loggingFrictionStats([
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }, { mode: 'gym' }),
      undo('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }, { mode: 'standard' }),
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }, { mode: 'standard' }),
    ]);
    assert.equal(s.completedSets, 1);
    assert.equal(s.completionEvents, 2);
    assert.equal(s.byMode.gym.completedSets, 0);
    assert.equal(s.byMode.standard.completedSets, 1);
    assert.equal(s.actionsPerCompletedSet, 3); // gym complete + standard undo + standard complete, over 1 net set
  });

  it('Standard complete → Gym undo → Gym re-complete attributes work to Gym', ()=>{
    const s = loggingFrictionStats([
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }, { mode: 'standard' }),
      undo('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }, { mode: 'gym' }),
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }, { mode: 'gym' }),
    ]);
    assert.equal(s.completedSets, 1);
    assert.equal(s.byMode.standard.completedSets, 0);
    assert.equal(s.byMode.gym.completedSets, 1);
  });

  it('multiple sets across modes attribute independently', ()=>{
    const s = loggingFrictionStats([
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }, { mode: 'gym' }),
      complete('s1', { setId: 'a2', exerciseId: 'e1', setIndex: 1 }, { mode: 'standard' }),
      undo('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }, { mode: 'standard' }),
    ]);
    assert.equal(s.completedSets, 1);
    assert.equal(s.byMode.gym.completedSets, 0);
    assert.equal(s.byMode.standard.completedSets, 1);
  });

  it('undo after a swap nets against the same stable set', ()=>{
    const s = loggingFrictionStats([
      complete('s1', { setId: 'a1', exerciseId: 'bench-press', setIndex: 0 }, { mode: 'gym' }),
      // Same set undone after its block was swapped: new exercise, same id.
      undo('s1', { setId: 'a1', exerciseId: 'dumbbell-press', setIndex: 0 }, { mode: 'gym' }),
    ]);
    assert.equal(s.completedSets, 0);
    assert.equal(s.completionEvents, 1);
    assert.equal(s.undos, 1);
  });
});

describe('resumed sessions keep one continuous set history', ()=>{
  it('same sessionId later in time continues the same net state', ()=>{
    const s = loggingFrictionStats([
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }),
      // Resume: same session id, later timestamps.
      undo('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }),
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }),
    ]);
    assert.equal(s.completedSets, 1);
    assert.equal(s.completionEvents, 2);
  });

  it('the same setId in a different session is different work', ()=>{
    const s = loggingFrictionStats([
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }),
      complete('s2', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }),
    ]);
    assert.equal(s.completedSets, 2);
    assert.equal(s.sessions, 2);
  });
});

describe('mode session denominators require a real interaction', ()=>{
  it('sessions that never use Gym do not enter the Gym denominator', ()=>{
    const s = loggingFrictionStats([
      { type: 'session:start', sessionId: 's1', at: at(0) },
      complete('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }, { mode: 'standard' }),
      undo('s1', { setId: 'a1', exerciseId: 'e1', setIndex: 0 }, { mode: 'standard' }),
    ]);
    assert.equal(s.sessions, 1);
    assert.equal(s.byMode.standard.sessions, 1);
    assert.equal(s.byMode.gym.sessions, 0);
    assert.equal(s.byMode.guided.sessions, 0);
    assert.equal(s.byMode.standard.correctionsPerSession, 1);
    assert.equal(s.byMode.gym.correctionsPerSession, null);
  });

  it('a bare session:start puts the session in no mode bucket', ()=>{
    const s = loggingFrictionStats([{ type: 'session:start', sessionId: 's1', at: at(0) }]);
    assert.equal(s.sessions, 1);
    assert.equal(s.byMode.gym.sessions, 0);
    assert.equal(s.byMode.standard.sessions, 0);
    assert.equal(s.byMode.guided.sessions, 0);
  });
});

describe('setId survives the write path (call-site wiring guard)', ()=>{
  it('recordEvent persists stable set identity alongside the other ids', ()=>{
    setConsent(true, { sessionTimings: true });
    recordEvent('complete-set', { sessionId: 's1', exerciseId: 'e1', setIndex: 0, setId: 'set-abc', mode: 'gym', elapsedMs: 1200 });
    recordEvent('undo-set', { sessionId: 's1', exerciseId: 'e1', setIndex: 0, setId: 'set-abc', mode: 'gym' });
    const events = getEventHistory();
    assert.equal(events[0].setId, 'set-abc');
    assert.equal(events[1].setId, 'set-abc');
    const s = loggingFrictionStats(events);
    assert.equal(s.completedSets, 0);
    assert.equal(s.completionEvents, 1);
    assert.equal(s.undos, 1);
  });
});
