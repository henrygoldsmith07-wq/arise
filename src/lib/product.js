// product.js — the pure product-insight layer.
//
// Everything here is deterministic arithmetic over the store the user already
// owns: milestone progress, consistency chains, the monthly digest, the next
// best action, and "what changed and why" summaries. No storage access, no
// React, no wall-clock reads (the caller supplies `today`) — the same purity
// contract as the engine, so all of it is unit-testable and demo-safe.
//
// Tone rules for every string that leaves this module:
//   - never guilt ("you missed", "you broke your streak" do not appear);
//   - lapsed is a restart, not a failure ("fresh start" framing);
//   - numbers are shown with their basis, never as verdicts;
//   - nothing here ranks the user against other people — there is no "them".

/** Milestone ladder. Ordered; a milestone unlocks when its bar is reached. */
export const MILESTONES = [
  { id: 'first-session', sessions: 1, label: 'First session logged', emoji: '🎬' },
  { id: 'week-one', sessions: 3, label: 'Three sessions in', emoji: '🌱' },
  { id: 'ten', sessions: 10, label: 'Ten sessions — a habit forming', emoji: '🧗' },
  { id: 'twentyfive', sessions: 25, label: 'Twenty-five sessions', emoji: '⛰️' },
  { id: 'fifty', sessions: 50, label: 'Fifty sessions — half a year of showing up', emoji: '🏔️' },
  { id: 'hundred', sessions: 100, label: 'One hundred sessions', emoji: '🏛️' },
  { id: 'twohundred', sessions: 200, label: 'Two hundred sessions', emoji: '🌌' },
  { id: 'fivehundred', sessions: 500, label: 'Five hundred sessions', emoji: '🚀' },
];

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * Milestone state: which are reached, which is next, and how far away it is.
 * A history spanning months shows more reached milestones than a fresh one;
 * the ladder is deliberately session-count based (the one number that never
 * lies about showing up).
 */
export function milestoneState(history){
  const count = (history || []).length;
  const reached = MILESTONES.filter((m) => count >= m.sessions);
  const next = MILESTONES.find((m) => count < m.sessions) || null;
  const last = reached[reached.length - 1] || null;
  return {
    count,
    reached,
    last,
    next,
    toNext: next ? next.sessions - count : 0,
    pctToNext: next ? Math.min(100, Math.round((count / next.sessions) * 100)) : 100,
  };
}

/** Training age in months from the first logged session, with a phase label. */
export function trainingAgeDisplay(history, { today } = {}){
  const dates = (history || []).map((h) => h?.dateISO).filter(Boolean).sort();
  if(!dates.length || !today) return { months: null, started: null, phase: null };
  const months = daysBetween(dates[0], today) / 30.44;
  const phase = months < 3 ? 'New' : months < 12 ? 'Establishing' : months < 36 ? 'Committed' : 'Veteran';
  return { months: Math.max(0.1, Math.round(months * 10) / 10), started: dates[0], phase };
}

/**
 * Weekly consistency over the trailing `weeks` Monday-anchored weeks:
 * weeks with any session vs weeks elapsed. Designed for a "3 of the last
 * 4 weeks" display, never a guilt score. Ties to nothing, ranks against
 * nothing, compares to no one.
 */
