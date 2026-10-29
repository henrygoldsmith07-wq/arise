// liftGoals.js — "100 kg × 8 on lat pulldown by 20 Dec": a target per lift and
// an honest read on whether the current trend gets there. Pure and local-first.
//
// Storage: gymPrefs.liftGoals[exerciseId] = { kg, reps, deadlineISO?, createdAt,
// updatedAt, deleted? }. Removing a goal keeps a `{ deleted:true, updatedAt }`
// tombstone so the removal wins a sync/import merge against an older copy.
//
// Honesty rules: a goal is "hit" only by a real logged set at/above the target
// load for the target reps (never by an estimate). The projection is a straight
// line through recent per-session best e1RM; with too little or too flat data it
// says so instead of inventing a date.
import { e1rm, parseReps } from './trainingMath.js';

const MAX_GOALS = 60;
const MIN_KG = 1, MAX_KG = 1000, MAX_REPS = 30;
const WINDOW_DAYS = 84; // trend window: the last 12 weeks
const MIN_POINTS = 3, MIN_SPAN_DAYS = 14;
const MAX_ETA_DAYS = 730;
const MIN_RISE_PER_WEEK = 0.1; // kg of e1RM a week; below this the trend counts as flat
const DAY = 86400000;

const iso = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const dayMs = (d) => Date.parse(`${d}T12:00:00Z`);
const addDays = (d, n) => new Date(dayMs(d) + n * DAY).toISOString().slice(0, 10);

/** Normalise one stored goal; null when it is not usable. */
export function sanitizeGoal(raw){
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const updatedAt = iso(raw.updatedAt) || new Date(0).toISOString();
  if(raw.deleted === true) return { deleted: true, updatedAt };
  const kg = Math.round(Number(raw.kg) * 100) / 100;
  const reps = Math.round(Number(raw.reps));
  if(!(kg >= MIN_KG && kg <= MAX_KG) || !(reps >= 1 && reps <= MAX_REPS)) return null;
  const out = { kg, reps, createdAt: iso(raw.createdAt) || updatedAt, updatedAt };
  const deadline = day(raw.deadlineISO);
  if(deadline) out.deadlineISO = deadline;
  return out;
}

/** Clean a whole liftGoals map (hydration / import). */
export function sanitizeLiftGoals(raw){
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  let n = 0;
  for(const id of Object.keys(raw)){
    if(n >= MAX_GOALS) break;
    if(!/^[\w.\-:]{1,80}$/.test(id)) continue;
    const g = sanitizeGoal(raw[id]);
    if(!g) continue;
    out[id] = g;
    n++;
  }
  return out;
}

/** The live goal for a lift, or null (none, or removed). */
export function getLiftGoal(gymPrefs, exerciseId){
  const g = sanitizeGoal(gymPrefs?.liftGoals?.[exerciseId]);
  return g && !g.deleted ? g : null;
}

