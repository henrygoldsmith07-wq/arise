#!/usr/bin/env node
// pilot-report.mjs — the weekly pilot report for the study operator.
//
//   node scripts/pilot-report.mjs <exports-dir> [--out=<dir>] [--now=<ISO>]
//
// Deterministic under --now=<ISO>; otherwise the wall clock anchors
// staleness and retention. Consumes ONLY the canonical modules — no new
// evidence logic lives here.
//
// OPERATIONS, NOT CONCLUSIONS: no treatment ranking until the canonical
// gates (studyReadiness.STUDY_GATES) pass; warnings are operator nudges,
// never automatic product changes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestParticipantFiles, summariseCohort, renderCohortReport } from '../src/lib/cohortOps.js';
import { computeProductSuccessReport, renderProductSuccessReport } from '../src/lib/productSuccess.js';
import { buildPilotRoster, renderPilotRosterMd } from '../src/lib/pilotHealth.js';
import { evaluateStudyReadiness, countStudyEvidence, STUDY_GATES } from '../src/lib/studyReadiness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dirArg = args.find(a => !a.startsWith('--')) || path.join(here, '..', 'field');
const outDir = path.resolve(args.find(a => a.startsWith('--out='))?.split('=')[1] || path.dirname(path.resolve(dirArg)));
const nowISO = args.find(a => a.startsWith('--now='))?.split('=')[1] || new Date().toISOString();

