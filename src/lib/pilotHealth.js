// pilotHealth.js — pilot OPERATIONS, not conclusions.
//
// The first real-user pilot runs on humans, and humans stall, lose consent,
// export corrupted files, and abandon workouts. This module turns the
// canonical modules (cohortOps ingestion, studyReadiness counting,
// productSuccess measurement, participation lifecycle) into an operator
// roster: who is active, who needs a nudge, and where data quality is at
// risk. Every check here is an OPERATIONAL WARNING for the study operator —
// none of them changes product behaviour, thresholds, or any readiness
// surface. The study gates live in studyReadiness.js and are only ever
// *displayed* here.
//
// PRIVACY: the roster is keyed by the pseudonymous participant code and
// shows operational facts only (export dates, session counts, arm counts,
// warnings). No free-text user content is surfaced.

import { participationStatus } from './participation.js';
import { countStudyEvidence } from './studyReadiness.js';
import { measureProductSuccess } from './productSuccess.js';

const round = (v, d = 3)=> Number.isFinite(Number(v)) ? Math.round(Number(v) * 10 ** d) / 10 ** d : null;

function daysBetween(fromISO, toISO){
  const a = Date.parse(fromISO), b = Date.parse(toISO);
  if(!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 86400000);
}

function lastSessionISO(store){
  let last = null;
  for(const h of (store?.history || [])){
    if(h?.dateISO && (!last || h.dateISO > last)) last = h.dateISO;
  }
  return last;
}

// ── Per-participant roster entry ─────────────────────────────────────────
// `p` is a folded participant from ingestParticipantFiles (or an equivalent
// { code, store } package). `nowISO` anchors every staleness comparison so
// the roster is deterministic for a given export snapshot.
export function assessParticipant(p, { nowISO, ingestWarnings = [], cohortMedianLoggingMs = null } = {}){
  const store = p?.store || {};
  const code = p.code || (p.studyParticipantId || store.studyParticipantId || 'anonymous').slice(0, 8);
  const status = participationStatus(store);
  const consented = store?.preferences?.telemetryEnabled === true;

  // Canonical counting (the ONE predicate) — per participant, dedupe included.
  const evidence = countStudyEvidence([p]);
  const measure = measureProductSuccess(store, { nowISO });

  const warnings = [];
  const attention = (w)=>{ warnings.push(w); };

  // 1. Stopped exporting: an enrolled participant whose latest export is
  //    >21 days old (three weekly exports missed). Withdrawn people are
  //    expected to stop — that is the lifecycle working, not a problem.
  //    HONEST SEMANTICS: this is a MISSING-EXPORT-TIMESTAMP signal, not a
  //    never-exported detector. The operator has no enrollment registry, so
  //    a person who enrolled but has sent no file yet is simply invisible
  //    here — this flag covers files that arrived without a usable stamp.
  const lastExport = p.lastExportedAtISO || null;
  const exportAgeDays = lastExport ? daysBetween(lastExport, nowISO) : null;
  if(status === 'enrolled'){
    if(lastExport == null) attention('missing-export-timestamp');
    else if(exportAgeDays != null && exportAgeDays > 21) attention(`stale-export-${exportAgeDays}d`);
  }

  // 2. No workouts recorded at all while enrolled.
  if(status === 'enrolled' && measure.sessionsLogged === 0) attention('no-workouts');

  // 3. Consent lost: joined the study (enrollment exists) but telemetry is
  //    now off — study evidence stops accruing until they re-consent.
  if(status === 'enrolled' && !consented) attention('consent-lost');

  // 4. Corrupted / conflicting exports: ingest flagged one of this
  //    participant's files. Shown verbatim by kind; never auto-resolved.
  const files = new Set(p.sourceFiles || []);
  const theirWarnings = ingestWarnings.filter(w => files.has(w.file));
  for(const w of theirWarnings){
    if(w.kind === 'conflicting-record') attention('conflicting-records');
    else if(w.kind === 'import-error') attention('import-error');
  }

  // 5. One arm producing unexpectedly little evidence FOR THIS PARTICIPANT:
  //    randomisation should mix arms over time; 8+ valid transitions all in
  //    one arm is worth an operator look (device clock, export gaps…).
  const total = evidence.transitionsTotal;
  if(total >= 8 && (evidence.transitionsArise === 0 || evidence.transitionsDoubleProgression === 0)){
    attention('single-arm-evidence');
  }

  // 6. Unusually high abandonment: of TERMINAL workouts (completed OR
  //    explicitly abandoned — unresolved starts are missing outcomes, not
  //    data points), more than half abandoned across ≥4 terminal sessions.
  const terminal = (measure.completion.completed || 0) + (measure.completion.abandonedWithoutSave || 0);
  if(terminal >= 4 && measure.abandonmentRate != null && measure.abandonmentRate > 0.5){
    attention(`high-abandonment-${Math.round(measure.abandonmentRate * 100)}pct`);
  }

  // 7. Excessive recommendation overrides: more than half of resolved
  //    recommendations overridden across ≥8 resolved rows.
  if(measure.overrideRate.n >= 8 && measure.overrideRate.value != null && measure.overrideRate.value > 0.5){
    attention(`override-heavy-${Math.round(measure.overrideRate.value * 100)}pct`);
  }

  // 8. Logging-time regression: this participant's median logging time is
  //    >2× the cohort median (friction is creeping up for them). Needs ≥5
  //    timing events locally so the comparison is not noise.
  if(cohortMedianLoggingMs != null
    && Number.isFinite(measure.medianLoggingTimeMs)
    && measure.loggingTimeN >= 5
    && measure.medianLoggingTimeMs > 2 * cohortMedianLoggingMs){
    attention('logging-time-outlier');
  }

  return {
    code,
    status,
    consented,
    sourceFiles: p.sourceFiles || [],
    firstExportedAtISO: p.firstExportedAtISO || null,
    lastExportedAtISO: lastExport,
    exportAgeDays,
    weeksObserved: measure.weeksObserved,
    sessionsLogged: measure.sessionsLogged,
    sessionsPerWeek: measure.sessionsPerWeek,
    lastSessionISO: lastSessionISO(store),
    transitions: {
      total,
      arise: evidence.transitionsArise,
      'double-progression': evidence.transitionsDoubleProgression,
    },
    openOutcomes: evidence.invalid.open,
    unresolvedStarts: measure.completion.startedUnresolved,
    missing: measure.missing,
    medianLoggingTimeMs: measure.medianLoggingTimeMs,
    loggingTimeN: measure.loggingTimeN,
    warnings,
    needsAttention: warnings.length > 0,
  };
}

