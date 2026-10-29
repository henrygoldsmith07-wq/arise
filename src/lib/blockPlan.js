// blockPlan.js — the "Block plan": see the whole block, week by week, and
// change it.
//
// The Train card shows one lift's next four weeks; nothing showed the BLOCK:
// how many sets each muscle gets in each week, which week is the deload, or
// what happens after the last materialised week. This module reads the
// active schedule into a weeks × days grid with weekly hard sets per muscle,
// lets the lifter turn any week into a deload (or back), add another week
// when the block runs out, and flags build weeks whose volume looks high.
//
// Data model (lives ON the schedule, so export / sync / cross-tab carry it):
//
//   activeSchedule.blockPlan = {
//     version: 1,
//     deload:   { [week]: true | false },     // explicit choice; absent = programme default
//     cuts:     { [sessionId]: [sets…] },     // pre-cut set counts so "Make normal" restores exactly
//     extended: [weekNumber…],                // weeks the lifter added
//     updatedAt: ISO,
//   }
//
// Every operation is pure: (schedule, …) → { schedule, error }. On an error
// the input schedule is returned unchanged. Finished sessions are never
// rewritten. Volume is "direct hard sets by each exercise's main muscle": a
// planning guide, not a measurement (indirect work is not counted).

import { EXERCISE_BY_ID, PROGRAM_BY_ID } from './data.js';
import { resolveArisePriors } from './priors.js';
import { predictSessionDuration } from './warmup.js';
import { mondayKeyISO } from './dateOnly.js';

export const BLOCK_PLAN_VERSION = 1;
export const MAX_BLOCK_WEEKS = 12;

// Rough weekly guide per muscle (direct sets). Honest framing: dose-response
// work points to "more sets, more growth, diminishing returns" with wide
// individual variation — these are conservative planning bounds, not an
// optimum (confidence: low).
export const VOLUME_GUIDE = Object.freeze({ low: 6, high: 20 });
const GUIDED_MUSCLES = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Glutes'];
const DAY_MS = 86400000;

const isDone = (s)=> s?.status === 'done';
const toMs = (iso)=> Date.parse(`${iso}T00:00:00Z`);
const toISO = (ms)=> new Date(ms).toISOString().slice(0, 10);
const obj = (v)=> (v && typeof v === 'object' ? v : {});

function plan(schedule){
  const p = schedule?.blockPlan;
  return { version: BLOCK_PLAN_VERSION, deload: obj(p?.deload), cuts: obj(p?.cuts), extended: Array.isArray(p?.extended) ? p.extended : [] };
}

function commit(schedule, sessions, blockPlan){
  const now = new Date().toISOString();
  const clean = { ...blockPlan, updatedAt: now };
  const next = { ...schedule, sessions, rev: (Number(schedule.rev) || 0) + 1, updatedAt: now };
  if(Object.keys(clean.deload).length || Object.keys(clean.cuts).length || clean.extended.length) next.blockPlan = clean; else delete next.blockPlan;
  return next;
}

function programmeDeloadWeek(schedule){
  const meso = schedule?.mesocycle || PROGRAM_BY_ID[schedule?.programId]?.mesocycle || null;
  return meso?.deloadWeek ?? null;
}

// ── Reading ─────────────────────────────────────────────────────────────

// Is `week` a deload? Explicit user choice wins; otherwise the weekly review's
// own cuts (≥ half the blocks stamped weekly-deload) or the programme's
// declared deload week. Returns { deload, source }.
export function weekDeloadState(schedule, week){
  const p = plan(schedule);
  if(p.deload[week] === true) return { deload: true, source: 'you' };
  if(p.deload[week] === false) return { deload: false, source: null };
  const blocks = (schedule?.sessions || []).filter(s=> s.week === week).flatMap(s=> s.blocks || []).filter(b=> Number(b.sets) > 0);
  const stamped = blocks.filter(b=> b.adaptation?.kind === 'weekly-deload').length;
  if(blocks.length && stamped >= Math.ceil(blocks.length / 2)) return { deload: true, source: 'review' };
  if(programmeDeloadWeek(schedule) != null && week === programmeDeloadWeek(schedule)) return { deload: true, source: 'programme' };
  return { deload: false, source: null };
}

export function setsByMuscle(sessions){
  const out = {};
  for(const s of sessions || []){
    for(const b of s.blocks || []){
      const muscle = EXERCISE_BY_ID[b.exerciseId]?.muscle;
      const sets = Number(b.sets) || 0;
      if(!muscle || muscle === 'Cardio' || sets <= 0) continue;
      out[muscle] = (out[muscle] || 0) + sets;
    }
  }
  return out;
}