export function consistencyInsights(history, { today, weeks = 6 } = {}){
  if(!today) return { weeksActive: 0, weeksElapsed: 0, rate: null, currentRunWeeks: 0 };
  const startMs = Date.parse(`${today}T00:00:00Z`);
  const monday = new Date(startMs - ((new Date(startMs).getUTCDay() + 6) % 7) * 86400000);
  const weekKeys = [];
  for(let i = weeks - 1; i >= 0; i--) weekKeys.push(new Date(monday.getTime() - i * 7 * 86400000).toISOString().slice(0, 10));
  const activeWeeks = new Set();
  for(const h of history || []){
    if(!h?.dateISO) continue;
    const d = Date.parse(`${h.dateISO}T00:00:00Z`);
    const wm = new Date(d - ((new Date(d).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    if(weekKeys.includes(wm)) activeWeeks.add(wm);
  }
  // Weeks the app could have known about: cap at the span since the first
  // session so a brand-new user is never shown a frightening denominator.
  const first = (history || []).map((h) => h?.dateISO).filter(Boolean).sort()[0] || today;
  const spanWeeks = Math.min(weeks, Math.max(1, Math.ceil(daysBetween(first, today) / 7) || 1));
  const counted = weekKeys.filter((w) => w >= new Date(Date.parse(`${first}T00:00:00Z`) - ((new Date(Date.parse(`${first}T00:00:00Z`)).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10));
  const weeksElapsed = Math.min(spanWeeks, counted.length);
  // Current run: consecutive active weeks ending this week or last week
  // (mid-week grace — Sunday does not "break" anything).
  let run = 0;
  for(let i = weekKeys.length - 1; i >= 0; i--){
    if(activeWeeks.has(weekKeys[i])) run++;
    else if(i === weekKeys.length - 1) continue; // this week still in progress
    else break;
  }
  return {
    weeksActive: activeWeeks.size,
    weeksElapsed,
    rate: weeksElapsed ? activeWeeks.size / weeksElapsed : null,
    currentRunWeeks: run,
  };
}

/**
 * The monthly digest: one calm paragraph of facts for the calendar month the
 * caller names (default: the month before the current one). Pure aggregation
 * over logged history; every line carries its basis.
 */
export function monthlyDigest(history, { today, byId = null, month = null } = {}){
  if(!today) return null;
  const anchor = month || (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  })();
  const sessions = (history || [])
    .filter((h) => typeof h?.dateISO === 'string' && h.dateISO.startsWith(`${anchor}-`))
    .sort((a, b) => String(a.dateISO).localeCompare(String(b.dateISO)));
  const volume = sessions.reduce((sum, s) => sum + (s.blocks || []).reduce((acc, b) => acc + (b.sets || []).reduce((a, st) => a + (Number(st.reps) || 0) * Math.max(0, (Number(st.weightKg) || 0) - (Number(st.assistedKg) || 0)), 0), 0), 0);
  const sets = sessions.reduce((a, s) => a + (s.blocks || []).reduce((acc, b) => acc + (b.sets || []).length, 0), 0);
  const muscles = {};
  if(byId){
    for(const s of sessions) for(const b of s.blocks || []){
      const m = byId[b.exerciseId]?.muscle;
      if(m) muscles[m] = (muscles[m] || 0) + 1;
    }
  }
  const topMuscle = Object.entries(muscles).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const minutes = sessions.reduce((a, s) => a + (Number(s.durationMinutes) || 0), 0);
  const notes = sessions.filter((s) => s.note).length;
  return {
    month: anchor,
    sessions: sessions.length,
    volume: Math.round(volume),
    sets,
    minutes,
    topMuscle,
    notes,
    first: sessions[0]?.dateISO || null,
    last: sessions[sessions.length - 1]?.dateISO || null,
  };
}

/**
 * Next best action: ONE recommendation for right now, deterministic, drawn
 * from the state the user already has. This is guidance, not a nag — the UI
 * renders it once and never counts down at anyone.
 */
export function nextBestAction({ store, today, todaySession, nextSess, recovery } = {}){
  const history = store?.history || [];
  if(!store?.onboarding) return { id: 'onboard', title: 'Set your goal and kit', detail: 'Two minutes of onboarding makes every recommendation honest — equipment, location, level.', tab: null };
  if(!store?.activeSchedule) return { id: 'choose-program', title: 'Choose a program', detail: 'A program becomes a dated schedule so you always know what is next.', tab: 'train' };
  if(todaySession) return { id: 'start-today', title: `Start ${todaySession.title}`, detail: 'Today’s session is ready — the runner walks you through every set.', tab: null };
  if(recovery?.needed) return { id: 'recover', title: 'Re-plan the schedule', detail: recovery.recommendation || 'The schedule can fold missed sessions forward — no debt, no guilt.', tab: null };
  if(nextSess) return { id: 'preview-next', title: `Up next: ${nextSess.title}`, detail: 'Skim the blocks now so the first set feels easy to start.', tab: null };
  const ms = milestoneState(history);
  if(ms.next) return { id: 'milestone', title: `${ms.toNext} sessions to “${ms.next.label}”`, detail: 'Every logged session moves the ladder.', tab: 'progress' };
  return { id: 'review', title: 'Review your week', detail: 'The Weekly Review turns your logs into next week’s plan.', tab: 'today' };
}

/**
 * "What changed and why": a human summary of the latest programme
 * adaptation plus the newest engine explanations. Pure formatting over
 * records the app already stores — it never invents a reason.
 */
export function whatChangedSummary({ schedule, history = [], limit = 3 } = {}){
  const out = [];
  const adaptation = schedule?.lastAdaptation;
  if(adaptation?.changes?.length){
    out.push({
      when: adaptation.dateISO,
      kind: 'programme',
      lines: adaptation.changes.slice(0, limit).map((c) => `${c.exerciseId}: ${c.reason}`),
    });
  }
  const latest = [...(history || [])].sort((a, b) => String(b.dateISO).localeCompare(String(a.dateISO)))[0];
  if(latest?.adaptationBasis?.length){
    out.push({ when: latest.dateISO, kind: 'session', lines: latest.adaptationBasis.slice(0, limit).map((b) => b.reason || String(b)) });
  }
  return out;
}

/**
 * Session-count streak with honest, healthy framing. Day-level streaks
 * punish rest days; a "weeks with training" run does not. Returned shape
 * powers both the Progress counter and the "no guilt" copy: a lapsed run
 * is reported as "best" plus "fresh start", never as a loss.
 */
export function healthyStreak(history, { today, weeks = 8 } = {}){
  const ci = consistencyInsights(history, { today, weeks });
  const totalSessions = (history || []).length;
  const best = Math.max(ci.currentRunWeeks, 0);
  return {
    currentWeeks: ci.currentRunWeeks,
    bestWeeks: best, // conservative: run-vs-run needs more state than a pure function has
    totalSessions,
    lapsed: ci.weeksElapsed > 0 && ci.currentRunWeeks === 0,
    framing: ci.currentRunWeeks > 0
      ? `${ci.currentRunWeeks} week${ci.currentRunWeeks === 1 ? '' : 's'} in a row`
      : 'fresh start this week',
  };
}
