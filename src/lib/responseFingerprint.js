// Response fingerprint: a descriptive, local-first summary of the conditions
// that have preceded a user's observed next-exposure response. This is not a
// causal model; it is a small, sample-gated way to turn logged context into a
// useful training cue.

import { resolveArisePriors } from './priors.js';
import { exposuresFor } from './study.js';

export const FINGERPRINT_MIN_TRANSITIONS = 4;
export const FINGERPRINT_MIN_GROUP_TRANSITIONS = 2;

const POSITIVE_TAGS = new Set(['felt-strong', 'form-focus']);
const NEGATIVE_TAGS = new Set(['felt-heavy', 'poor-sleep', 'pain-discomfort']);

function finite(value){
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function latestReadiness(readinessLog, dateISO, lookbackDays = 3){
  const end = Date.parse(`${dateISO}T00:00:00Z`);
  if(!Number.isFinite(end)) return null;
  let best = null;
  for(const entry of readinessLog || []){
    if(!entry || typeof entry !== 'object' || !entry.dateISO) continue;
    const score = finite(entry.score);
    const time = Date.parse(`${entry.dateISO}T00:00:00Z`);
    if(score == null || !Number.isFinite(time) || time > end || end - time > lookbackDays * 86400000) continue;
    if(!best || time >= best.time) best = { score, dateISO: entry.dateISO, time };
  }
  return best;
}

function readinessBand(readiness, threshold){
  if(!readiness) return 'unknown';
  return readiness.score >= threshold ? 'ready' : 'under-recovered';
}

function repBand(reps){
  const value = Number(reps) || 0;
  if(value <= 5) return 'low reps';
  if(value <= 8) return 'mid reps';
  return 'high reps';
}

function contextBand(session){
  const tags = Array.isArray(session?.noteTags) ? session.noteTags : [];
  if(tags.some(tag => POSITIVE_TAGS.has(tag))) return 'felt strong';
  if(tags.some(tag => NEGATIVE_TAGS.has(tag))) return 'felt taxed';
  return 'no signal';
}

function summarise(rows, key, minimumGroupTransitions){
  const changes = rows.map(row => row.changePct).filter(value => value != null);
  const meanChangePct = changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : null;
  const progressionRate = changes.length ? changes.filter(value => value >= 0.02).length / changes.length : null;
  return {
    key,
    n: rows.length,
    meanChangePct,
    progressionRate,
    conclusive: rows.length >= minimumGroupTransitions,
  };
}

function bestGroup(groups){
  return groups
    .filter(group => group.conclusive && group.meanChangePct != null)
    .sort((a, b) => b.meanChangePct - a.meanChangePct || b.n - a.n)[0] || null;
}

function sortExposures(rows){
  return [...rows].sort((a, b) => String(a?.session?.dateISO || '').localeCompare(String(b?.session?.dateISO || '')));
}

/**
 * Build a descriptive response fingerprint for one exercise.
 *
 * Each transition describes the context visible at exposure i and the actual
 * score change observed at exposure i+1. The current exposure is never used as
 * its own outcome, so the summary cannot accidentally peek into the future.
 */
export function buildResponseFingerprint(history, exerciseId, readinessLog = [], { minimumTransitions = FINGERPRINT_MIN_TRANSITIONS, minimumGroupTransitions = FINGERPRINT_MIN_GROUP_TRANSITIONS, config = null } = {}){
  const cfg = resolveArisePriors(config);
  const threshold = Number(cfg.recovery?.readinessLowLatest) || 40;
  const exposures = sortExposures(exposuresFor(history, exerciseId));
  const rows = [];

  for(let i = 0; i < exposures.length - 1; i++){
    const current = exposures[i];
    const next = exposures[i + 1];
    const currentScore = finite(current?.best?.score);
    const nextScore = finite(next?.best?.score);
    if(!(currentScore > 0 && nextScore > 0)) continue;
    const readiness = latestReadiness(readinessLog, current.session.dateISO);
    rows.push({
      dateISO: current.session.dateISO,
      changePct: (nextScore - currentScore) / currentScore,
      readinessScore: readiness?.score ?? null,
      readinessBand: readinessBand(readiness, threshold),
      repBand: repBand(current.best.reps),
      contextBand: contextBand(current.session),
    });
  }

  const minGroup = Math.max(1, Number(minimumGroupTransitions) || FINGERPRINT_MIN_GROUP_TRANSITIONS);
  const readinessGroups = ['ready', 'under-recovered', 'unknown'].map(key => summarise(rows.filter(row => row.readinessBand === key), key, minGroup));
  const repGroups = ['low reps', 'mid reps', 'high reps'].map(key => summarise(rows.filter(row => row.repBand === key), key, minGroup));
  const contextGroups = ['felt strong', 'felt taxed', 'no signal'].map(key => summarise(rows.filter(row => row.contextBand === key), key, minGroup));
  const bestReadiness = bestGroup(readinessGroups);
  const bestRepRange = bestGroup(repGroups);
  const bestContext = bestGroup(contextGroups);
  const latest = exposures[exposures.length - 1] || null;
  const latestReadinessValue = latest ? latestReadiness(readinessLog, latest.session.dateISO) : null;
  const latestRow = rows[rows.length - 1] || null;
  const enough = rows.length >= Math.max(1, Number(minimumTransitions) || FINGERPRINT_MIN_TRANSITIONS);
  const latestBand = readinessBand(latestReadinessValue, threshold);
  const cue = !enough
    ? 'collecting'
    : latestBand === 'under-recovered'
      ? 'hold'
      : latestRow?.changePct >= 0.02 || (bestReadiness?.key === 'ready' && bestReadiness.meanChangePct >= 0.02)
        ? 'push'
        : 'hold';

  return {
    exerciseId,
    transitions: rows.length,
    minimumTransitions: Math.max(1, Number(minimumTransitions) || FINGERPRINT_MIN_TRANSITIONS),
    status: enough ? 'ready' : 'collecting',
    cue,
    latest: latest ? {
      dateISO: latest.session.dateISO,
      reps: latest.best.reps,
      score: latest.best.score,
      readinessScore: latestReadinessValue?.score ?? null,
      readinessBand: latestBand,
      contextBand: contextBand(latest.session),
    } : null,
    readiness: readinessGroups,
    repRange: repGroups,
    context: contextGroups,
    bestReadiness,
    bestRepRange,
    bestContext,
    note: 'Descriptive association from your logged transitions; it is a cue, not a guarantee or causal claim.',
  };
}

