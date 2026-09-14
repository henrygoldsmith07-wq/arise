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
const at = (s)=> new Date(T0 + s * 1000).toISOString();
let seq = 0;
const ev = (type, patch = {})=> ({ id: `t${seq++}`, ...patch, type });
const start = (sid = 's1', t = 0)=> ev('session:start', { sessionId: sid, at: at(t) });
const enter = (sid, mode, t)=> ev('mode:enter', { sessionId: sid, mode, at: at(t) });
const complete = (sid, mode, t, setId = 'a1', elapsed = 5000)=> ev('complete-set', { sessionId: sid, mode, setIndex: 0, setId, elapsedMs: elapsed, at: at(t) });
const firstOf = (s)=> s.startToFirstSetMs;

describe('per-mode first-set timing anchors on mode entry', ()=>{
  it('session starting directly in Standard measures from its entry', ()=>{
    const s = loggingFrictionStats([
      start('s1', 0), enter('s1', 'standard', 5), complete('s1', 'standard', 65),
    ]);
    assert.equal(s.startToFirstSetMs, 65000); // overall: session start → first set
    assert.equal(s.byMode.standard.startToFirstSetMs, 60000); // entry → first set
    assert.equal(s.byMode.gym.startToFirstSetMs, null);
    assert.equal(s.byMode.guided.startToFirstSetMs, null);
    assert.equal(s.completedSets, 1);
  });

  it('Gym timing measures from Gym entry, not workout start', ()=>{
    const s = loggingFrictionStats([
      start('s1', 0), enter('s1', 'standard', 5), complete('s1', 'standard', 65, 'a1'),
      enter('s1', 'gym', 600), complete('s1', 'gym', 615, 'a2'),
    ]);
    assert.equal(s.byMode.gym.startToFirstSetMs, 15000);
    assert.equal(s.byMode.standard.startToFirstSetMs, 60000);
    assert.equal(s.startToFirstSetMs, 65000); // overall unchanged
  });

  it('Gym → Standard attributes each interval to its own entry', ()=>{
    const s = loggingFrictionStats([
      start('s1', 0), enter('s1', 'gym', 5), complete('s1', 'gym', 65, 'a1'),
      enter('s1', 'standard', 600), complete('s1', 'standard', 615, 'a2'),
    ]);
    assert.equal(s.byMode.gym.startToFirstSetMs, 60000);
    assert.equal(s.byMode.standard.startToFirstSetMs, 15000);
  });

  it('repeated switching never uses a stale entry', ()=>{
    const s = loggingFrictionStats([
      start('s1', 0),
      enter('s1', 'standard', 5),
      enter('s1', 'gym', 100), complete('s1', 'gym', 150, 'g1'),
      enter('s1', 'standard', 200), complete('s1', 'standard', 260, 'a1'),
    ]);
    // Standard anchor is the @200 entry, not the stale @5 one.
    assert.equal(s.byMode.standard.startToFirstSetMs, 60000);
    assert.equal(s.byMode.gym.startToFirstSetMs, 50000);
  });

  it('Guided entered mid-session measures from its own entry', ()=>{
    const s = loggingFrictionStats([
      start('s1', 0), enter('s1', 'standard', 5), complete('s1', 'standard', 65, 'a1'),
      enter('s1', 'guided', 600), complete('s1', 'guided', 615, 'g1'),
    ]);
    assert.equal(s.byMode.guided.startToFirstSetMs, 15000);
    assert.equal(s.completedSets, 2);
  });

  it('resume after reload anchors on the fresh entry without session:start', ()=>{
    const s = loggingFrictionStats([
      enter('s1', 'gym', 0), complete('s1', 'gym', 30, 'a1'),
    ]);
    assert.equal(s.byMode.gym.startToFirstSetMs, 30000);
    assert.equal(s.startToFirstSetMs, null); // overall still needs session:start
    assert.equal(s.completedSets, 1);
  });

  it('legacy telemetry without entries keeps overall timing, nulls per-mode timing', ()=>{
    const s = loggingFrictionStats([
      start('s1', 0), complete('s1', 'gym', 60, 'a1'),
    ]);
    assert.equal(s.startToFirstSetMs, 60000);
    assert.equal(s.byMode.gym.startToFirstSetMs, null);
    assert.equal(s.byMode.standard.startToFirstSetMs, null);
    assert.equal(s.completedSets, 1); // counts unaffected by missing anchors
  });

  it('duplicate entry ids collapse to one anchor', ()=>{
    const entry = enter('s1', 'gym', 600);
    const s = loggingFrictionStats([
      start('s1', 0), entry, { ...entry }, complete('s1', 'gym', 615, 'a1'),
    ]);
    assert.equal(s.byMode.gym.startToFirstSetMs, 15000);
  });

  it('entry after its completion is never used as an anchor', ()=>{
    const s = loggingFrictionStats([
      start('s1', 0), complete('s1', 'gym', 60, 'a1'), enter('s1', 'gym', 600),
    ]);
    assert.equal(s.byMode.gym.startToFirstSetMs, null);
    assert.equal(s.startToFirstSetMs, 60000);
  });
});

