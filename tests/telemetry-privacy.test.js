// Telemetry privacy tests: the payload sanitizer, the granular consent gates,
// and the isolated error-diagnostics store. The invariants under test are the
// ones a privacy round lives or dies on: no health data in logs, no events
// without consent, and crash logs that never mix with the product ledger.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage stub — telemetry.js touches only getItem/setItem/removeItem.
class MemoryStorage {
  constructor(){ this.map = new Map(); }
  getItem(k){ return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v){ this.map.set(k, String(v)); }
  removeItem(k){ this.map.delete(k); }
}
globalThis.localStorage = new MemoryStorage();

const { KEY: STORE_KEY } = await import('../src/lib/store.js');
const {
  sanitizeEventPayload, recordEvent, getEventHistory, clearTelemetry,
  recordErrorEvent, getErrorEvents, clearErrorEvents, hasTelemetryOption,
  TELEMETRY_OPTIONS,
} = await import('../src/lib/telemetry.js');

function setConsent(enabled, options = {}){
  // Store shape mirrors what hasConsent/granularOptions read from disk.
  globalThis.localStorage.setItem(STORE_KEY, JSON.stringify({
    version: 9,
    preferences: { telemetryEnabled: enabled, telemetryOptions: options },
  }));
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
});

describe('telemetry payload sanitizer', () => {
  it('strips health and identity keys, keeps scalar facts', () => {
    const out = sanitizeEventPayload({
      exerciseId: 'bench-press', reps: 5, durationMs: 1200,
      restingHeartRate: 61, bodyWeightKg: 82.5, sleepScore: 88,
      userEmail: 'a@b.co', note: 'shoulder hurts', pain: 'yes',
    });
    assert.deepEqual(out, { exerciseId: 'bench-press', reps: 5, durationMs: 1200 });
  });

  it('drops object/array values and truncates long strings', () => {
    const out = sanitizeEventPayload({
      nested: { a: 1 }, list: [1, 2], label: 'x'.repeat(500),
    });
    assert.deepEqual(Object.keys(out), ['label']);
    assert.equal(out.label.length, 160);
  });

  it('neutralises prototype-pollution keys', () => {
    const payload = JSON.parse('{"__proto__":{"polluted":true},"ok":1}');
    const out = sanitizeEventPayload(payload);
    assert.deepEqual(out, { ok: 1 });
    assert.equal(({}).polluted, undefined);
  });
});

describe('consent gating', () => {
  it('records nothing without consent', () => {
    setConsent(false);
    assert.equal(recordEvent('session:start', { sessionId: 's1' }), null);
    assert.equal(getEventHistory().length, 0);
  });

  it('sanitizes on write when consented', () => {
    setConsent(true);
    recordEvent('session:start', { sessionId: 's1', bodyWeightKg: 90 });
    const events = getEventHistory();
    assert.equal(events.length, 1);
    assert.equal(events[0].sessionId, 's1');
    assert.equal(events[0].bodyWeightKg, undefined);
  });

  it('granular options are off by default and gate their metric types', () => {
    setConsent(true);
    assert.deepEqual(hasTelemetryOption('sessionTimings'), false);
    assert.equal(recordEvent('logging-time', { elapsedMs: 4000 }), null);
    setConsent(true, { sessionTimings: true });
    assert.equal(recordEvent('logging-time', { elapsedMs: 4000 }).type, 'logging-time');
  });

  it('exposes the option list for the settings UI', () => {
    assert.deepEqual(TELEMETRY_OPTIONS, ['errorDiagnostics', 'sessionTimings']);
  });
});

describe('error diagnostics isolation', () => {
  it('records nothing unless errorDiagnostics is opted in', () => {
    setConsent(true);
    assert.equal(recordErrorEvent(new Error('boom'), 'test'), null);
    assert.equal(getErrorEvents().length, 0);
    setConsent(true, { errorDiagnostics: true });
    assert.ok(recordErrorEvent(new Error('boom'), 'test'));
    assert.equal(getErrorEvents().length, 1);
  });

  it('caps the crash-log store at 50 and stores only safe fields', () => {
    setConsent(true, { errorDiagnostics: true });
    for(let i = 0; i < 60; i++) recordErrorEvent(new Error('crash ' + i), 'test');
    const events = getErrorEvents();
    assert.equal(events.length, 50);
    assert.equal(events[0].message, 'crash 10'); // oldest evicted
    // No payload fields beyond the fixed schema.
    const allowed = new Set(['id', 'schemaVersion', 'type', 'at', 'message', 'stackHead', 'source']);
    for(const e of events) for(const k of Object.keys(e)) assert.ok(allowed.has(k), `unexpected field ${k}`);
  });

  it('keeps error events out of the product ledger', () => {
    setConsent(true, { errorDiagnostics: true });
    recordEvent('session:start', { sessionId: 's1' });
    recordErrorEvent(new Error('x'), 'test');
    assert.equal(getEventHistory().filter(e => e.type === 'error').length, 0);
    assert.equal(getErrorEvents().length, 1);
  });

  it('clear functions empty both stores', () => {
    setConsent(true, { errorDiagnostics: true });
    recordEvent('session:start', { sessionId: 's1' });
    recordErrorEvent(new Error('x'), 'test');
    clearErrorEvents();
    assert.equal(getErrorEvents().length, 0);
    clearTelemetry();
    assert.equal(getEventHistory().length, 0);
  });
});
