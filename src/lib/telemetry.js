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
//
// Two further write-time gates live in recordEvent (below), enforced for
// EVERY event type so no call site can leak by forgetting:
//   TIMING_KEYS — duration-bearing measurements, persisted only while the
//     sessionTimings refinement is on;
//   TARGET_VALUE_KEY_RE — recommendation target text/load/rep keys, NEVER
//     persisted (the prospective evaluation ledger owns those data).
const SENSITIVE_KEY_RE = /(heart|hr|rate|sleep|weight|kg|steps|calorie|cal|nutrition|bp|blood|spo2|oxygen|vo2|temp(erature)?|glucose|body|health|fitness|medication|dose|pain|injur|symptom|diagnos|email|phone|token|secret|password|passphrase|address|geo|lat|lng|gps|name|note|text|message|summary|consent)/i;
const MAX_STRING_LEN = 160;

// Duration-bearing measurement keys: persisted only with sessionTimings on.
const TIMING_KEYS = new Set(['elapsedMs', 'durationMs', 'sessionElapsedMs']);
// Recommendation target vocabulary: text/load/rep values belong to the
// prospective evaluation ledger, never to product telemetry. Matched before
// the sensitive-key pass so smuggled target fields cannot survive either.
const TARGET_VALUE_KEY_RE = /^(target|suggestedTarget|load|loadKg|loadTarget|reps|repTarget|rir|rirTarget|assistKg|assistedKg|weightKg|weight)$/i;

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
  // Privacy gates at WRITE time (never rely on call sites to remember):
  //  - duration-bearing keys are dropped unless the sessionTimings refinement
  //    is on — when timing consent is off, no timing VALUE is persisted, only
  //    the fact that the action happened (counts still work, medians degrade
  //    to null instead of inventing times);
  //  - recommendation target text/load/rep keys are ALWAYS dropped — the
  //    prospective evaluation ledger already owns those data, product
  //    telemetry must never duplicate workout content.
  const timingsOn = hasTelemetryOption('sessionTimings');
  const scrubbed = {};
  for(const [key, value] of Object.entries(payload || {})){
    if(TARGET_VALUE_KEY_RE.test(key)) continue;
    if(!timingsOn && TIMING_KEYS.has(key)) continue;
    scrubbed[key] = value;
  }
  // Identity fields are pinned after the payload spread so a stray
  // { id, type, at } in the payload can't corrupt dedup or time ordering.
  const safePayload = sensitiveKeys ? sanitizeEventPayload(scrubbed, { sensitiveKeys }) : scrubbed;
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
// speed-of-logging metrics. Privacy design notes, enforced at write time:
// keystrokes are NEVER instrumented — field inputs emit one value-free
// *-field-commit on blur-and-changed only, so taps-per-action counts discrete
// committed actions (never keystrokes) and is a LOWER bound on real taps.
// All inputs are scalar ids, counts, modes and millisecond durations — any
// content-bearing key (target text, loads, reps, notes) is stripped at write
// time and would equally be dropped here. Pure and deterministic over input.
//
// Canonical value-free interaction taxonomy (action type only, never entered
// values). Legacy event names are accepted as aliases into the same buckets
// so old telemetry still aggregates and degrades safely instead of vanishing:
//   complete-set  ← set:complete          undo-set   ← set:uncomplete,
//                                                          set:unfailed
//   add-set       (new)                    remove-set ← set:removed
//   swap-open     (new)                    swap-commit← exercise:swapped
//   apply-all     ← recommendation:accepted via apply-all
//   load/reps/rir-field-commit (new)       set:skip, set:failed, accepted/
//                                          dismissed stay as legacy actions.
const COMPLETE_EVENTS = ['complete-set', 'set:complete'];
const UNDO_EVENTS = ['undo-set', 'set:uncomplete', 'set:unfailed'];
const ADD_EVENTS = ['add-set'];
const REMOVE_EVENTS = ['remove-set', 'set:removed'];
const SKIP_EVENTS = ['set:skip'];
const FAILED_EVENTS = ['set:failed'];
const FIELD_COMMIT_EVENTS = ['load-field-commit', 'reps-field-commit', 'rir-field-commit'];
const APPLY_ALL_EVENTS = ['apply-all'];
// 'apply-previous' is a RESERVED taxonomy name with no emitting control (the
// carry-forward prefill is automatic, not a user action). It is counted here
// so usage is honestly 0 until a control emits it — never assumed, never
// fabricated.
const APPLY_PREVIOUS_EVENTS = ['apply-previous'];
const SWAP_OPEN_EVENTS = ['swap-open'];
const SWAP_COMMIT_EVENTS = ['swap-commit', 'exercise:swapped'];
const ACCEPT_EVENTS = ['recommendation:accepted', 'recommendation:dismissed'];
// RIR suggestion lifecycle: `-shown` is display (like session:start — never
// an interaction); `-confirmed` is the user's one-tap confirm and counts as
// the single action it is. Neither ever carries the RIR value itself.
const RIR_SUGGESTION_SHOWN_EVENTS = ['rir-suggestion-shown'];
const RIR_CONFIRM_EVENTS = ['rir-suggestion-confirmed'];
const INTERACTION_EVENTS = [
  ...COMPLETE_EVENTS, ...UNDO_EVENTS, ...ADD_EVENTS, ...REMOVE_EVENTS,
  ...SKIP_EVENTS, ...FAILED_EVENTS, ...FIELD_COMMIT_EVENTS, ...APPLY_ALL_EVENTS,
  ...SWAP_OPEN_EVENTS, ...SWAP_COMMIT_EVENTS, ...ACCEPT_EVENTS,
  ...RIR_CONFIRM_EVENTS, ...APPLY_PREVIOUS_EVENTS,
];
// Value-free field-commit tracking for set-editor inputs. Call onFocus on
// focus and fieldCommitted on blur: it reports true only when the value
// actually CHANGED while focused, so a commit event means one committed edit
// — never keystrokes, never focus visits. Payloads must stay value-free
// (ids/mode only); this helper never sees or stores the entered value beyond
// the blur comparison.
export function trackFieldFocus(e){
  try{ if(e?.target) e.target.dataset.prevValue = String(e.target.value ?? ''); }catch{}
}
export function fieldCommitted(e){
  try{
    const prev = e?.target?.dataset?.prevValue;
    const next = String(e?.target?.value ?? '');
    if(e?.target?.dataset) delete e.target.dataset.prevValue;
    return prev != null && next !== prev;
  }catch{ return false; }
}
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
  const inType = (e, list)=> list.includes(e.type);
  let startToFirst=[];
  let completionMs=[];
  let completed=0, skipped=0, undos=0, added=0, removed=0, failedMarked=0;
  let fieldLoad=0, fieldReps=0, fieldRir=0;
  let rirShown=0, rirConfirmed=0;
  let interactions=0;
  let accepted=0, viaApplyAll=0, applyPrev=0;
  let swapOpens=0, swapCommits=0, swapMs=[], saveMs=[];
  for(const list of bySession.values()){
    const byTime=list.slice().sort((a,b)=> String(a.at||'').localeCompare(String(b.at||'')));
    const start=byTime.find(e=> e.type==='session:start');
    const firstComplete=byTime.find(e=> inType(e, COMPLETE_EVENTS));
    // A start→first-set interval is only computable when the first completion
    // carries its own duration: with sessionTimings off (or legacy telemetry)
    // durations are never persisted, so the interval degrades to null instead
    // of being reconstructed from bare timestamps.
    const anchorMs = firstComplete == null ? NaN : Number(firstComplete.elapsedMs);
    if(start && firstComplete && Number.isFinite(anchorMs) && anchorMs >= 0 && (mode == null || firstComplete.mode === mode)){
      const ms=Date.parse(firstComplete.at)-Date.parse(start.at);
      if(Number.isFinite(ms) && ms>=0) startToFirst.push(ms);
    }
    for(const e of byTime){
      if(mode != null && e.type !== 'session:start' && e.mode !== mode) continue;
      if(inType(e, COMPLETE_EVENTS)){
        completed++;
        interactions++;
        const ms=Number(e.elapsedMs);
        if(Number.isFinite(ms) && ms>=0) completionMs.push(ms);
      }
      else if(inType(e, UNDO_EVENTS)){ undos++; interactions++; }
      else if(inType(e, ADD_EVENTS)){ added++; interactions++; }
      else if(inType(e, REMOVE_EVENTS)){ removed++; interactions++; }
      else if(inType(e, SKIP_EVENTS)){ skipped++; interactions++; }
      else if(inType(e, FAILED_EVENTS)){ failedMarked++; interactions++; }
      else if(inType(e, FIELD_COMMIT_EVENTS)){
        interactions++;
        if(e.type==='load-field-commit') fieldLoad++;
        else if(e.type==='reps-field-commit') fieldReps++;
        else fieldRir++;
      }
      else if(inType(e, RIR_SUGGESTION_SHOWN_EVENTS)){
        rirShown++; // display only — never an interaction
      }
      else if(inType(e, RIR_CONFIRM_EVENTS)){
        rirConfirmed++;
        interactions++;
      }
      else if(inType(e, APPLY_PREVIOUS_EVENTS)){
        applyPrev++;
        interactions++;
      }
      else if(inType(e, APPLY_ALL_EVENTS) || (e.type==='recommendation:accepted' && e.via==='apply-all')){
        accepted++;
        viaApplyAll++;
        interactions++;
      }
      else if(e.type==='recommendation:accepted' || e.type==='recommendation:dismissed'){
        accepted++;
        interactions++;
      }
      else if(inType(e, SWAP_OPEN_EVENTS)){ swapOpens++; interactions++; }
      else if(inType(e, SWAP_COMMIT_EVENTS)){
        swapCommits++;
        interactions++;
        const ms=Number(e.elapsedMs);
        if(Number.isFinite(ms) && ms>=0) swapMs.push(ms);
      }
      else if(e.type==='session:save'){
        const ms=Number(e.durationMs);
        if(Number.isFinite(ms) && ms>=0) saveMs.push(ms);
      }
    }
  }
  return { sessions: bySession.size, completed, skipped, undos, added, removed, failedMarked, fieldLoad, fieldReps, fieldRir, rirShown, rirConfirmed, applyPrev, interactions, accepted, viaApplyAll, swapOpens, swapCommits, startToFirst, completionMs, swapMs, saveMs };
}

