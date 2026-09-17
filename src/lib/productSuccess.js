// productSuccess.js — product-success metrics from CONSENTED participant data.
//
// Answers "is the product working for real people?" with the numbers the
// product strategy names (docs/PRODUCT.md): retention, engagement depth,
// completion, recommendation acceptance, override rate, abandonment, logging
// time, mode usage and study adherence. Consent is enforced HERE, per
// participant: only stores whose exported preferences show measurement consent
// contribute rows; everyone else is counted as excluded, never silently
// averaged in.
//
// Every metric carries n and missingness — a percentage with no denominator is
// not a finding. Pure and deterministic over inputs. No arm is ever ranked
// here; effectiveness is fieldStudy.js's question, gated separately.

import { resolveArisePriors } from './priors.js';
import { recommendationAcceptanceStats, loggingTimeStats, workoutCompletionStats } from './telemetry.js';

const round = (v, d = 3)=> Number.isFinite(Number(v)) ? Math.round(Number(v) * 10 ** d) / 10 ** d : null;

function mondayKey(dateISO){
  const d = new Date(`${dateISO}T00:00:00Z`);
  if(Number.isNaN(d.getTime())) return null;
  const m = new Date(d); m.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return m.toISOString().slice(0, 10);
}

function daysBetween(fromISO, toISO){
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if(!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function medianOf(values){
  const list = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
  if(!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

// A metric cell: value + denominator + missing count. Nothing leaves as a bare
// percentage without its n.
function cell(value, n, missing = 0, extra = {}){
  return { value, n, missing: missing || 0, ...extra };
}

// ── Retention ───────────────────────────────────────────────────────────
// Week-1 / week-4 retention: of the people who logged a first session, how
// many were STILL logging (or exporting with a later first-run anchor) in the
// Nth ISO week after it? Anchor selection:
//   - enrolledAtISO when present (the study-consistent anchor), else
//   - the participant's earliest known moment: first session, first export
//     envelope, or first ledger record — whichever is earliest.
// A participant is retained-in-week-N when a logged session falls in that ISO
// week (weeks are Monday-anchored, matching weeksObserved elsewhere).
function retentionByWeek(store, anchorISO){
  const weeks = new Map(); // weekIndex → session count
  for(const h of (store.history || [])){
    const wk = mondayKey(h?.dateISO);
    if(!wk) continue;
    const idx = Math.floor(daysBetween(anchorISO, wk) / 7);
    if(!Number.isFinite(idx) || idx < 0) continue;
    weeks.set(idx, (weeks.get(idx) || 0) + 1);
  }
  return weeks;
}

function anchorFor(store){
  const candidates = [];
  if(store?.studyEnrollment?.enrolledAtISO) candidates.push(store.studyEnrollment.enrolledAtISO);
  for(const h of (store.history || [])) if(h?.dateISO) candidates.push(`${h.dateISO}T00:00:00Z`);
  for(const r of (store.evaluationLedger || [])) if(r?.recordedAtISO) candidates.push(r.recordedAtISO);
  candidates.sort((a, b) => String(a).localeCompare(String(b)));
  const anchor = candidates[0] || null;
  if(!anchor) return null;
  return String(anchor).slice(0, 10);
}

function retentionOf(store, todayStr){
  const anchorISO = anchorFor(store);
  if(!anchorISO) return { anchorISO: null, week1: false, week4: false, eligibleWeek1: false, eligibleWeek4: false, sessionsInWindow: 0 };
  const weeks = retentionByWeek(store, anchorISO);
  // A week is only MEASURABLE once it has fully elapsed: week N spans days
  // [7N, 7N+7), so week 1 is decidable at day 14, week 4 at day 35. A
  // participant enrolled six days ago has no week-1 answer yet — excluded
  // from that denominator rather than counted as churned.
  const elapsedDays = daysBetween(anchorISO, todayStr);
  const latestWeekSeen = weeks.size ? Math.max(...weeks.keys()) : -1;
  return {
    anchorISO,
    week1: (weeks.get(1) || 0) > 0,
    week4: (weeks.get(4) || 0) > 0,
    eligibleWeek1: (Number.isFinite(elapsedDays) && elapsedDays >= 14) || latestWeekSeen > 1,
    eligibleWeek4: (Number.isFinite(elapsedDays) && elapsedDays >= 35) || latestWeekSeen > 4,
    sessionsInWindow: weeks.size,
  };
}

// ── Per-participant product metrics ─────────────────────────────────────

export function measureProductSuccess(store, { config = null, nowISO = null } = {}){
  const cfg = resolveArisePriors(config);
  const history = Array.isArray(store?.history) ? store.history : [];
  const events = Array.isArray(store?.eventHistory) ? store.eventHistory : [];
  const scheduled = store?.activeSchedule?.sessions || [];

  const completion = workoutCompletionStats(events);
  const acceptance = recommendationAcceptanceStats(events);
  const logging = loggingTimeStats(events);

  // Workout completion rate from durable history first (saved sessions are
  // the ground truth), falling back to session events for sessions that were
  // started but never saved.
  const completedSessions = history.length;
  const startedSessions = new Set(events.filter(e => e?.type === 'session:start').map(e => e.sessionId).filter(Boolean));
  const abandonedEvents = events.filter(e => e?.type === 'session:abandon');
  const abandonedIds = [...new Set(abandonedEvents.map(e => e.sessionId).filter(Boolean))].filter(id => !history.some(h => h.id === id));
  const savedIds = new Set(history.map(h => h.id));
  // STARTED BUT UNRESOLVED: a session:start whose id has neither a saved
  // completion nor an explicit abandonment. These are MISSING OUTCOMES —
  // neither completions nor abandonments — and they must appear in the report
  // with their own count instead of silently shrinking the denominator.
  const startedUnresolvedIds = [...startedSessions].filter(id => !savedIds.has(id) && !abandonedIds.includes(id));
  const terminal = completedSessions + abandonedIds.length;
  const workoutCompletionRate = terminal ? round(completedSessions / terminal) : null;
  const abandonmentRate = terminal ? round(abandonedIds.length / terminal) : null;

  // Recommendation acceptance / override rate from the evaluation ledger
  // (override = user swapped or skipped the prescribed exercise after it was
  // frozen) and the sessions themselves (adapted/substituted blocks replaced).
  const resolvedLedger = (store?.evaluationLedger || []).filter(r => r?.recommendation && r?.outcome);
  const overrides = resolvedLedger.filter(r => r.outcome?.userOverride === true).length;
  const overrideRate = resolvedLedger.length ? round(overrides / resolvedLedger.length) : null;

  // Mode usage: which logging mode each saved session ran in (standard /
  // gym / guided). Sessions from before mode tagging count as 'untagged'.
  const modeUsage = { guided: 0, gym: 0, standard: 0, untagged: 0 };
  for(const h of history){
    const mode = h?.mode;
    if(mode === 'guided' || mode === 'gym') modeUsage[mode]++;
    else if(mode === 'standard') modeUsage.standard++;
    else modeUsage.untagged++;
  }

  // Study adherence: scheduled vs actually-done on the active schedule.
  const doneIds = new Set(history.map(h => h.id));
  const scheduledDone = scheduled.filter(s => doneIds.has(s.id) || s?.status === 'done').length;
  const scheduledMissed = scheduled.filter(s => !doneIds.has(s.id) && s?.status !== 'done' && String(s?.dateISO || '') < String(nowISO || new Date().toISOString().slice(0, 10))).length;

  // Retention.
  const todayStr = String(nowISO || new Date().toISOString()).slice(0, 10);
  const retention = retentionOf(store, todayStr);

  // Dropout: had sessions, then a gap > 28 days from the last one to now.
  const dates = history.map(h => h?.dateISO).filter(Boolean).sort();
  const last = dates[dates.length - 1] || null;
  const daysSinceLast = last ? daysBetween(last, todayStr) : null;
  const dropout = history.length > 0 && daysSinceLast != null && daysSinceLast > 28;

  // Engagement depth.
  const weeksObserved = new Set(history.map(h => mondayKey(h.dateISO)).filter(Boolean)).size;
  const sessionsPerWeek = weeksObserved ? round(history.length / weeksObserved, 2) : null;
  // Week-1 and week-4 sessions/user/week (the strategy's engagement metric).
  const weekBuckets = retention.anchorISO ? retentionByWeek(store, retention.anchorISO) : new Map();
  const week1Sessions = weekBuckets.get(1) || 0;
  const week4Sessions = weekBuckets.get(4) || 0;

  return {
    consented: store?.preferences?.telemetryEnabled === true,
    weeksObserved,
    sessionsLogged: history.length,
    // Timing data degrades to null without the sessionTimings refinement.
    medianLoggingTimeMs: logging.medianMs,
    loggingTimeN: logging.n,
    acceptance: {
      shown: acceptance.shown,
      accepted: acceptance.accepted,
      dismissed: acceptance.dismissed,
      rate: acceptance.shown ? round(acceptance.accepted / acceptance.shown) : null,
    },
    completion: {
      completed: completedSessions,
      abandonedWithoutSave: abandonedIds.length,
      startedUnresolved: startedUnresolvedIds.length,
      startedTotal: startedSessions.size,
      rate: workoutCompletionRate,
      eventBacked: completion,
    },
    abandonmentRate,
    overrideRate: { value: overrideRate, overridden: overrides, n: resolvedLedger.length },
    modeUsage,
    adherence: {
      scheduled: scheduled.length,
      done: scheduledDone,
      missed: scheduledMissed,
      rate: scheduled.length ? round(scheduledDone / scheduled.length) : null,
    },
    retention,
    dropout,
    daysSinceLastSession: daysSinceLast,
    sessionsPerWeek,
    week1SessionsPerWeek: week1Sessions,
    week4SessionsPerWeek: week4Sessions,
    // Disposition of unobservable things — never hidden.
    missing: {
      timingEvents: events.length - logging.n,
      readinessEntries: Array.isArray(store?.readinessLog) ? store.readinessLog.filter(r => !r?.dateISO).length : 0,
      sessionsWithoutMode: modeUsage.untagged,
      cfg: cfg.version,
    },
  };
}

// ── Cohort product-success report ───────────────────────────────────────
// participants: [{ code, store }] (already folded by identity — see
// cohortOps.ingestParticipantFiles or fieldStudy.groupParticipantsByIdentity).
export function computeProductSuccessReport(participants, { config = null, nowISO = null } = {}){
  const all = (participants || []).filter(p => p && (p.store || typeof p.store === 'object'));
  const consented = all.filter(p => p.store?.preferences?.telemetryEnabled === true);
  const excludedCount = all.length - consented.length;

  const measures = consented.map(p => ({ code: p.code, ...measureProductSuccess(p.store, { config, nowISO }) }));

  const n = measures.length;
  const num = (fn)=> measures.map(fn).filter(Number.isFinite);
  const mean = (arr)=> arr.length ? round(arr.reduce((a, b)=> a + b, 0) / arr.length) : null;
  const rate = (fn)=> {
    const withTrue = measures.filter(fn).length;
    return n ? round(withTrue / n) : null;
  };
  // Pooled rates from pooled numerators/denominators (volume-weighted), shown
  // alongside participant-balanced means so one heavy user cannot move the
  // balanced read.
  const sum = (fn)=> measures.reduce((a, m)=> a + (fn(m) || 0), 0);

  const acceptanceShown = sum(m => m.acceptance.shown);
  const acceptanceAccepted = sum(m => m.acceptance.accepted);
  const overrideN = sum(m => m.overrideRate.n);
  const overrideCount = sum(m => m.overrideRate.overridden);
  const adherenceScheduled = sum(m => m.adherence.scheduled);
  const adherenceDone = sum(m => m.adherence.done);
  const adherenceMissed = sum(m => m.adherence.missed);
  const terminalTotal = sum(m => (m.completion.completed + m.completion.abandonedWithoutSave));
  const completedTotal = sum(m => m.completion.completed);
  const abandonedTotal = sum(m => m.completion.abandonedWithoutSave);
  const unresolvedStarts = sum(m => m.completion.startedUnresolved);
  const unresolvedParticipants = measures.filter(m => m.completion.startedUnresolved > 0).length;

  const week1Eligible = measures.filter(m => m.retention.eligibleWeek1);
  const week4Eligible = measures.filter(m => m.retention.eligibleWeek4);
  const dropoutCount = measures.filter(m => m.dropout).length;

  // Retention rates divide by the ELIGIBLE participants only — someone whose
  // week-N window has not fully elapsed has no answer yet, and counting them
  // in the denominator would understate retention (and hide behind "missing").
  const retainedRate = (eligible, flag)=> eligible.length ? round(eligible.filter(m => flag(m)).length / eligible.length) : null;
  const week1Value = retainedRate(week1Eligible, m => m.retention.week1);
  const week4Value = retainedRate(week4Eligible, m => m.retention.week4);

  const modePooled = { guided: 0, gym: 0, standard: 0, untagged: 0 };
  for(const m of measures) for(const k of Object.keys(modePooled)) modePooled[k] += m.modeUsage[k] || 0;

  return {
    generatedAtISO: nowISO ? new Date(`${String(nowISO).slice(0, 10)}T00:00:00Z`).toISOString() : new Date().toISOString(),
    participants: all.length,
    consentedParticipants: n,
    excludedUnconsented: excludedCount,
    // Headline metrics. Each carries n (+missing) — a rate without a
    // denominator renders as '—' downstream.
    retention: {
      week1: cell(week1Value, week1Eligible.length, n - week1Eligible.length),
      week4: cell(week4Value, week4Eligible.length, n - week4Eligible.length),
      note: 'Retained-in-week-N = ≥1 logged session in that ISO week after the participant anchor (enrollment or first activity).',
    },
    sessionsPerWeek: {
      participantMean: mean(num(m => m.sessionsPerWeek)),
      pooled: sum(m => m.sessionsLogged) && num(m => m.sessionsPerWeek).length
        ? round(sum(m => m.sessionsLogged) / sum(m => m.weeksObserved), 2)
        : null,
      week1: mean(num(m => m.week1SessionsPerWeek)),
      week4: mean(num(m => m.week4SessionsPerWeek)),
      n,
    },
    workoutCompletion: {
      pooled: terminalTotal ? round(completedTotal / terminalTotal) : null,
      participantMean: mean(num(m => m.completion.rate)),
      n: terminalTotal,
      missing: sum(m => (m.completion.completed + m.completion.abandonedWithoutSave) ? 0 : 1),
    },
    startedUnresolved: {
      count: unresolvedStarts,
      participants: unresolvedParticipants,
      startedTotal: sum(m => m.completion.startedTotal),
      // Denominator accounting: completed + abandoned + unresolved = every
      // start. Unresolved starts are MISSING outcomes, not silent drops —
      // completion and abandonment stay pooled over TERMINAL sessions only.
      note: 'session:start events with neither a saved completion nor an explicit abandonment. Reported as missing outcomes; completion/abandonment denominators count terminal sessions only.',
    },
    recommendationAcceptance: {
      pooled: acceptanceShown ? round(acceptanceAccepted / acceptanceShown) : null,
      participantMean: mean(num(m => m.acceptance.rate)),
      n: acceptanceShown,
    },
    overrideRate: {
      pooled: overrideN ? round(overrideCount / overrideN) : null,
      participantMean: mean(num(m => m.overrideRate.value)),
      n: overrideN,
    },
    abandonment: {
      pooled: terminalTotal ? round(abandonedTotal / terminalTotal) : null,
      participantMean: mean(num(m => m.abandonmentRate)),
      n: terminalTotal,
    },
    medianLoggingTime: {
      participantMedianMs: medianOf(measures.map(m => m.medianLoggingTimeMs)),
      n: sum(m => (m.loggingTimeN > 0 ? 1 : 0)),
      missing: n - sum(m => (m.loggingTimeN > 0 ? 1 : 0)),
      note: 'Timing events persist only with the sessionTimings refinement on; otherwise this degrades to null.',
    },
    modeUsage: {
      pooled: modePooled,
      shares: (()=>{
        const total = modePooled.guided + modePooled.gym + modePooled.standard + modePooled.untagged;
        return {
          guided: total ? round(modePooled.guided / total) : null,
          gym: total ? round(modePooled.gym / total) : null,
          standard: total ? round(modePooled.standard / total) : null,
          untagged: total ? round(modePooled.untagged / total) : null,
        };
      })(),
      n: sum(m => m.sessionsLogged),
    },
    studyAdherence: {
      pooled: adherenceScheduled ? round(adherenceDone / adherenceScheduled) : null,
      participantMean: mean(num(m => m.adherence.rate)),
      n: adherenceScheduled,
      missed: adherenceMissed,
    },
    dropout: {
      rate: n ? round(dropoutCount / n) : null,
      count: dropoutCount,
      n,
      note: 'Dropout = ≥1 session then >28 days of silence at report time.',
    },
    perParticipant: measures.map(m => ({
      code: m.code,
      weeksObserved: m.weeksObserved,
      sessions: m.sessionsLogged,
      retention: { week1: m.retention.week1, week4: m.retention.week4 },
      sessionsPerWeek: m.sessionsPerWeek,
      completionRate: m.completion.rate,
      acceptanceRate: m.acceptance.rate,
      overrideRate: m.overrideRate.value,
      medianLoggingTimeMs: m.medianLoggingTimeMs,
      adherenceRate: m.adherence.rate,
      dropout: m.dropout,
      modes: m.modeUsage,
    })),
    note: 'Consented data only — unconsented exports are excluded entirely and counted. Every rate carries n; missing observations are reported, never imputed. Descriptive, never a causal claim.',
  };
}

// ── Markdown ────────────────────────────────────────────────────────────

const pctStr = (v)=> v == null ? '—' : `${Math.round(v * 100)}%`;

export function renderProductSuccessReport(report){
  const L = [];
  L.push('# Product-success report (consented real users)');
  L.push('');
  L.push(`Generated ${report.generatedAtISO} · ${report.consentedParticipants} consenting participant(s) of ${report.participants} export(s); ${report.excludedUnconsented} excluded (consent off).`);
  L.push('');
  const r = report.retention;
  L.push('## Retention');
  L.push('');
  L.push(`- Week-1 retention: ${pctStr(r.week1.value)} (n=${r.week1.n}${r.week1.missing ? `, ${r.week1.missing} without enough elapsed time` : ''})`);
  L.push(`- Week-4 retention: ${pctStr(r.week4.value)} (n=${r.week4.n}${r.week4.missing ? `, ${r.week4.missing} without enough elapsed time` : ''})`);
  L.push(`- Sessions/user/week: participant mean ${report.sessionsPerWeek.participantMean ?? '—'} · week-1 ${report.sessionsPerWeek.week1 ?? '—'} · week-4 ${report.sessionsPerWeek.week4 ?? '—'} (n=${report.sessionsPerWeek.n})`);
  L.push('');
  L.push('## Training behaviour');
  L.push('');
  L.push(`- Workout completion rate: ${pctStr(report.workoutCompletion.pooled)} pooled over ${report.workoutCompletion.n} terminal session(s)${report.workoutCompletion.missing ? ` · ${report.workoutCompletion.missing} participant(s) with none` : ''}`);
  L.push(`- Abandonment: ${pctStr(report.abandonment.pooled)} (same denominator)`);
  L.push(`- Started but unresolved: ${report.startedUnresolved.count} of ${report.startedUnresolved.startedTotal} started session(s)${report.startedUnresolved.participants ? ` across ${report.startedUnresolved.participants} participant(s)` : ''} — ${report.startedUnresolved.note}`);
  L.push(`- Recommendation acceptance: ${pctStr(report.recommendationAcceptance.pooled)} over ${report.recommendationAcceptance.n} shown (participant mean ${pctStr(report.recommendationAcceptance.participantMean)})`);
  L.push(`- Override rate: ${pctStr(report.overrideRate.pooled)} over ${report.overrideRate.n} resolved recommendation(s) (participant mean ${pctStr(report.overrideRate.participantMean)})`);
  L.push(`- Median logging time: ${report.medianLoggingTime.participantMedianMs ?? '—'} ms (participants with timing data: ${report.medianLoggingTime.n}/${report.medianLoggingTime.n + report.medianLoggingTime.missing}) — ${report.medianLoggingTime.note}`);
  L.push('');
  const mu = report.modeUsage;
  L.push('## Guided / Gym / Standard usage');
  L.push('');
  L.push(`Guided ${mu.pooled.guided} (${pctStr(mu.shares.guided)}) · Gym ${mu.pooled.gym} (${pctStr(mu.shares.gym)}) · Standard ${mu.pooled.standard} (${pctStr(mu.shares.standard)})${mu.pooled.untagged ? ` · pre-mode-tagging ${mu.pooled.untagged} (${pctStr(mu.shares.untagged)})` : ''} — n=${mu.n} sessions`);
  L.push('');
  L.push('## Study adherence & dropout');
  L.push('');
  L.push(`- Study adherence (scheduled sessions completed): ${pctStr(report.studyAdherence.pooled)} over ${report.studyAdherence.n} scheduled (participant mean ${pctStr(report.studyAdherence.participantMean)}; ${report.studyAdherence.missed} missed)`);
  L.push(`- Participant dropout: ${pctStr(report.dropout.rate)} (${report.dropout.count}/${report.dropout.n}) — ${report.dropout.note}`);
  L.push('');
  L.push('## Per participant');
  L.push('');
  if(report.perParticipant.length){
    L.push('| Participant | Weeks | Sessions | wk1 / wk4 | Sessions/wk | Completion | Acceptance | Overrides | Median log ms | Adherence | Dropout |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for(const p of report.perParticipant){
      L.push(`| ${p.code} | ${p.weeksObserved} | ${p.sessions} | ${p.retention.week1 ? '✓' : '·'} / ${p.retention.week4 ? '✓' : '·'} | ${p.sessionsPerWeek ?? '—'} | ${pctStr(p.completionRate)} | ${pctStr(p.acceptanceRate)} | ${pctStr(p.overrideRate)} | ${p.medianLoggingTimeMs ?? '—'} | ${pctStr(p.adherenceRate)} | ${p.dropout ? 'yes' : 'no'} |`);
    }
  }else{
    L.push('_No consenting participants yet — metrics appear here as consented exports arrive._');
  }
  L.push('');
  L.push(`> ${report.note}`);
  L.push('');
  return L.join('\n');
}
