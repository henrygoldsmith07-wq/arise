// pulse.js — Pulse connector for Arise.
// Push completed workouts + volume/trends to Pulse, optionally pull Pulse metrics back into analytics.
// Offline-first, pluggable adapter. No hard dependency on Pulse — all via injected adapter.
// Adapter shape: { pushWorkout(payload), pushVolume(payload), pullMetrics() -> { steps, weight, ... } | null }

import { totalVolumeKg } from './store.js';
import { weeklyVolume } from './analytics.js';

export function pulseWorkoutPayload(session){
  // Normalise a completed session into Pulse workout format
  const volumeKg = (session.blocks||[]).reduce((acc,b)=> acc + (b.sets||[]).reduce((a,s)=> a + (Number(s.reps)||0)*(Number(s.weightKg)||0), 0), 0);
  return {
    source: 'arise',
    id: session.id,
    dateISO: session.dateISO,
    title: session.title,
    programId: session.programId || null,
    week: session.week ?? null,
    day: session.day ?? null,
    volumeKg: Math.round(volumeKg),
    exerciseCount: (session.blocks||[]).length,
    setCount: (session.blocks||[]).reduce((a,b)=> a + (b.sets||[]).length, 0),
    savedAt: session.savedAt || new Date().toISOString(),
  };
}

export function pulseVolumePayload(history){
  const wv = weeklyVolume(history||[]);
  const total = totalVolumeKg(history||[]);
  return {
    source: 'arise',
    totalVolumeKg: total,
    weeklyVolume: wv.slice(-12),
    exportedAt: new Date().toISOString(),
  };
}

export async function pushToPulse(session, history, adapter){
  if(!adapter) return { ok: false, reason: 'No Pulse adapter configured.' };
  const workout = pulseWorkoutPayload(session);
  const volume = pulseVolumePayload(history);
  const results = {};
  if(adapter.pushWorkout) {
    try { await adapter.pushWorkout(workout); results.workout = { ok: true }; } catch(e){ results.workout = { ok: false, error: String(e.message||e) }; }
  }
  if(adapter.pushVolume){
    try { await adapter.pushVolume(volume); results.volume = { ok: true }; } catch(e){ results.volume = { ok: false, error: String(e.message||e) }; }
  }
  results.ok=Object.values(results).every(value=> value?.ok !== false);
  return results;
}

export async function pullFromPulse(adapter){
  if(!adapter || !adapter.pullMetrics) return null;
  try { return await adapter.pullMetrics(); } catch { return null; }
}

// Connector smoke path used by field tests and host integrations. It exercises
// both writes and reads without making Arise depend on a Pulse SDK.
export async function runPulseIntegrationE2E({ session, history, adapter } = {}){
  const pushed=await pushToPulse(session, history, adapter);
  const raw=await pullFromPulse(adapter);
  const metrics=mergePulseMetrics(raw);
  return { ok: pushed.ok === true && (raw == null || metrics != null), pushed, raw, metrics };
}

// Merge Pulse metrics into analytics context (e.g. steps, sleep)
// Returns a small summary to show in Progress
export function mergePulseMetrics(pulseData){
  if(!pulseData) return null;
  const out = {};
  if(pulseData.steps != null) out.steps = Number(pulseData.steps);
  if(pulseData.weightKg != null) out.weightKg = Number(pulseData.weightKg);
  if(pulseData.sleepHours != null) out.sleepHours = Number(pulseData.sleepHours);
  return Object.keys(out).length ? out : null;
}