// Weeks × days view-model. `todayISO` marks the current week.
export function planWeeks(schedule, todayISO = null){
  const sessions = schedule?.sessions || [];
  if(!sessions.length) return [];
  const p = plan(schedule);
  const weeks = [...new Set(sessions.map(s=> s.week).filter(w=> w != null))].sort((a, b)=> a - b);
  return weeks.map(week=> {
    const list = sessions
      .filter(s=> s.week === week)
      .sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));
    const state = weekDeloadState(schedule, week);
    const byMuscle = setsByMuscle(list);
    const upcoming = list.filter(s=> !isDone(s)).length;
    return {
      week,
      deload: state.deload,
      deloadSource: state.source,
      extended: p.extended.includes(week),
      current: Boolean(todayISO && list.some(s=> mondayKeyISO(s.dateISO) === mondayKeyISO(todayISO))),
      sessions: list.map(s=> ({
        id: s.id,
        title: s.title || 'Session',
        dateISO: s.dateISO,
        status: isDone(s) ? 'done' : 'planned',
        sets: (s.blocks || []).reduce((n, b)=> n + (Number(b.sets) || 0), 0),
        minutes: predictSessionDuration(s.blocks || []),
      })),
      totalSets: Object.values(byMuscle).reduce((a, b)=> a + b, 0),
      byMuscle,
      upcoming,
      locked: upcoming === 0,
    };
  });
}

// Volume flags: build weeks whose direct sets for a muscle exceed the guide.
// Low volume is deliberately NOT flagged: it is often the right call (legs
// capped around cycling), so the bars show it and nothing nags.
export function volumeFlags(weeks){
  const flags = [];
  for(const w of weeks || []){
    if(w.deload) continue;
    for(const m of GUIDED_MUSCLES){
      const n = w.byMuscle[m] || 0;
      if(n > VOLUME_GUIDE.high) flags.push({ week: w.week, muscle: m, sets: n, kind: 'high', message: `${m}: ${n} sets in week ${w.week} is above ~${VOLUME_GUIDE.high}. Trim if recovery drags.` });
    }
  }
  return flags;
}

// Bar tone for a muscle's weekly sets.
export function muscleTone(muscle, sets){
  if(!GUIDED_MUSCLES.includes(muscle)) return 'neutral';
  return sets > VOLUME_GUIDE.high ? 'high' : sets < VOLUME_GUIDE.low ? 'low' : 'ok';
}

// ── Deload toggle ───────────────────────────────────────────────────────

function previousBuildSets(sessions, session, exerciseId, schedule){
  for(let w = session.week - 1; w >= 1; w--){
    if(weekDeloadState(schedule, w).deload) continue;
    const match = sessions.find(s=> s.week === w && String(s.day) === String(session.day) && s.id !== session.id);
    const block = match?.blocks?.find(b=> b.exerciseId === exerciseId);
    if(block) return Number(block.sets) || null;
  }
  return null;
}

export function setWeekDeload(schedule, week, on, { programmed = false } = {}){
  const sessions = schedule?.sessions || [];
  const inWeek = sessions.filter(s=> s.week === week);
  if(!inWeek.length) return { schedule, error: 'That week is not in this block.' };
  const targets = inWeek.filter(s=> !isDone(s));
  if(!targets.length) return { schedule, error: 'That week is already finished.' };
  const p = plan(schedule);
  if(Boolean(on) === weekDeloadState(schedule, week).deload && p.deload[week] === Boolean(on)) return { schedule, error: null, unchanged: true };
  const cuts = { ...p.cuts };
  const cutFactor = resolveArisePriors(null).recovery.deloadVolumeCut;
  const byId = new Map();
  for(const s of targets){
    if(on){
      if(!cuts[s.id]) cuts[s.id] = (s.blocks || []).map(b=> Number(b.sets) || 0);
      const reason = `${programmed ? 'Programmed deload week' : 'Deload week you chose in Block plan'}: volume cut about ${Math.round((1 - cutFactor) * 100)}%.`;
      const blocks = (s.blocks || []).map((b, i)=> {
        if((Number(b.sets) || 0) <= 1) return b;
        return { ...b, sets: Math.max(1, Math.round((cuts[s.id][i] || b.sets) * cutFactor)), why: reason, adaptation: { kind: 'weekly-deload', reason, basisKey: 'plan:deload' } };
      });
      byId.set(s.id, { ...s, blocks });
    } else {
      const saved = cuts[s.id];
      const blocks = (s.blocks || []).map((b, i)=> {
        const stamped = b.adaptation?.kind === 'weekly-deload';
        let restored = null;
        if(saved && Number.isFinite(saved[i]) && saved[i] > 0) restored = saved[i];
        else if(stamped) restored = previousBuildSets(sessions, s, b.exerciseId, schedule);
        const out = { ...b };
        if(restored != null) out.sets = restored;
        if(stamped){ delete out.adaptation; delete out.why; }
        return out;
      });
      delete cuts[s.id];
      byId.set(s.id, { ...s, blocks });
    }
  }
  const next = commit(schedule, sessions.map(s=> byId.get(s.id) || s), { ...p, deload: { ...p.deload, [week]: Boolean(on) }, cuts });
  return { schedule: next, error: null };
}

