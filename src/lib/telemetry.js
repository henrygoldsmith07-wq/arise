// Local, consent-gated event history for product measurements.
// Nothing leaves the device here; Pulse and health sharing have separate consent.

import { STORE_SCHEMA_VERSION, KEY as STORE_KEY } from './store.js';

const KEY = 'arise.telemetry.v2';
const LEGACY_KEY = 'arise.telemetry.v1';
const EVENT_LIMIT = 2000;

function readJson(key, fallback){
  try{
    const raw=localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch{ return fallback; }
}

function normaliseEvents(value){
  const events=Array.isArray(value) ? value : Array.isArray(value?.events) ? value.events : [];
  return events.filter(e=> e && typeof e==='object' && typeof e.type==='string').map((e,i)=> ({
    id: e.id || `legacy-${e.at||i}-${i}`,
    schemaVersion: e.schemaVersion || 1,
    ...e,
  }));
}

function loadEvents(){
  const current=normaliseEvents(readJson(KEY, { events: [] }));
  const legacy=normaliseEvents(readJson(LEGACY_KEY, { events: [] }));
  const seen=new Set();
  return [...legacy, ...current].filter(e=> { if(seen.has(e.id)) return false; seen.add(e.id); return true; }).slice(-EVENT_LIMIT);
}

function saveEvents(events){
  try{ localStorage.setItem(KEY, JSON.stringify({ version: 2, events: events.slice(-EVENT_LIMIT) })); }catch{}
}

function hasConsent(essential=false){
  if(essential) return true;
  try{
    const raw=localStorage.getItem(STORE_KEY);
    const store=raw ? JSON.parse(raw) : null;
    return store?.preferences?.telemetryEnabled === true;
  }catch{ return false; }
}

// ── Granular consent ─────────────────────────────────────────────────────────
// The master switch (preferences.telemetryEnabled) gates measurements as a
// whole. Two optional refinements default OFF, live device-local, and never
// travel in exports (applyFieldPolicy strips them):
//   errorDiagnostics — structured error events used to debug crashes; kept in
//     a SEPARATE store so the 2000-event product ledger stays product-only.
//   sessionTimings  — the logging-time metric (how long a set takes to log).
export const TELEMETRY_OPTIONS = ['errorDiagnostics', 'sessionTimings'];

function granularOptions(){
  try{
    const raw=localStorage.getItem(STORE_KEY);
    const store=raw ? JSON.parse(raw) : null;
    const o=store?.preferences?.telemetryOptions || {};
    return { errorDiagnostics: o.errorDiagnostics === true, sessionTimings: o.sessionTimings === true };
  }catch{ return { errorDiagnostics: false, sessionTimings: false }; }
}

export function hasTelemetryOption(option){
  if(!TELEMETRY_OPTIONS.includes(option)) return false;
  if(!hasConsent()) return false;
  return granularOptions()[option] === true;
}

// ── Payload sanitizer ────────────────────────────────────────────────────────
// Events are product measurements, not a journal of whatever a call site had
// in scope. Anything matching a sensitive key (own or inherited) is dropped —
// health metrics are the critical class (medical data must never land in a
// log), plus identity and free-text keys that invite accidental capture.
const SENSITIVE_KEY_RE = /(heart|hr|rate|sleep|weight|kg|steps|calorie|cal|nutrition|bp|blood|spo2|oxygen|vo2|temp(erature)?|glucose|body|health|fitness|medication|dose|pain|injur|symptom|diagnos|email|phone|token|secret|password|passphrase|address|geo|lat|lng|gps|name|note|text|message|summary|consent)/i;
const MAX_STRING_LEN = 160;

export function sanitizeEventPayload(input, { sensitiveKeys = SENSITIVE_KEY_RE } = {}){
  const out={};
  for(const key of Object.keys(input || {})){
    if(key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const value = input[key];
    if(value == null || typeof value !== 'object'){
      if(sensitiveKeys?.test?.(key)) continue;
      out[key] = typeof value === 'string' ? value.slice(0, MAX_STRING_LEN) : value;
    }
    // Objects/arrays are dropped by design: payload fields must be scalar
    // facts (ids, counts, durations), never structured dumps.
  }
  return out;
}

export function recordEvent(type, payload={}, { essential=false, sensitiveKeys=SENSITIVE_KEY_RE }={}){
  if(!hasConsent(essential)) return null;
  // Granular gate: metric-specific options must be on for their event types.
  if(type === 'error' && !hasTelemetryOption('errorDiagnostics')) return null;
  if(type === 'logging-time' && !hasTelemetryOption('sessionTimings')) return null;
  // Identity fields are pinned after the payload spread so a stray
  // { id, type, at } in the payload can't corrupt dedup or time ordering.
  const safePayload = sensitiveKeys ? sanitizeEventPayload(payload, { sensitiveKeys }) : payload;
  const event={
    ...safePayload,
    id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    schemaVersion: STORE_SCHEMA_VERSION,
    type,
    at: new Date().toISOString(),
  };
  saveEvents([...loadEvents(), event]);
  return event;
}

export function getEventHistory(){ return loadEvents(); }

export function replaceEventHistory(events){
  saveEvents(normaliseEvents(events));
}

export function mergeEventHistory(events){
  const merged=[...loadEvents(), ...normaliseEvents(events)];
  const seen=new Set();
  saveEvents(merged.filter(e=> { if(seen.has(e.id)) return false; seen.add(e.id); return true; }));
}

export function clearTelemetry(){
  try{ localStorage.removeItem(KEY); localStorage.removeItem(LEGACY_KEY); localStorage.removeItem(ERROR_KEY); }catch{}
}

// ── Error diagnostics (separate, capped, sanitizer-only store) ───────────────
// Crash/debug events never enter the 2000-event product ledger. They carry no
// caller payloads at all — only the truncated message, stack head, and coarse
// source — so even a bug that throws a health summary can't persist it here.
const ERROR_KEY = 'arise.errors.v1';
const ERROR_LIMIT = 50;

export function recordErrorEvent(error, context){
  if(!hasTelemetryOption('errorDiagnostics')) return null;
  const event={
    id: `err-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    schemaVersion: STORE_SCHEMA_VERSION,
    type: 'error',
    at: new Date().toISOString(),
    message: String(error?.message || error || 'unknown').slice(0, MAX_STRING_LEN),
    stackHead: typeof error?.stack === 'string' ? error.stack.split('\n').slice(0, 3).join(' | ').slice(0, MAX_STRING_LEN) : null,
    source: String(context || 'unhandled').slice(0, 40),
  };
  const current=normaliseEvents(readJson(ERROR_KEY, { events: [] }));
  try{ localStorage.setItem(ERROR_KEY, JSON.stringify({ version: 1, events: [...current, event].slice(-ERROR_LIMIT) })); }catch{}
  return event;
}

export function getErrorEvents(){ return normaliseEvents(readJson(ERROR_KEY, { events: [] })); }

export function clearErrorEvents(){
  try{ localStorage.removeItem(ERROR_KEY); }catch{}
}

function eventsFor(events){ return Array.isArray(events) ? events : loadEvents(); }

function uniqueOrCount(events, types){
  const matching=events.filter(e=> types.includes(e.type));
  const ids=new Set(matching.map(e=> e.sessionId).filter(Boolean));
  return ids.size || matching.length;
}

export function workoutCompletionStats(events){
  const all=eventsFor(events);
  const started=uniqueOrCount(all, ['session:start','session:resume']);
  const completedEvents=all.filter(e=> e.type==='session:complete');
  const abandonedEvents=all.filter(e=> e.type==='session:abandon');
  const completedIds=new Set(completedEvents.map(e=> e.sessionId).filter(Boolean));
  const abandonedIds=new Set(abandonedEvents.map(e=> e.sessionId).filter(Boolean));
  const completed=completedIds.size || completedEvents.length;
  const abandoned=abandonedIds.size
    ? [...abandonedIds].filter(id=> !completedIds.has(id)).length
    : abandonedEvents.length;
  const terminal=completedIds.size || abandonedIds.size ? new Set([...completedIds,...abandonedIds]).size : completed+abandoned;
  return {
    started,
    completed,
    abandoned,
    completionRate: started ? Math.round(completed/started*100)/100 : null,
    abandonmentRate: terminal ? Math.round(abandoned/terminal*100)/100 : null,
  };
}

export function recommendationAcceptanceStats(events){
  const all=eventsFor(events);
  const shown=all.filter(e=> e.type==='recommendation:shown').length;
  const accepted=all.filter(e=> e.type==='recommendation:accepted').length;
  const dismissed=all.filter(e=> e.type==='recommendation:dismissed').length;
  return { shown, accepted, dismissed, acceptanceRate: shown ? Math.round(accepted/shown*100)/100 : null };
}

export function loggingTimeStats(events){
  const values=eventsFor(events).map(e=> Number(e.elapsedMs)).filter(n=> Number.isFinite(n) && n>=0).sort((a,b)=> a-b);
  if(!values.length) return { n: 0, meanMs: null, medianMs: null, p90Ms: null, under10sPct: null };
  const percentile=p=> values[Math.min(values.length-1, Math.ceil(values.length*p)-1)];
  const mean=values.reduce((a,b)=>a+b,0)/values.length;
  return {
    n: values.length,
    meanMs: Math.round(mean),
    medianMs: Math.round(percentile(0.5)),
    p90Ms: Math.round(percentile(0.9)),
    under10sPct: Math.round(values.filter(v=> v<=10000).length/values.length*100),
  };
}

export function telemetrySummary(){
  const events=loadEvents();
  return {
    completion: workoutCompletionStats(events),
    recommendation: recommendationAcceptanceStats(events),
    logging: loggingTimeStats(events),
    totalEvents: events.length,
    schemaVersion: STORE_SCHEMA_VERSION,
  };
}

export { EVENT_LIMIT, KEY };