/** Every live goal as [{ exerciseId, ...goal }], newest first. */
export function listLiftGoals(gymPrefs){
  const map = sanitizeLiftGoals(gymPrefs?.liftGoals);
  return Object.keys(map)
    .filter((id) => !map[id].deleted)
    .map((id) => ({ exerciseId: id, ...map[id] }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.exerciseId.localeCompare(b.exerciseId));
}

/**
 * gymPrefs patch that sets a goal. Returns { patch } or { error }. A deadline
 * must be a future date; an unchanged save keeps the old timestamps so a no-op
 * never wins a sync merge.
 */
export function setLiftGoal(gymPrefs, exerciseId, { kg, reps, deadlineISO = null } = {}, nowISO = new Date().toISOString(), todayISO = nowISO.slice(0, 10)){
  if(!/^[\w.\-:]{1,80}$/.test(String(exerciseId || ''))) return { error: 'Pick a lift first.' };
  const k = Number(kg), r = Math.round(Number(reps));
  if(!(k >= MIN_KG && k <= MAX_KG)) return { error: `Target load must be between ${MIN_KG} and ${MAX_KG} kg.` };
  if(!(r >= 1 && r <= MAX_REPS)) return { error: `Target reps must be between 1 and ${MAX_REPS}.` };
  const deadline = deadlineISO ? day(deadlineISO) : null;
  if(deadlineISO && !deadline) return { error: 'Use a real date for the deadline.' };
  if(deadline && deadline <= todayISO) return { error: 'Pick a deadline after today.' };
  const prevMap = sanitizeLiftGoals(gymPrefs?.liftGoals);
  const prev = prevMap[exerciseId];
  const next = { kg: Math.round(k * 100) / 100, reps: r, createdAt: nowISO, updatedAt: nowISO };
  if(deadline) next.deadlineISO = deadline;
  if(prev && !prev.deleted && prev.kg === next.kg && prev.reps === next.reps && (prev.deadlineISO || null) === (next.deadlineISO || null)){
    return { patch: { liftGoals: prevMap } };
  }
  // Re-targeting an existing goal keeps its start date so milestones stay put.
  if(prev && !prev.deleted) next.createdAt = prev.createdAt;
  return { patch: { liftGoals: { ...prevMap, [exerciseId]: next }, updatedAt: nowISO } };
}

export function clearLiftGoal(gymPrefs, exerciseId, nowISO = new Date().toISOString()){
  const prevMap = sanitizeLiftGoals(gymPrefs?.liftGoals);
  if(!prevMap[exerciseId] || prevMap[exerciseId].deleted) return { liftGoals: prevMap };
  return { liftGoals: { ...prevMap, [exerciseId]: { deleted: true, updatedAt: nowISO } }, updatedAt: nowISO };
}

const stamp = (g) => Date.parse(g?.updatedAt || '') || 0;
const body = (g) => JSON.stringify([g?.deleted ? 1 : 0, g?.kg ?? '', g?.reps ?? '', g?.deadlineISO ?? '']);

/** Deterministic merge: per lift the newer updatedAt wins; ties break on content. */
export function mergeLiftGoals(a, b){
  const left = sanitizeLiftGoals(a), right = sanitizeLiftGoals(b);
  const out = {};
  for(const id of new Set([...Object.keys(left), ...Object.keys(right)])){
    const x = left[id], y = right[id];
    if(!x || !y){ out[id] = x || y; continue; }
    const tx = stamp(x), ty = stamp(y);
    out[id] = tx !== ty ? (tx > ty ? x : y) : (body(x) >= body(y) ? x : y);
  }
  return out;
}

/** Sets of one lift per session: [{ dateISO, sets:[{ kg, reps }] }], oldest first. */
function liftSessions(history, exerciseId){
  const out = [];
  for(const sess of Array.isArray(history) ? history : []){
    if(!sess || sess.deletedAt || !day(sess.dateISO)) continue;
    const sets = [];
    for(const block of sess.blocks || []){
      if(block?.exerciseId !== exerciseId) continue;
      for(const s of block.sets || []){
        if(!s || s.failed || s.skipped) continue;
        const kg = Number(s.weightKg), reps = parseReps(s.reps);
        if(kg > 0 && reps > 0) sets.push({ kg, reps });
      }
    }
    if(sets.length) out.push({ dateISO: sess.dateISO, sets });
  }
  return out.sort((x, y) => x.dateISO.localeCompare(y.dateISO));
}

/** Best estimated 1RM per session for a lift: [{ dateISO, e1rm }], oldest first. */
export function e1rmSeries(history, exerciseId){
  return liftSessions(history, exerciseId)
    .map((s) => ({ dateISO: s.dateISO, e1rm: Math.max(...s.sets.map((x) => e1rm(x.kg, x.reps))) }))
    .filter((p) => p.e1rm > 0);
}

/** First session with a real set at/above the goal (load and reps), or null. */
export function goalHitOn(history, exerciseId, goal){
  if(!goal) return null;
  for(const s of liftSessions(history, exerciseId)){
    if(s.dateISO < String(goal.createdAt || '').slice(0, 10)) continue;
    if(s.sets.some((x) => x.kg >= goal.kg && x.reps >= goal.reps)) return s.dateISO;
  }
  return null;
}

function fitLine(points){
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.x, 0) / n, my = points.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0, sxy = 0;
  for(const p of points){ sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); }
  if(sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/**
 * Where a goal stands. status:
 *  hit      a real set reached the target (hitDate set)
 *  ahead    trend reaches it with 2+ weeks to spare before the deadline
 *  on-track trend reaches it by the deadline (or, with no deadline, it is rising)
 *  behind   trend misses the deadline, or is flat/falling with a deadline
 *  flat     no deadline and the trend is not rising: no ETA is claimed
 *  no-data  fewer than 3 sessions over 2 weeks in the last 12 weeks
 */
export function projectGoal(history, exerciseId, goal, todayISO){
  const targetE1rm = e1rm(goal.kg, goal.reps);
  const series = e1rmSeries(history, exerciseId);
  const best = series.reduce((m, p) => Math.max(m, p.e1rm), 0);
  const current = series.length ? series[series.length - 1].e1rm : 0;
  const startE1rm = (() => {
    const from = String(goal.createdAt || '').slice(0, 10);
    const first = series.find((p) => p.dateISO >= from) || series[0];
    return first ? Math.min(first.e1rm, best) : 0;
  })();
  const span = Math.max(0, targetE1rm - startE1rm);
  const fraction = (v) => (span > 0 ? Math.max(0, Math.min(1, (v - startE1rm) / span)) : v >= targetE1rm ? 1 : 0);
  const milestones = [0.25, 0.5, 0.75, 1].map((f) => ({ pct: f * 100, e1rm: Math.round((startE1rm + span * f) * 10) / 10, reached: best >= startE1rm + span * f - 1e-9 && best > 0 }));
  const base = { targetE1rm: Math.round(targetE1rm * 10) / 10, currentE1rm: Math.round(current * 10) / 10, bestE1rm: Math.round(best * 10) / 10, progress: fraction(best), milestones, hitDate: null, etaISO: null, daysLeft: null, perWeekKg: null };

  const hitDate = goalHitOn(history, exerciseId, goal);
  if(hitDate) return { ...base, status: 'hit', hitDate, progress: 1 };

  const windowStart = addDays(todayISO, -WINDOW_DAYS);
  const recent = series.filter((p) => p.dateISO >= windowStart && p.dateISO <= todayISO);
  const t0 = recent.length ? dayMs(recent[0].dateISO) : 0;
  const spanDays = recent.length ? (dayMs(recent[recent.length - 1].dateISO) - t0) / DAY : 0;
  if(recent.length < MIN_POINTS || spanDays < MIN_SPAN_DAYS) return { ...base, status: 'no-data' };

  const line = fitLine(recent.map((p) => ({ x: (dayMs(p.dateISO) - t0) / DAY, y: p.e1rm })));
  const perWeek = line ? Math.round(line.slope * 7 * 100) / 100 : 0;
  const rising = Boolean(line) && perWeek >= MIN_RISE_PER_WEEK;
  const deadline = goal.deadlineISO || null;
  let etaISO = null;
  if(rising){
    const todayX = (dayMs(todayISO) - t0) / DAY;
    const fromNow = Math.max(0, (targetE1rm - (line.intercept + line.slope * todayX)) / line.slope);
    if(fromNow <= MAX_ETA_DAYS) etaISO = addDays(todayISO, Math.ceil(fromNow));
  }
  const out = { ...base, perWeekKg: perWeek, etaISO, daysLeft: etaISO ? Math.round((dayMs(etaISO) - dayMs(todayISO)) / DAY) : null };
  if(!deadline) return { ...out, status: etaISO ? 'on-track' : 'flat' };
  if(!etaISO || etaISO > deadline) return { ...out, status: 'behind' };
  return { ...out, status: etaISO <= addDays(deadline, -14) ? 'ahead' : 'on-track' };
}

/**
 * Goals hit by a real set that the lifter has not yet been told about:
 * [{ exerciseId, goal, hitDate }]. `seen` is gymPrefs.liftGoalsSeen (map
 * exerciseId -> hitDate), so each hit nudges once.
 */
export function unseenGoalHits(history, gymPrefs){
  const seen = gymPrefs?.liftGoalsSeen && typeof gymPrefs.liftGoalsSeen === 'object' ? gymPrefs.liftGoalsSeen : {};
  const out = [];
  for(const g of listLiftGoals(gymPrefs)){
    const hitDate = goalHitOn(history, g.exerciseId, g);
    if(hitDate && seen[g.exerciseId] !== hitDate) out.push({ exerciseId: g.exerciseId, goal: g, hitDate });
  }
  return out;
}

/** gymPrefs patch marking a hit as seen. */
export function markGoalHitSeen(gymPrefs, exerciseId, hitDate){
  return { liftGoalsSeen: { ...(gymPrefs?.liftGoalsSeen || {}), [exerciseId]: hitDate } };
}

/** One plain line for the status. */
export function describeProjection(p, goal, unit = 'kg'){
  const when = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  switch(p.status){
    case 'hit': return `Hit on ${when(p.hitDate)}.`;
    case 'ahead': return `Ahead of plan: on pace for ${when(p.etaISO)}, before ${when(goal.deadlineISO)}.`;
    case 'on-track': return goal.deadlineISO ? `On track: on pace for ${when(p.etaISO)} (deadline ${when(goal.deadlineISO)}).` : `Rising about ${p.perWeekKg} ${unit} e1RM a week: on pace for ${when(p.etaISO)}.`;
    case 'behind': return p.etaISO ? `Behind: current pace reaches it ${when(p.etaISO)}, after ${when(goal.deadlineISO)}.` : `Behind: your recent trend is flat or falling, so this deadline is out of reach on current pace.`;
    case 'flat': return 'Not rising lately, so there is no honest date yet.';
    default: return 'Log this lift on 3 sessions over 2 weeks to see a projection.';
  }
}
