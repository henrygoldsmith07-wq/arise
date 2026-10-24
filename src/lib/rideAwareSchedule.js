// rideAwareSchedule.js — keep leg work off the day before a key ride.
//
// Henry-type riders: a heavy leg block the day before a race or hard ride
// costs the ride. The rider marks key ride weekdays (0=Sun…6=Sat); we flag
// any not-yet-done session that has a lower-body block on a key ride day or
// the day before, and can move it to the nearest clear day. Pure, offline.
import { EXERCISE_BY_ID } from './data.js';

const DAY = 86400000;
const LOWER = new Set(['Legs', 'Glutes']);
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const toMs = iso => Date.parse(`${iso}T00:00:00Z`);
const toISO = ms => new Date(ms).toISOString().slice(0, 10);
const weekday = iso => new Date(toMs(iso)).getUTCDay();

export function normaliseRideDays(days){
  return [...new Set((Array.isArray(days) ? days : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
}

export function hasLegWork(session){
  return (session?.blocks || []).some(b => LOWER.has(EXERCISE_BY_ID[b.exerciseId]?.muscle));
}

/** Is `iso` a key ride day, or the day before one? */
export function rideClash(iso, rideDays){
  const set = new Set(normaliseRideDays(rideDays));
  if(!set.size) return null;
  if(set.has(weekday(iso))) return 'ride-day';
  if(set.has(weekday(toISO(toMs(iso) + DAY)))) return 'day-before';
  return null;
}

/** Sessions still to do whose leg work lands on/before a key ride. */
export function rideConflicts(schedule, rideDays){
  if(!schedule?.sessions?.length) return [];
  return schedule.sessions
    .filter(s => s.status !== 'done' && hasLegWork(s))
    .map(s => ({ session: s, clash: rideClash(s.dateISO, rideDays) }))
    .filter(c => c.clash);
}

/**
 * Move each conflicting session to the nearest clear date (searching up to 3
 * days either side, later first), never onto a date another session holds and
 * never into the past (>= todayISO). Order of sessions is kept by date.
 * Returns { schedule, moved:[{id,from,to}], stuck:[id] }.
 */
export function applyRideAwareDates(schedule, rideDays, { todayISO = '0000-00-00' } = {}){
  const days = normaliseRideDays(rideDays);
  if(!schedule?.sessions?.length || !days.length) return { schedule, moved: [], stuck: [] };
  const taken = new Set(schedule.sessions.map(s => s.dateISO));
  const moved = [], stuck = [];
  const next = schedule.sessions.map(s => ({ ...s }));
  for(const s of next){
    if(s.status === 'done' || !hasLegWork(s) || !rideClash(s.dateISO, days)) continue;
    let target = null;
    for(const off of [1, -1, 2, -2, 3, -3]){
      const cand = toISO(toMs(s.dateISO) + off * DAY);
      if(cand < todayISO || taken.has(cand) || rideClash(cand, days)) continue;
      target = cand; break;
    }
    if(!target){ stuck.push(s.id); continue; }
    taken.delete(s.dateISO); taken.add(target);
    moved.push({ id: s.id, from: s.dateISO, to: target });
    s.dateISO = target;
  }
  next.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  return { schedule: { ...schedule, sessions: next, rev: (schedule.rev || 0) + (moved.length ? 1 : 0), updatedAt: moved.length ? new Date().toISOString() : schedule.updatedAt }, moved, stuck };
}
