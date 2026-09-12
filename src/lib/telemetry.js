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

// ── Logging-friction measurement ─────────────────────────────────────────
// Aggregates the discrete interaction events the runners record into honest
// speed-of-logging metrics. Privacy design notes, enforced by the sanitizer:
// keystrokes and focus moves are deliberately NEVER instrumented, so
// taps-per-completed-set counts only discrete logged actions (complete,
// uncomplete, skip, remove, add) and is therefore a LOWER bound on real taps.
// All inputs are scalar ids, counts, modes and millisecond durations — any
// content-bearing key (reps, loads, notes) is stripped at write time and
// would equally be dropped here. Pure and deterministic over its input.
function medianOfMs(values){
  const list=(values||[]).filter(v=> Number.isFinite(v) && v>=0).sort((a,b)=> a-b);
  if(!list.length) return null;
  const mid=Math.floor(list.length/2);
  return Math.round(list.length%2 ? list[mid] : (list[mid-1]+list[mid])/2);
}

function frictionCore(events, { mode = null } = {}){
  const all=(events||[]).filter(e=> e && typeof e==='object');
  const inScope = mode == null ? all : all.filter(e=> e.mode === mode || e.type === 'session:start');
  const bySession=new Map();
  for(const e of inScope){
    if(!e.sessionId || typeof e.sessionId !== 'string') continue;
    if(!bySession.has(e.sessionId)) bySession.set(e.sessionId, []);
    bySession.get(e.sessionId).push(e);
  }
  let startToFirst=[];
  let completionMs=[];
  let completed=0, skipped=0, uncompleted=0, removed=0, failedMarked=0;
  let interactions=0;
  let accepted=0, viaApplyAll=0;
  let swapMs=[], saveMs=[];
  for(const list of bySession.values()){
    const byTime=list.slice().sort((a,b)=> String(a.at||'').localeCompare(String(b.at||'')));
    const start=byTime.find(e=> e.type==='session:start');
    const firstComplete=byTime.find(e=> e.type==='set:complete');
    // Per-mode buckets attribute the start→first-set gap by the mode tag on
    // that first completion; untagged legacy flows count toward the overall
    // numbers only, never a mode bucket.
    if(start && firstComplete && (mode == null || firstComplete.mode === mode)){
      const ms=Date.parse(firstComplete.at)-Date.parse(start.at);
      if(Number.isFinite(ms) && ms>=0) startToFirst.push(ms);
    }
    for(const e of byTime){
      if(mode != null && e.type !== 'session:start' && e.mode !== mode) continue;
      if(e.type==='set:complete'){
        completed++;
        interactions++;
        const ms=Number(e.elapsedMs);
        if(Number.isFinite(ms) && ms>=0) completionMs.push(ms);
      }
      else if(e.type==='set:skip'){ skipped++; interactions++; }
      else if(e.type==='set:uncomplete'){ uncompleted++; interactions++; }
      else if(e.type==='set:removed'){ removed++; interactions++; }
      else if(e.type==='set:failed' || e.type==='set:unfailed'){ failedMarked++; interactions++; }
      else if(e.type==='recommendation:accepted'){
        accepted++;
        if(e.via==='apply-all') viaApplyAll++;
      }
      else if(e.type==='exercise:swapped'){
        const ms=Number(e.elapsedMs);
        if(Number.isFinite(ms) && ms>=0) swapMs.push(ms);
      }
      else if(e.type==='session:save'){
        const ms=Number(e.durationMs);
        if(Number.isFinite(ms) && ms>=0) saveMs.push(ms);
      }
    }
  }
  return { sessions: bySession.size, completed, skipped, uncompleted, removed, failedMarked, interactions, accepted, viaApplyAll, startToFirst, completionMs, swapMs, saveMs };
}

function frictionSummary(core){
  const startToFirstSetMs = medianOfMs(core.startToFirst);
  const completionMsMedian = medianOfMs(core.completionMs);
  const swapMsMedian = medianOfMs(core.swapMs);
  const saveMsMedian = medianOfMs(core.saveMs);
  return {
    sessions: core.sessions,
    completedSets: core.completed,
    startToFirstSetMs,
    completionMsMedian,
    tapsPerCompletedSet: core.completed ? Math.round(core.interactions / core.completed * 100) / 100 : null,
    undos: core.uncompleted,
    removedSets: core.removed,
    failedMarks: core.failedMarked,
    applyAll: {
      accepted: core.accepted,
      viaApplyAll: core.viaApplyAll,
      applyAllRate: core.accepted ? Math.round(core.viaApplyAll / core.accepted * 100) / 100 : null,
    },
    swapMsMedian,
    saveMsMedian,
    // Degraded when nothing loggable produced a timing: legacy telemetry that
    // only ever marked sessions complete contributes events but no durations,
    // so every timing median stays null and no speed is ever invented.
    degraded: startToFirstSetMs == null && completionMsMedian == null && swapMsMedian == null && saveMsMedian == null,
  };
}

export function loggingFrictionStats(events){
  const all=Array.isArray(events) ? events : loadEvents();
  const byMode = {};
  for(const mode of ['gym', 'standard', 'guided']){
    byMode[mode] = frictionSummary(frictionCore(all, { mode }));
  }
  const overall = frictionSummary(frictionCore(all));
  return {
    ...overall,
    byMode,
    note: 'Discrete logged actions only — keystrokes and focus moves are intentionally never instrumented, so taps-per-completed-set is a lower bound on real taps. Per-mode buckets count only events carrying that mode tag; untagged legacy events count toward the overall numbers only.',
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
