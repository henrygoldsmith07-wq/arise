// xp.js — Arise Level/XP: the motivational progression layer.
//
// This is gamification and is described as such: XP rewards training
// BEHAVIOURS Arise can actually observe (showing up, completing planned work,
// logging well, coming back after a break) — it never claims to measure
// physical fitness. The honest performance story lives in performance.js.
//
// XP is derived, never persisted: every award is recomputed from history and
// the schedule, so there is no ledger to corrupt and old data is immediately
// worth the same as new. Awards carry their own reason strings — the UI shows
// why each point was earned.

const LEVEL_STEP_XP = 250;

export const XP_SOURCES = Object.freeze({
  sessionCompleted: { xp: 20, label: 'Completed a planned workout' },
  unplannedSession: { xp: 15, label: 'Logged a workout' },
  weekCompleted: { xp: 30, label: 'Completed a full programme week' },
  perfectWeek: { xp: 25, label: 'Did every planned session in a week' },
  fullLogging: { xp: 5, label: 'Logged loads and reps on every set' },
  returnedAfterBreak: { xp: 10, label: 'Came back after a break' },
  consistencyRun: { xp: 15, label: 'Three straight planned sessions' },
});

// Gentle, explainable curve: level N starts at 250·(N−1)·N/2 total XP.
export function xpForLevel(level){
  return LEVEL_STEP_XP * (level - 1) * level / 2;
}

export function levelForXp(totalXp){
  let level = 1;
  while(level < 60 && totalXp >= xpForLevel(level + 1)) level++;
  const start = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return {
    level,
    title: levelTitle(level),
    xpIntoLevel: totalXp - start,
    xpForNext: next - start,
    totalXp,
  };
}

function levelTitle(level){
  if(level >= 40) return 'Veteran';
  if(level >= 30) return 'Seasoned';
  if(level >= 20) return 'Committed';
  if(level >= 12) return 'Steady';
  if(level >= 6) return 'Building';
  return 'Starting out';
}

function dayDiff(aISO, bISO){
  return (Date.parse(`${bISO}T00:00:00Z`) - Date.parse(`${aISO}T00:00:00Z`)) / 86400000;
}

function sessionIsPlanned(session, schedule){
  if(!schedule?.sessions?.length) return false;
  return schedule.sessions.some((s)=> s.id === session.id || (s.title === session.title && s.dateISO === session.dateISO));
}

function fullyLogged(session){
  const sets = (session.blocks || []).flatMap((b)=> b.sets || []);
  return sets.length > 0 && sets.every((s)=> Number(String(s.reps ?? '').match(/\d+/)?.[0]) > 0 && s.weightKg != null && String(s.weightKg).trim() !== '');
}

// Every XP award, oldest first, each with the reason it exists. Derived from
// history + schedule only: deterministic, replayable, and honest about what
// was observed (a logged workout) versus what was planned (the schedule).
export function xpAwards({ history = [], schedule = null } = {}){
  const sessions = [...history]
    .filter((s)=> s?.dateISO && !s.deletedAt)
    .sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));
  const awards = [];
  const dates = sessions.map((s)=> s.dateISO);
  const plannedDates = new Set((schedule?.sessions || []).filter((s)=> s.status === 'done').map((s)=> s.dateISO));

  let priorDate = null;
  let run = 0;
  for(const session of sessions){
    const source = sessionIsPlanned(session, schedule) || plannedDates.has(session.dateISO)
      ? XP_SOURCES.sessionCompleted
      : XP_SOURCES.unplannedSession;
    awards.push({ ...source, why: session.title || 'Workout', dateISO: session.dateISO });

    if(fullyLogged(session)) awards.push({ ...XP_SOURCES.fullLogging, why: session.title || 'Workout', dateISO: session.dateISO });

    // Returning after 7+ quiet days is worth acknowledging — the habit is the
    // hard part, and the app should never guilt the gap itself.
    if(priorDate != null && dayDiff(priorDate, session.dateISO) >= 7){
      awards.push({ ...XP_SOURCES.returnedAfterBreak, why: `Back after ${Math.round(dayDiff(priorDate, session.dateISO))} days`, dateISO: session.dateISO });
    }

    run = priorDate != null && dayDiff(priorDate, session.dateISO) <= 10 ? run + 1 : 1;
    if(run % 3 === 0) awards.push({ ...XP_SOURCES.consistencyRun, why: 'Third straight training session', dateISO: session.dateISO });
    priorDate = session.dateISO;
  }

  // Whole-programme weeks: every session scheduled for a week that is done.
  for(const [week, weekDates] of programmeWeeks(schedule)){
    const done = weekDates.filter((d)=> dates.includes(d));
    if(weekDates.length && done.length === weekDates.length){
      awards.push({ ...XP_SOURCES.weekCompleted, why: `Week ${week} of the programme`, dateISO: done[done.length - 1] });
      awards.push({ ...XP_SOURCES.perfectWeek, why: `All ${weekDates.length} planned sessions in week ${week}`, dateISO: done[done.length - 1] });
    }
  }

  return awards.sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));
}

function programmeWeeks(schedule){
  const map = new Map();
  for(const s of schedule?.sessions || []){
    const week = s.week ?? 1;
    if(!map.has(week)) map.set(week, []);
    if(s.dateISO) map.get(week).push(s.dateISO);
  }
  return map;
}

// The complete derived state the UI renders: level, progress, recent awards
// (with reasons) and the next achievable milestone.
export function deriveXp({ history = [], schedule = null, milestones = null, recentCount = 4 } = {}){
  const awards = xpAwards({ history, schedule });
  const totalXp = awards.reduce((n, a)=> n + a.xp, 0);
  const level = levelForXp(totalXp);
  return {
    ...level,
    progressPct: level.xpForNext ? Math.round((level.xpIntoLevel / level.xpForNext) * 100) : 0,
    recent: awards.slice(-recentCount).reverse().map((a)=> ({ label: a.label, why: a.why, xp: a.xp, dateISO: a.dateISO })),
    totalAwards: awards.length,
    nextMilestone: milestones?.next || null,
    framing: 'XP reflects training habits Arise can see — showing up, completing planned work and logging well. It is motivation, not a measure of fitness.',
  };
}