describe('mode:enter respects consent and stays content-free', ()=>{
  it('persists as an ordering anchor without timing consent, but yields no intervals', ()=>{
    setConsent(true, {}); // master on, sessionTimings off
    recordEvent('session:start', { sessionId: 's1' });
    recordEvent('mode:enter', { sessionId: 's1', mode: 'gym' });
    recordEvent('complete-set', { sessionId: 's1', exerciseId: 'e1', setIndex: 0, mode: 'gym', elapsedMs: 5000 });
    const events = getEventHistory();
    const entry = events.find((e)=> e.type === 'mode:enter');
    assert.ok(entry, 'entry persists like session:start (ordering anchor, not a duration)');
    assert.deepEqual(Object.keys(entry).sort(), ['at', 'id', 'mode', 'schemaVersion', 'sessionId', 'type']);
    const complete = events.find((e)=> e.type === 'complete-set');
    assert.equal('elapsedMs' in complete, false);
    const s = loggingFrictionStats(events);
    assert.equal(s.byMode.gym.startToFirstSetMs, null);
    assert.equal(s.startToFirstSetMs, null);
    assert.equal(s.completedSets, 1);
    assert.equal(s.completionEvents, 1);
  });

  it('drops smuggled workout values at write', ()=>{
    setConsent(true, { sessionTimings: true });
    recordEvent('mode:enter', { sessionId: 's1', mode: 'gym', load: 22.5, reps: 9, target: 'x' });
    const [e] = getEventHistory();
    assert.equal(e.mode, 'gym');
    for(const k of ['load', 'reps', 'rir', 'target', 'weightKg']) assert.equal(k in e, false);
  });
});

describe('entries change no counts', ()=>{
  it('mode:enter events move no counter except through anchored timing', ()=>{
    const base = [
      start('s1', 0), complete('s1', 'standard', 65, 'a1'),
    ];
    const withEntries = [
      start('s1', 0), enter('s1', 'standard', 5), enter('s1', 'gym', 600),
      complete('s1', 'standard', 65, 'a1'),
    ];
    const a = loggingFrictionStats(base);
    const b = loggingFrictionStats(withEntries);
    assert.equal(b.completedSets, a.completedSets);
    assert.equal(b.completionEvents, a.completionEvents);
    assert.equal(b.actionsPerCompletedSet, a.actionsPerCompletedSet);
    assert.equal(b.undos, a.undos);
    assert.equal(b.sessions, a.sessions);
    assert.equal(b.byMode.standard.sessions, a.byMode.standard.sessions);
    // ...while the standard anchor now resolves timing the legacy flow could not.
    assert.equal(a.byMode.standard.startToFirstSetMs, null);
    assert.equal(b.byMode.standard.startToFirstSetMs, 60000);
  });
});