// ── The roster ───────────────────────────────────────────────────────────
// `participants` comes from ingestParticipantFiles().participants;
// `ingest` is the full ingest result (for file-level warning attribution).
export function buildPilotRoster(participants, { nowISO, ingest = null } = {}){
  const ingestWarnings = ingest?.warnings || [];
  // Cohort median logging time (consented participants with timing data)
  // anchors the per-participant friction check.
  const times = (participants || [])
    .filter(p => p?.store?.preferences?.telemetryEnabled === true)
    .map(p => measureProductSuccess(p.store, { nowISO }))
    .map(m => m.medianLoggingTimeMs)
    .filter(Number.isFinite)
    .sort((a, b)=> a - b);
  const cohortMedianLoggingMs = times.length
    ? (times.length % 2
      ? times[(times.length - 1) / 2]
      : Math.round((times[times.length / 2 - 1] + times[times.length / 2]) / 2))
    : null;

  const roster = (participants || [])
    .map(p => assessParticipant(p, { nowISO, ingestWarnings, cohortMedianLoggingMs }))
    .sort((a, b)=> (a.needsAttention === b.needsAttention)
      ? a.code.localeCompare(b.code)
      : (a.needsAttention ? -1 : 1));

  const counts = {
    participants: roster.length,
    enrolled: roster.filter(r => r.status === 'enrolled').length,
    withdrawn: roster.filter(r => r.status === 'withdrawn').length,
    other: roster.filter(r => r.status !== 'enrolled' && r.status !== 'withdrawn').length,
    needsAttention: roster.filter(r => r.needsAttention).length,
    consented: roster.filter(r => r.consented).length,
  };
  return { roster, counts, cohortMedianLoggingMs, nowISO };
}

// ── Operator rendering ───────────────────────────────────────────────────
export function renderPilotRosterMd(rosterResult){
  const { roster, counts } = rosterResult;
  const L = [];
  L.push('## Participant roster');
  L.push('');
  L.push(`${counts.participants} participant(s) · ${counts.enrolled} enrolled · ${counts.withdrawn} withdrawn · ${counts.consented} consented · **${counts.needsAttention} need attention**`);
  L.push('');
  L.push('| Code | Status | Exports | Last export | Weeks | Sessions | Arise / DP | Open | Unres. | Warnings |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for(const r of roster){
    const lastExport = r.lastExportedAtISO ? `${r.lastExportedAtISO.slice(0, 10)}${r.exportAgeDays != null ? ` (${r.exportAgeDays}d)` : ''}` : '—';
    const warn = r.warnings.length ? r.warnings.join(', ') : '—';
    L.push(`| \`${r.code}\` | ${r.status}${r.consented ? '' : ' ·unconsented'} | ${r.sourceFiles.length} | ${lastExport} | ${r.weeksObserved} | ${r.sessionsLogged} | ${r.transitions.arise} / ${r.transitions['double-progression']} | ${r.openOutcomes} | ${r.unresolvedStarts} | ${warn} |`);
  }
  L.push('');
  L.push('Warnings are operational, not product changes: `stale-export-Nd` = no export in N days · `missing-export-timestamp` (a file arrived without a usable export time; a true never-exporter sends no file and is invisible without a registry) · `no-workouts` · `consent-lost` · `conflicting-records` / `import-error` (see data quality below) · `single-arm-evidence` (≥8 transitions, all one arm) · `high-abandonment-Npct` (>50% of ≥4 terminal workouts abandoned — completed or explicitly abandoned; unresolved starts never count toward the floor) · `override-heavy-Npct` (>50% of ≥8 resolved recommendations overridden) · `logging-time-outlier` (median logging time >2× cohort median with ≥5 timing events).');
  L.push('');
  return L.join('\n');
}