const dir = path.resolve(dirArg);
if(!fs.existsSync(dir)){
  console.log(`No participant directory at ${dir}`);
  console.log('Collect consented study exports (study card → Export study data) into a folder and pass its path.');
  process.exit(0);
}
const files = fs.readdirSync(dir)
  .filter(f => f.toLowerCase().endsWith('.json') && !f.startsWith('pilot-report') && !f.startsWith('study-ops-report') && !f.startsWith('product-success'))
  .sort()
  .map(name => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') }));
if(!files.length){
  console.log('No participant JSON exports found — nothing to aggregate yet.');
  console.log('This report says so honestly rather than inventing results.');
  process.exit(0);
}

// ── Ingest once, reuse everywhere ────────────────────────────────────────
const ingest = ingestParticipantFiles(files);
const cohort = summariseCohort(ingest.participants, { nowISO });
const success = computeProductSuccessReport(ingest.participants, { nowISO });
const rosterResult = buildPilotRoster(ingest.participants, { nowISO, ingest });
const evidence = countStudyEvidence(ingest.participants);
const readiness = evaluateStudyReadiness(evidence, STUDY_GATES);

// Weekly pilot health signal: enrolled participants whose latest export is
// older than 21 days (or never) are quietly falling out of the pilot.
const STALE_DAYS = 21;
const stale = rosterResult.roster.filter(r => r.status === 'enrolled' && (r.exportAgeDays == null || r.exportAgeDays > STALE_DAYS));

const L = [];
L.push('# Pilot report');
L.push('');
L.push(`Generated for ${String(nowISO).slice(0, 10)} · ${ingest.counts.files} file(s) → ${ingest.counts.uniqueParticipants} participant(s)${ingest.counts.duplicateFiles ? ` · ${ingest.counts.duplicateFiles} duplicate file(s) folded` : ''}${ingest.counts.unidentifiedExports ? ` · ${ingest.counts.unidentifiedExports} unidentified export(s) excluded` : ''}.`);
L.push('');
L.push('Operational weekly view over consented participant exports. No treatment comparison is made here — rankings come only from the prespecified pipeline once the canonical gates pass.');
L.push('');

// ── Pilot pulse ──────────────────────────────────────────────────────────
L.push('## Pilot pulse');
L.push('');
L.push('| Metric | Value |');
L.push('|---|---|');
L.push(`| Enrolled / withdrawn / other | ${rosterResult.counts.enrolled} / ${rosterResult.counts.withdrawn} / ${rosterResult.counts.other} |`);
L.push(`| Consent active | ${rosterResult.counts.consented}/${rosterResult.counts.participants} |`);
L.push(`| Week-4 retention | ${success.retention.week4.value == null ? '—' : `${Math.round(success.retention.week4.value * 100)}%`} (n=${success.retention.week4.n}${success.retention.week4.missing ? `, ${success.retention.week4.missing} not yet decidable` : ''}) |`);
L.push(`| Week-1 retention | ${success.retention.week1.value == null ? '—' : `${Math.round(success.retention.week1.value * 100)}%`} (n=${success.retention.week1.n}${success.retention.week1.missing ? `, ${success.retention.week1.missing} not yet decidable` : ''}) |`);
L.push(`| Workouts/week (pooled) | ${success.sessionsPerWeek.pooled ?? '—'} · participant mean ${success.sessionsPerWeek.participantMean ?? '—'} (n=${success.sessionsPerWeek.n}) |`);
L.push(`| Workout completion | ${success.workoutCompletion.pooled == null ? '—' : `${Math.round(success.workoutCompletion.pooled * 100)}%`} over ${success.workoutCompletion.n} terminal sessions · ${success.startedUnresolved.count} started-unresolved |`);
L.push(`| Logging friction (median) | ${success.medianLoggingTime.participantMedianMs == null ? '—' : `${(success.medianLoggingTime.participantMedianMs / 1000).toFixed(1)}s`} (n=${success.medianLoggingTime.n}, missing ${success.medianLoggingTime.missing}) |`);
L.push(`| Recommendation acceptance | ${success.recommendationAcceptance.pooled == null ? '—' : `${Math.round(success.recommendationAcceptance.pooled * 100)}%`} of ${success.recommendationAcceptance.n} shown |`);
L.push(`| Override rate | ${success.overrideRate.pooled == null ? '—' : `${Math.round(success.overrideRate.pooled * 100)}%`} of ${success.overrideRate.n} resolved recommendations |`);
L.push(`| Valid study transitions | ${evidence.transitionsTotal} (arise ${evidence.transitionsArise} / double-progression ${evidence.transitionsDoubleProgression}) · contributors ${evidence.contributors.total} |`);
L.push(`| Open outcomes | ${evidence.invalid.open} |`);
L.push('');
L.push('n and missing counts accompany every rate; missing means "no answer yet", never "0".');
L.push('');

// ── Roster ───────────────────────────────────────────────────────────────
L.push(renderPilotRosterMd(rosterResult));

// ── Attention list ───────────────────────────────────────────────────────
L.push('## Participants needing attention');
L.push('');
if(!stale.length){
  L.push('None — every enrolled participant exported within the last 21 days (or has not joined long enough to owe one).');
}else{
  L.push(`Enrolled participants whose latest export is older than ${STALE_DAYS} days (or never exported):`);
  L.push('');
  for(const r of stale){
    L.push(`- \`${r.code}\` — ${r.exportAgeDays == null ? 'never exported' : `last export ${r.exportAgeDays} days ago`} · ${r.sessionsLogged} session(s) logged`);
  }
}
L.push('');

// ── Gate progress ────────────────────────────────────────────────────────
L.push('## Study-gate progress');
L.push('');
L.push('| Gate | Need | Have |');
L.push('|---|---|---|');
L.push(`| Contributing participants | ${STUDY_GATES.minContributors}+ | ${evidence.contributors.total} |`);
L.push(`| Valid assigned transitions (total) | ${STUDY_GATES.minTransitions}+ | ${evidence.transitionsTotal} |`);
L.push(`| Valid arise transitions | ${STUDY_GATES.minTransitionsPerArm}+ | ${evidence.transitionsArise} |`);
L.push(`| Valid double-progression transitions | ${STUDY_GATES.minTransitionsPerArm}+ | ${evidence.transitionsDoubleProgression} |`);
L.push('');
L.push(readiness.ready
  ? '**Gates met.** Effectiveness analysis (field study) may run — rankings come only from that prespecified pipeline, never from this report.'
  : '**Gates unmet — no treatment comparison is made.** The warnings and metrics above are operational; they never change the gates.');
L.push('');

// ── Data quality ─────────────────────────────────────────────────────────
L.push('## Data quality');
L.push('');
L.push(`${ingest.counts.warnings} ingest warning(s) · ${ingest.counts.importErrors} import error(s) · ${ingest.counts.duplicateFiles} duplicate file(s) folded · ${ingest.counts.unidentifiedExports} unidentified export(s) excluded.`);
L.push('');
if(ingest.warnings.length){
  L.push('| Kind | File | Detail |');
  L.push('|---|---|---|');
  for(const w of ingest.warnings) L.push(`| ${w.kind} | ${w.file} | ${w.detail} |`);
  L.push('');
}

// ── Existing renderers appended verbatim ─────────────────────────────────
const cohortMd = renderCohortReport(cohort, { ingest });
const successMd = renderProductSuccessReport(success);

const outPath = path.join(outDir, 'pilot-report.md');
fs.writeFileSync(outPath, L.join('\n') + '\n' + cohortMd + '\n' + successMd);
console.log(`Written: ${outPath}`);
console.log(`Pilot: ${rosterResult.counts.participants} participant(s), ${rosterResult.counts.needsAttention} needing attention, gate eligible=${readiness.ready}.`);
