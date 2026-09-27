// Training-age and training-break policy helpers extracted from progression.js.
// These functions are pure and share the canonical UTC date-only boundary used
// by evidence/study code so a user's timezone cannot change an engine segment.

import { resolveArisePriors } from './priors.js';
import { DAY_MS, dateOnlyFromUTC, parseDateOnlyUTC } from './dateOnly.js';

export function trainingAgeMonths(history, { asOfDateISO = null, config = null } = {}){
  if(!history || !history.length) return 0;
  const end = asOfDateISO ? parseDateOnlyUTC(asOfDateISO) : Date.now();
  if(!Number.isFinite(end)) return 0;
  const dates = history
    .map(h=> parseDateOnlyUTC(h?.dateISO || ''))
    .filter(value=> Number.isFinite(value) && value <= end)
    .sort((a,b)=> a-b);
  if(!dates.length) return 0;
  return Math.max(0, (end - dates[0]) / (resolveArisePriors(config).progression.daysPerMonth * DAY_MS));
}

export function trainingPhase(months, { config = null } = {}){
  const cfg = resolveArisePriors(config).progression.trainingAge;
  if(months <= 0) return 'unknown';
  if(months < cfg.noviceMaxMonths) return 'novice';
  if(months < cfg.intermediateMaxMonths) return 'intermediate';
  return 'advanced';
}

export function ageRateMultiplier(months, { config = null } = {}){
  const cfg = resolveArisePriors(config).progression.trainingAge;
  if(months <= 0) return 1;
  if(months < cfg.noviceMaxMonths) return cfg.noviceMultiplier;
  if(months < cfg.intermediateMaxMonths) return cfg.intermediateMultiplier;
  return cfg.advancedMultiplier;
}

export function trainingAgeInfo(history, { asOfDateISO = null, config = null } = {}){
  const months = trainingAgeMonths(history, { asOfDateISO, config });
  return {
    months:Math.round(months * 10) / 10,
    phase:trainingPhase(months, { config }),
    multiplier:ageRateMultiplier(months, { config }),
  };
}

export function trainingBreakInfo(history, { asOfDateISO = null, config = null } = {}){
  const cfg = resolveArisePriors(config).progression.trainingAge;
  if(!asOfDateISO) return { hasBreak:false, daysSinceLast:null, longBreakDays:cfg.longBreakDays };
  const end = parseDateOnlyUTC(asOfDateISO);
  const dates = (history || [])
    .map(session=> parseDateOnlyUTC(session?.dateISO || ''))
    .filter(value=> Number.isFinite(value) && value <= end)
    .sort((a,b)=> a-b);
  if(!dates.length || !Number.isFinite(end)) return { hasBreak:false, daysSinceLast:null, longBreakDays:cfg.longBreakDays };
  const daysSinceLast = Math.max(0, Math.floor((end - dates[dates.length - 1]) / DAY_MS));
  return {
    hasBreak:daysSinceLast >= cfg.longBreakDays,
    daysSinceLast,
    longBreakDays:cfg.longBreakDays,
    lastSessionDateISO:dateOnlyFromUTC(dates[dates.length - 1]),
  };
}

export function shortBreakInfo(history, exerciseId, { asOfDateISO = null, config = null } = {}){
  const all = resolveArisePriors(config);
  const policy = all.progression.shortBreakPolicy || {};
  const longDays = all.progression.trainingAge.longBreakDays;
  if(!asOfDateISO || !policy.enabled) return { hasShortBreak:false, daysSince:null, multiplier:1 };
  const end = parseDateOnlyUTC(asOfDateISO);
  if(!Number.isFinite(end)) return { hasShortBreak:false, daysSince:null, multiplier:1 };
  const dates = (history || [])
    .filter(session=> (session.blocks || []).some(block=> block.exerciseId === exerciseId))
    .map(session=> parseDateOnlyUTC(session?.dateISO || ''))
    .filter(value=> Number.isFinite(value) && value <= end)
    .sort((a,b)=> a-b);
  if(!dates.length) return { hasShortBreak:false, daysSince:null, multiplier:1 };
  const daysSince = Math.max(0, Math.floor((end - dates[dates.length - 1]) / DAY_MS));
  const minDays = policy.minDays ?? 5;
  const moderateDays = policy.moderateDays ?? 14;
  if(daysSince >= longDays || daysSince < minDays) return { hasShortBreak:false, daysSince, multiplier:1 };
  const multiplier = daysSince >= moderateDays
    ? (policy.moderateLoadMultiplier ?? 0.9)
    : (policy.lightLoadMultiplier ?? 0.95);
  return { hasShortBreak:true, daysSince, multiplier };
}
