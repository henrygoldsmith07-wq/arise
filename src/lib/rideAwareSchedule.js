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

/**
 * Best weekdays for `count` upper-body sessions around key rides: never on a
 * ride day, fewest on the day before, and spread so no two lifts are adjacent
 * when possible. Deterministic (Mon-first tie-break). Returns weekdays 0=Sun…6=Sat.
 */
export function suggestLiftDays(rideDays, count = 3){
  const rides = new Set(normaliseRideDays(rideDays));
  const n = Math.max(0, Math.min(Math.floor(Number(count)) || 0, 7));
  const order = [1, 2, 3, 4, 5, 6, 0];
  const cost = d => (rides.has(d) ? 100 : 0) + (rides.has((d + 1) % 7) ? 3 : 0) + (rides.has((d + 6) % 7) ? 1 : 0);
  const chosen = [];
  while(chosen.length < n){
    let best = null, bestScore = Infinity;
    for(const d of order){
      if(chosen.includes(d)) continue;
      const adj = chosen.filter(c => (c + 1) % 7 === d || (d + 1) % 7 === c).length;
      const s = cost(d) + adj * 5;
      if(s < bestScore){ best = d; bestScore = s; }
    }
    if(best === null) break;
    chosen.push(best);
  }
  return chosen.sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/**
 * Ride-vs-lift overlay: for each of the last `weeks` Monday-start weeks, how
 * many logged sessions were lifting days, how many leg sets were done on a key
 * ride day or the day before (the clash that hurts rides), and the total.
 * Pure; returns [] without ride days or history. Newest week last.
 */
export function rideLiftOverlay(history, rideDays, { weeks = 4, todayISO = null } = {}){
  const days = normaliseRideDays(rideDays);
  if(!days.length || !Array.isArray(history) || !history.length) return [];
  const mondayOf = iso => { const w = weekday(iso); return toISO(toMs(iso) - ((w + 6) % 7) * DAY); };
  const latest = todayISO || history.map(h => h.dateISO).filter(Boolean).sort().pop();
  if(!latest) return [];
  const thisMon = toMs(mondayOf(latest));
  const out = [];
  for(let i = weeks - 1; i >= 0; i--){
    const start = thisMon - i * 7 * DAY;
    const end = start + 7 * DAY;
    const row = { weekStart: toISO(start), liftDays: 0, legSets: 0, clashLegSets: 0, rideDays: days.length };
    const lifted = new Set();
    for(const h of history){
      const t = h.dateISO ? toMs(h.dateISO) : NaN;
      if(!(t >= start && t < end)) continue;
      lifted.add(h.dateISO);
      const clash = rideClash(h.dateISO, days);
      for(const b of h.blocks || []){
        if(!LOWER.has(EXERCISE_BY_ID[b.exerciseId]?.muscle)) continue;
        const n = (b.sets || []).length;
        row.legSets += n;
        if(clash) row.clashLegSets += n;
      }
    }
    row.liftDays = lifted.size;
    out.push(row);
  }
  return out;
}