// ── Extend the block ────────────────────────────────────────────────────

export function lastBuildWeek(schedule){
  const weeks = planWeeks(schedule);
  for(let i = weeks.length - 1; i >= 0; i--) if(!weeks[i].deload) return weeks[i].week;
  return weeks.length ? weeks[weeks.length - 1].week : null;
}

// Add one more week after the last: a copy of the latest non-deload week, same
// weekdays, planned, with per-session coaching stamps stripped (the engine
// re-prescribes loads from history). Progressive load is the engine's job.
export function extendBlock(schedule){
  const sessions = schedule?.sessions || [];
  if(!sessions.length) return { schedule, error: 'No active programme.' };
  const weeks = planWeeks(schedule);
  const lastWeek = weeks[weeks.length - 1].week;
  if(weeks.length >= MAX_BLOCK_WEEKS) return { schedule, error: `A block can hold at most ${MAX_BLOCK_WEEKS} weeks.` };
  const sourceWeek = lastBuildWeek(schedule);
  const source = sessions.filter(s=> s.week === sourceWeek).sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));
  if(!source.length) return { schedule, error: 'Nothing to copy.' };
  const newWeek = lastWeek + 1;
  const latest = sessions.reduce((m, s)=> (s.dateISO > m ? s.dateISO : m), '');
  const srcLast = source[source.length - 1].dateISO;
  // Shift so the copy lands after everything already planned, keeping weekdays.
  let shiftDays = 7;
  while(toMs(srcLast) + shiftDays * DAY_MS <= toMs(latest)) shiftDays += 7;
  const p = plan(schedule);
  const sourceCut = weekDeloadState(schedule, sourceWeek).deload;
  const added = source.map((s, si)=> {
    const blocks = (s.blocks || []).map((b, i)=> {
      const out = { ...b };
      delete out.adaptation; delete out.why; delete out.substitutionFrom; delete out.substitutionReason; delete out.warmups;
      const saved = p.cuts[s.id];
      if(sourceCut && saved && saved[i] > 0) out.sets = saved[i];
      return out;
    });
    return {
      ...s,
      id: `${s.programId}-w${newWeek}-d${s.day ?? si + 1}`,
      week: newWeek,
      dateISO: toISO(toMs(s.dateISO) + shiftDays * DAY_MS),
      status: 'planned',
      blocks,
      extendedFrom: s.id,
    };
  });
  const taken = new Set(sessions.map(s=> s.id));
  for(const a of added) if(taken.has(a.id)) a.id = `${a.id}-x${newWeek}`;
  let next = commit(schedule, [...sessions, ...added], { ...p, extended: [...p.extended, newWeek] });
  // The programme's own deload week is applied for real when it is reached,
  // so the grid and the volume figures show what Gym Mode will prescribe.
  if(programmeDeloadWeek(next) === newWeek && plan(next).deload[newWeek] === undefined){
    const cut = setWeekDeload(next, newWeek, true, { programmed: true });
    if(!cut.error) next = cut.schedule;
  }
  return { schedule: next, error: null, week: newWeek, added: added.length };
}

export function canRemoveWeek(schedule){
  const weeks = planWeeks(schedule);
  const last = weeks[weeks.length - 1];
  return Boolean(last && last.extended && last.upcoming === last.sessions.length && weeks.length > 1);
}

// Remove the most recently added week (only a week the lifter added, with no
// finished sessions).
export function removeExtendedWeek(schedule){
  if(!canRemoveWeek(schedule)) return { schedule, error: 'Only a week you added, with nothing finished, can be removed.' };
  const weeks = planWeeks(schedule);
  const last = weeks[weeks.length - 1].week;
  const p = plan(schedule);
  const gone = new Set((schedule.sessions || []).filter(s=> s.week === last).map(s=> s.id));
  const cuts = { ...p.cuts };
  for(const id of gone) delete cuts[id];
  const deload = { ...p.deload };
  delete deload[last];
  const next = commit(schedule, schedule.sessions.filter(s=> !gone.has(s.id)), { ...p, deload, cuts, extended: p.extended.filter(w=> w !== last) });
  return { schedule: next, error: null, week: last };
}
