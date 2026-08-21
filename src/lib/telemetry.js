// Local, consent-gated event history for product measurements.
// Nothing leaves the device here; Pulse and health sharing have separate consent.

import { STORE_SCHEMA_VERSION } from './store.js';

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
    const raw=localStorage.getItem('arise.store.v1');
    const store=raw ? JSON.parse(raw) : null;
    return store?.preferences?.telemetryEnabled === true;
  }catch{ return false; }
}

export function recordEvent(type, payload={}, { essential=false }={}){
  if(!hasConsent(essential)) return null;
  const event={
    id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    schemaVersion: STORE_SCHEMA_VERSION,
    type,
    at: new Date().toISOString(),
    ...payload,
  };
  saveEvents([...loadEvents(), event]);
  return event;
}

export function getEventHistory(){ return loadEvents(); }
export function getTelemetry(){ return { version: 2, events: loadEvents() }; }

export function replaceEventHistory(events){
  saveEvents(normaliseEvents(events));
}

export function mergeEventHistory(events){
  const merged=[...loadEvents(), ...normaliseEvents(events)];
  const seen=new Set();
  saveEvents(merged.filter(e=> { if(seen.has(e.id)) return false; seen.add(e.id); return true; }));
}

export function clearTelemetry(){
  try{ localStorage.removeItem(KEY); localStorage.removeItem(LEGACY_KEY); }catch{}
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