function frictionSummary(core){
  const startToFirstSetMs = medianOfMs(core.startToFirst);
  const loggingMsMedian = medianOfMs(core.completionMs);
  const swapMsMedian = medianOfMs(core.swapMs);
  const saveMsMedian = medianOfMs(core.saveMs);
  const fieldCommits = core.fieldLoad + core.fieldReps + core.fieldRir;
  return {
    sessions: core.sessions,
    completedSets: core.completed,
    // Actions per completed set: every discrete value-free interaction over
    // completions. Keystrokes are never instrumented, so this stays a lower
    // bound on real taps.
    actionsPerCompletedSet: core.completed ? Math.round(core.interactions / core.completed * 100) / 100 : null,
    // Corrections per session: undoing a completion or a failed-mark.
    correctionsPerSession: core.sessions ? Math.round(core.undos / core.sessions * 100) / 100 : null,
    undos: core.undos,
    addedSets: core.added,
    removedSets: core.removed,
    failedMarks: core.failedMarked,
    skippedSets: core.skipped,
    fieldCommits: { total: fieldCommits, load: core.fieldLoad, reps: core.fieldReps, rir: core.fieldRir },
    // RIR suggestion cost comparison: shown (offered) vs confirmed (one tap)
    // vs typed (a field commit). A confirm costs exactly one value-free
    // action and never carries the value.
    rirSuggestions: { shown: core.rirShown, confirmed: core.rirConfirmed },
    startToFirstSetMs,
    loggingMsMedian,
    applyAll: {
      accepted: core.accepted,
      viaApplyAll: core.viaApplyAll,
      applyAllRate: core.accepted ? Math.round(core.viaApplyAll / core.accepted * 100) / 100 : null,
    },
    // Apply-previous usage: reserved taxonomy name, no emitting control —
    // honestly 0 until a control emits it.
    applyPrevious: { count: core.applyPrev },
    swap: { opens: core.swapOpens, commits: core.swapCommits, msMedian: swapMsMedian },
    saveMsMedian,
    // Degraded when nothing loggable produced a timing: legacy telemetry that
    // only ever marked sessions complete contributes events but no durations,
    // so every timing median stays null and no speed is ever invented.
    degraded: startToFirstSetMs == null && loggingMsMedian == null && swapMsMedian == null && saveMsMedian == null,
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
    note: 'Discrete committed actions only — keystrokes and focus moves are intentionally never instrumented, so actions-per-completed-set is a lower bound on real taps. Durations persist only with the sessionTimings refinement on; otherwise timing medians degrade to null. Per-mode buckets count only events carrying that mode tag; untagged legacy events count toward the overall numbers only.',
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
