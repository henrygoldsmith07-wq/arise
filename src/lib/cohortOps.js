// cohortOps.js — study-operations report over consented participant exports.
//
// OPERATIONS, not conclusions. This is the report the study operator reads to
// answer: how many people are enrolled, who is still active, how balanced the
// arms are, where the data has holes, and whether any analysis gate is close
// to being met. It never ranks arms and never states an effectiveness claim —
// ranking treatments before the participant/session gates are satisfied would
// be reading noise as signal. Effectiveness lives in fieldStudy.js
// (pooledAssignedComparison); this module counts, audits and warns.
//
// Ingestion (ingestParticipantFiles) wraps the SAME loadParticipantFile the
// fixture harness uses, then:
//   - merges repeated exports of one study id into one participant
//     (studyIdentity.js contract: one person, many exports);
//   - detects duplicate files, conflicting records, malformed participant ids,
//     study-version mismatches and impossible arm changes — as WARNINGS.
// Nothing is silently overwritten: every conflict is reported and the merged
// record keeps both sides of the story (history/events/ledger are unioned by
// their own ids by mergeStores; conflicts list the ids that disagreed).
//
// Pure and deterministic over its inputs: same files in, same report out.

import { resolveArisePriors } from './priors.js';
import { isValidStudyParticipantId } from './studyIdentity.js';
import { STUDY_VERSION } from './studyEnrollment.js';
import { loadParticipantFile } from './fieldStudy.js';
import { mergeStores } from './export.js';
import { isValidAssignedStudyTransition, evaluateStudyReadiness, STUDY_GATES, PRIMARY_STUDY_ARMS } from './studyReadiness.js';
import { prospectiveTransitionKey } from './evaluation.js';
import { createHash } from 'node:crypto';
import { localDateISO } from './dateOnly.js';

const round = (v, d = 3)=> Number.isFinite(Number(v)) ? Math.round(Number(v) * 10 ** d) / 10 ** d : null;
const pct = (part, whole)=> whole ? round(part / whole) : null;

// ── Prespecified analysis gates ─────────────────────────────────────────
// A gate blocks treatment ranking until BOTH breadth (genuine contributors:
// identified, consented, ≥1 valid resolved assigned-arm transition) and
// depth (assigned transitions) exist. These are study-operations constants:
// the pooled analysis (fieldStudy.pooledAssignedComparison) carries its own
// identical defaults; the operator report simply shows who is close.
// Canonical gates now live in studyReadiness.STUDY_GATES; this alias keeps
// the historical import surface for tests and reports.
export const ANALYSIS_GATES = STUDY_GATES;

// Sessions newer than this are "recent"; a participant counts as ACTIVE when
// they logged something inside the window. Window: 28 days — a deload or a
// bad month should not drop someone from operations visibility, but a
// six-week gap should (matching progression's long-break threshold).
const ACTIVE_WINDOW_DAYS = 28;

function todayISO(nowISO = null){
  if(nowISO) return String(nowISO).slice(0, 10);
  return localDateISO();
}

function daysBetween(fromISO, toISO){
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if(!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

// ── Ingestion: repeated exports → one participant, anomalies → warnings ──
//
// files: [{ name, text }] — raw export payloads (string JSON) plus a stable
// display name so warnings can point at the offending file. Returns
// { participants, warnings } where participants are ready for
// measureParticipant / computeFieldStudy / pooledAssignedComparison.
//
// Detection contract (every case a WARN, never a silent fix):
//   duplicate-file      same payload seen twice (byte-identical) — second
//                       copy contributes nothing but is counted;
//   malformed-id        a studyParticipantId present but not 16-hex — the
//                       export falls into the unidentified pool instead;
//   study-version       enrollment.studyVersion differing from the current
//                       STUDY_VERSION (analysis still reads it; flagged);
//   conflicting-record  same record id (ledger/history/event) with DIVERGENT
//                       content across two exports of the same person — the
//                       merge keeps the more-resolved/newer copy and the
//                       disagreement is reported, never dropped quietly;
//   impossible-arm      one exercise assigned to DIFFERENT arms across two
//                       enrollments of the same participant — the frozen
//                       assignment is kept from the earliest enrollment and
//                       the conflict is reported (deterministic assignment
//                       makes this a tamper/regeneration signal, not noise);
//   import-error        file failed validation entirely (counted, skipped).
export function ingestParticipantFiles(files, { config = null } = {}){
  const warnings = [];
  const seenPayloads = new Map(); // hash → file name (duplicate-file detection)
  const byId = new Map();         // study id → accumulating participant
  const unidentified = [];
  let importErrors = 0;
  let duplicateFiles = 0;

  const list = (files || []).map((f, i)=> ({
    name: f?.name || `export-${String(i + 1).padStart(3, '0')}.json`,
    text: typeof f === 'string' ? f : String(f?.text ?? ''),
  }));

  for(const { name, text } of list){
    if(!text.trim()){ warnings.push(warn('import-error', name, 'empty file')); importErrors++; continue; }
    // Duplicate whole files: byte-identical payloads are counted, not merged.
    const digest = sha256Hex(text);
    if(seenPayloads.has(digest)){
      duplicateFiles++;
      warnings.push(warn('duplicate-file', name, `byte-identical to ${seenPayloads.get(digest)} — counted once`));
      continue;
    }
    seenPayloads.set(digest, name);

    let loaded;
    try{
      loaded = loadParticipantFile(text, 0);
    }catch(err){
      importErrors++;
      warnings.push(warn('import-error', name, String(err?.message || err)));
      continue;
    }
    const rawId = loaded.studyParticipantId;
    if(!rawId){
      const raw = safeParse(text);
      const present = raw?.data ? raw.data.studyParticipantId : raw?.studyParticipantId;
      if(present != null) warnings.push(warn('malformed-id', name, `study id ${JSON.stringify(String(present).slice(0, 24))} is not a valid 16-hex pseudonymous id — treated as unidentified`));
      unidentified.push({ code: loaded.code, store: loaded.store, sourceFiles: [name] });
      continue;
    }
    // Study-version drift inside the enrollment (if any).
    const sv = loaded.store?.studyEnrollment?.studyVersion;
    if(sv != null && sv !== STUDY_VERSION){
      warnings.push(warn('study-version', name, `enrollment studyVersion ${sv} ≠ current ${STUDY_VERSION}`));
    }

    const prior = byId.get(rawId);
    if(!prior){
      byId.set(rawId, {
        code: loaded.code,
        studyParticipantId: rawId,
        store: loaded.store,
        sourceFiles: [name],
        firstExportedAtISO: safeParse(text)?.exportedAt || null,
        lastExportedAtISO: safeParse(text)?.exportedAt || null,
      });
      continue;
    }

    // Same person again: audit what CHANGED between the two exports before
    // merging, so conflicts surface instead of silently overwriting.
    auditMergeConflicts(prior, loaded, name, warnings);
    const merged = mergeStores(prior.store, loaded.store, 'merge');
    // mergeStores unioned the collections; conflicts were already reported.
    prior.store = merged;
    prior.sourceFiles.push(name);
    const exportedAt = safeParse(text)?.exportedAt || null;
    if(exportedAt){
      if(!prior.firstExportedAtISO || String(exportedAt) < String(prior.firstExportedAtISO)) prior.firstExportedAtISO = exportedAt;
      if(!prior.lastExportedAtISO || String(exportedAt) > String(prior.lastExportedAtISO)) prior.lastExportedAtISO = exportedAt;
    }
  }

  return {
    participants: [...byId.values()],
    unidentified,
    warnings,
    counts: {
      files: list.length,
      uniqueParticipants: byId.size,
      unidentifiedExports: unidentified.length,
      duplicateFiles,
      importErrors,
      warnings: warnings.length,
    },
  };
}

function warn(kind, file, detail){ return { kind, file, detail }; }

function safeParse(text){
  try{ const p = JSON.parse(text); return p?.data ? p.data : p; }catch{ return null; }
}

// Duplicate files mean BYTE-IDENTICAL content: SHA-256 over the raw payload,
// not a hand-rolled hash (collisions in a 32-bit rolling hash would silently
// swallow genuinely different exports).
function sha256Hex(text){
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Canonical JSON: key-sorted, order-independent serialization so two devices
// writing the same record in different key orders compare EQUAL, while any
// material difference (a rep, a load, an RPE, a timestamp, a provenance
// stamp) compares UNEQUAL. This is what makes the conflict audit exhaustive
// instead of a savedAt/block-count spot check.
function canonicalJson(value){
  if(value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if(Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

// Record-level conflict audit between the accumulated participant and a fresh
// export of the same id. Ledger rows, history sessions and events are compared
// BY ID; a divergent payload means two devices (or a hand edit) disagree about
// what happened — reported as conflicting-record with the offending ids.
function auditMergeConflicts(prior, incoming, fileName, warnings){
  const a = prior.store || {};
  const b = incoming.store || {};
  const conflicts = [];

  // Evaluation ledger: same id, materially different content. The WHOLE row
  // is compared canonically — recommendation, outcome, per-arm prescription
  // snapshots, provenance stamps — so any disagreement surfaces, not just
  // fields a previous audit happened to look at.
  const aLedger = new Map((a.evaluationLedger || []).map(r => [String(r?.id), r]));
  for(const row of (b.evaluationLedger || [])){
    const old = aLedger.get(String(row?.id));
    if(!old) continue;
    if(canonicalJson(old) !== canonicalJson(row)){
      conflicts.push(`ledger:${row.id}`);
    }
  }
  // History: same session id, canonically different content — exercises,
  // per-set reps/load/RPE/RIR, completion status, workout timestamps,
  // provenance. savedAt alone is never the test, but a savedAt-only
  // difference is still a conflict (two devices saved the "same" session —
  // one side is discarded by the first-seen merge, so the operator must see
  // it). `sourceTaggedAt` is NORMALISED OUT: it is a load-time tagging
  // artifact (parseImportFile stamps it with the wall clock when a record
  // first lacks a tag), not observation content — comparing it would flag the
  // same session as conflicting with itself across repeated exports.
  const materialJson = (row) => {
    if(!row || typeof row !== 'object') return canonicalJson(row);
    const { sourceTaggedAt, ...material } = row;
    return canonicalJson(material);
  };
  const aHist = new Map((a.history || []).map(h => [String(h?.id), h]));
  for(const h of (b.history || [])){
    const old = aHist.get(String(h?.id));
    if(!old) continue;
    if(materialJson(old) !== materialJson(h)){
      conflicts.push(`history:${h.id}`);
    }
  }
  // Events: same id, different payload — type, timestamp, or measurement
  // (logging-time elapsedMs, acceptance). These feed product metrics and
  // friction completeness, so disagreements are disclosed, never dropped.
  const aEv = new Map((a.eventHistory || []).map(e => [String(e?.id), e]));
  for(const e of (b.eventHistory || [])){
    const old = aEv.get(String(e?.id));
    if(!old) continue;
    if(canonicalJson(old) !== canonicalJson(e)){
      conflicts.push(`event:${e.id}`);
    }
  }
  if(conflicts.length){
    warnings.push(warn('conflicting-record', fileName, `same-id records differ (${conflicts.slice(0, 5).join(', ')}${conflicts.length > 5 ? `, +${conflicts.length - 5} more` : ''}) — merge keeps the resolved/newest copy, nothing deleted`));
  }
  // Impossible arm change: the same exercise assigned to different arms in two
  // enrollments of ONE participant. Assignment is deterministic per (id,
  // exercise, seed) — divergence means tampering or a regeneration bug.
  const aAssign = a.studyEnrollment?.assignments || {};
  const bAssign = b.studyEnrollment?.assignments || {};
  const flips = [];
  for(const [exerciseId, entry] of Object.entries(bAssign)){
    const other = aAssign[exerciseId]?.arm;
    if(other && entry?.arm && other !== entry.arm) flips.push(`${exerciseId}: ${other}→${entry.arm}`);
  }
  if(flips.length){
    warnings.push(warn('impossible-arm', fileName, `arm assignment changed for one participant (${flips.slice(0, 5).join(', ')}) — keeping the earliest frozen assignment`));
    // Re-stamp the incoming assignment map with the earliest enrollment's arms
    // so the merged store cannot carry both stories. The incoming enrollment
    // object is replaced wholesale only when the EARLIER one is complete.
    const enrollment = { ...(b.studyEnrollment || {}) };
    enrollment.assignments = { ...bAssign };
    for(const exerciseId of Object.keys(enrollment.assignments)){
      if(aAssign[exerciseId]?.arm) enrollment.assignments[exerciseId] = aAssign[exerciseId];
    }
    b.studyEnrollment = enrollment;
  }
}

// Lifecycle state per participant, resolved from store facts (never inferred
// from file order): withdrawn if studyStatus === 'withdrawn', else active /
// lapsed by recency of the last logged session.
function lifecycleOf(store, todayStr){
  if(store?.studyStatus === 'withdrawn') return 'withdrawn';
  const dates = (store?.history || []).map(h => h?.dateISO).filter(Boolean).sort();
  const last = dates[dates.length - 1];
  if(!last) return 'no-sessions';
  const gap = daysBetween(last, todayStr);
  if(gap == null) return 'no-sessions';
  return gap <= ACTIVE_WINDOW_DAYS ? 'active' : 'lapsed';
}

// ── Contributor predicate (single definition, shared wording) ───────────
// A participant CONTRIBUTES when they are identified (by construction here —
// unidentified exports never reach summariseCohort), consented, and hold at
// least one VALID resolved assigned-arm transition: live-engine provenance on
// both sides (isProspectiveRecord), assigned to a primary study arm, resolved
// with a graded assignedMet. This mirrors pooledAssignedComparison's row
// filters exactly, so cohortOps, fieldStudy and every rendered report state
// the same participant counts. Invariant: no usable assigned evidence → no
// participant credit; enrolled-but-empty people cannot satisfy the gate.
function contributingTransitionsOf(store){
  const ledger = Array.isArray(store?.evaluationLedger) ? store.evaluationLedger : [];
  // THE canonical predicate — no local equivalent filter.
  return ledger.filter(r => isValidAssignedStudyTransition(r));
}

function summariseParticipantRow(p, todayStr){
  const store = p.store || {};
  const history = Array.isArray(store.history) ? store.history : [];
  const ledger = Array.isArray(store.evaluationLedger) ? store.evaluationLedger : [];
  const enrollment = store.studyEnrollment || null;
  const arms = Object.values(enrollment?.assignments || {}).map(a => a?.arm).filter(Boolean);
  const dates = history.map(h => h?.dateISO).filter(Boolean).sort();
  const first = dates[0] || null;
  const last = dates[dates.length - 1] || null;
  const lifecycle = lifecycleOf(store, todayStr);
  const scheduled = (store.activeSchedule?.sessions || []);
  const scheduledIds = new Set(scheduled.map(s => s.id));
  const doneIds = new Set(history.map(h => h.id));
  const assignedTransitions = ledger.filter(r => r?.assignedArm && r?.outcome?.assignedMet != null).length;
  const openRecommendations = ledger.filter(r => r?.recommendation && !r?.outcome).length;
  const consented = store.preferences?.telemetryEnabled === true;
  const valid = contributingTransitionsOf(store);
  const contributorArms = {
    arise: valid.some(r => r.assignedArm === PRIMARY_STUDY_ARMS[0]),
    'double-progression': valid.some(r => r.assignedArm === PRIMARY_STUDY_ARMS[1]),
  };
  return {
    code: p.code,
    studyParticipantId: p.studyParticipantId || null,
    lifecycle,
    enrolled: Boolean(enrollment),
    enrolledAtISO: enrollment?.enrolledAtISO || null,
    withdrawnAtISO: store.studyStatus === 'withdrawn' ? (store.studyStatusChangedAtISO || null) : null,
    sessions: history.length,
    firstSessionISO: first,
    lastSessionISO: last,
    daysSinceLastSession: last ? daysBetween(last, todayStr) : null,
    weeksObserved: new Set(history.map(h => mondayKey(h.dateISO)).filter(Boolean)).size,
    scheduledSessions: scheduled.length,
    scheduledDone: scheduled.filter(s => doneIds.has(s.id) || s.status === 'done').length,
    assignedTransitions,
    openRecommendations,
    consented,
    assignedExercises: arms.length,
    armBalance: {
      arise: arms.filter(a => a === 'arise').length,
      'double-progression': arms.filter(a => a === 'double-progression').length,
    },
    exportCount: (p.sourceFiles || []).length,
    firstExportedAtISO: p.firstExportedAtISO || null,
    lastExportedAtISO: p.lastExportedAtISO || null,
    // Contributor facts (see contributingTransitionsOf): the gate reads these,
    // and the report shows them so "enrolled but empty" is always visible.
    contributingTransitions: valid.length,
    contributorArms,
    isContributor: consented && (contributorArms.arise || contributorArms['double-progression']),
    // Observation gaps that a data-quality reviewer should see per person:
    missing: {
      consent: store.preferences?.telemetryEnabled !== true,
      readinessDates: (store.readinessLog || []).filter(r => !r?.dateISO).length,
      undatedSessions: history.filter(h => !h?.dateISO).length,
    },
  };
}

export function summariseCohort(participants, { config = null, nowISO = null, gates = ANALYSIS_GATES } = {}){
  const cfg = resolveArisePriors(config);
  const todayStr = todayISO(nowISO);
  const rows = (participants || []).map(p => summariseParticipantRow(p, todayStr));

  // Cohort-level totals.
  const totals = {
    participants: rows.length,
    enrolled: rows.filter(r => r.enrolled).length,
    // Contributor accounting per the shared definition: identified (by
    // construction) + consented + ≥1 valid resolved assigned-arm transition.
    contributors: rows.filter(r => r.isContributor).length,
    contributorsArise: rows.filter(r => r.contributorArms.arise).length,
    contributorsDoubleProgression: rows.filter(r => r.contributorArms['double-progression']).length,
    active: rows.filter(r => r.lifecycle === 'active').length,
    lapsed: rows.filter(r => r.lifecycle === 'lapsed').length,
    withdrawn: rows.filter(r => r.lifecycle === 'withdrawn').length,
    noSessions: rows.filter(r => r.lifecycle === 'no-sessions').length,
    consented: rows.filter(r => r.consented).length,
    sessions: rows.reduce((n, r) => n + r.sessions, 0),
    assignedTransitions: rows.reduce((n, r) => n + r.assignedTransitions, 0),
    openRecommendations: rows.reduce((n, r) => n + r.openRecommendations, 0),
    exports: rows.reduce((n, r) => n + r.exportCount, 0),
  };
  const withSessions = rows.filter(r => r.sessions > 0);
  totals.medianSessionsPerParticipant = median(withSessions.map(r => r.sessions));
  totals.medianTransitionsPerParticipant = median(withSessions.map(r => r.assignedTransitions).filter(n => n > 0));

  // Sessions per participant distribution (contribution balance).
  const contribution = rows
    .map(r => ({ code: r.code, sessions: r.sessions, transitions: r.assignedTransitions, lifecycle: r.lifecycle, exportCount: r.exportCount, lastSessionISO: r.lastSessionISO }))
    .sort((a, b) => b.sessions - a.sessions || a.code.localeCompare(b.code));
  const totalSessions = totals.sessions;
  // Share of sessions captured by the top quintile of participants — the
  // single number that says whether the cohort is one workhorse plus ghosts.
  const topCount = Math.max(1, Math.ceil(rows.length / 5));
  const topShare = totalSessions ? round(contribution.slice(0, topCount).reduce((n, r) => n + r.sessions, 0) / totalSessions) : null;
  // Gini-style concentration: 0 = perfectly balanced, 1 = one person does all.
  const concentration = totalSessions ? gini(rows.map(r => r.sessions)) : null;

  // Arm balance across the cohort (assigned exercises per participant summed).
  const armTotals = { arise: 0, 'double-progression': 0 };
  for(const r of rows){ armTotals.arise += r.armBalance.arise; armTotals['double-progression'] += r.armBalance['double-progression']; }
  const armBalance = {
    assignedExercises: armTotals.arise + armTotals['double-progression'],
    arise: armTotals.arise,
    'double-progression': armTotals['double-progression'],
    ariseShare: pct(armTotals.arise, armTotals.arise + armTotals['double-progression']),
  };
  // Transitions per arm, counted through THE canonical predicate and
  // de-duplicated across exports the same way the analysis dedupes (same
  // prospectiveTransitionKey + arm folds). Every other row lands in a
  // separate reported bucket — unassigned, open, unproven, ungraded — so
  // nothing silently disappears and nothing invalid helps a gate.
  const transitionsByArm = { arise: 0, 'double-progression': 0, unassigned: 0, open: 0, unproven: 0, ungraded: 0, duplicate: 0 };
  const seenKeys = new Set();
  for(const p of (participants || [])){
    for(const row of (p.store?.evaluationLedger || [])){
      if(!row?.recommendation) continue;
      if(!row.outcome){ transitionsByArm.open++; continue; }
      if(!PRIMARY_STUDY_ARMS.includes(row.assignedArm)){ transitionsByArm.unassigned++; continue; }
      if(!isValidAssignedStudyTransition(row)){
        if(row.outcome.assignedMet == null) transitionsByArm.ungraded++;
        else transitionsByArm.unproven++;
        continue;
      }
      // Same dedupe identity the analysis uses — repeated exports fold, while
      // different people never collide (identity is stamped into the key the
      // same way pooledAssignedComparison stamps participantId onto rows).
      const key = `${p.studyParticipantId || p.code || 'anonymous'}::${prospectiveTransitionKey({ ...row, participantId: row.participantId ?? p.studyParticipantId ?? p.code })}::${row.assignedArm}`;
      if(seenKeys.has(key)){ transitionsByArm.duplicate++; continue; }
      seenKeys.add(key);
      transitionsByArm[row.assignedArm]++;
    }
  }
  armBalance.ledgerTransitions = transitionsByArm;

  // Resolved transitions per arm — the denominators the analysis gates read.

  // Data-quality warnings derivable from store contents themselves.
  const quality = dataQualityWarnings(rows);

  // Gate eligibility: never rank treatments until these clear. THE canonical
  // readiness evaluation (studyReadiness.evaluateStudyReadiness) decides —
  // the exact same call computeFieldStudy makes, so cohort.gate.eligible,
  // fieldStudy status, assigned.gates.sufficient and claim readiness are one
  // result rendered four ways. Breadth counts CONTRIBUTORS (identified,
  // consented, ≥1 valid resolved assigned transition); depth counts only
  // valid transitions (total = valid arise + valid double-progression).
  const readiness = evaluateStudyReadiness(
    {
      transitionsArise: transitionsByArm.arise,
      transitionsDoubleProgression: transitionsByArm['double-progression'],
      transitionsTotal: transitionsByArm.arise + transitionsByArm['double-progression'],
      contributors: {
        total: totals.contributors,
        arise: totals.contributorsArise,
        'double-progression': totals.contributorsDoubleProgression,
      },
    },
    gates,
  );
  const gate = {
    minParticipants: gates.minContributors,
    minTransitions: gates.minTransitions,
    minTransitionsPerArm: gates.minTransitionsPerArm,
    participants: readiness.gates.contributors.total,
    identifiedParticipants: totals.participants,
    contributors: readiness.gates.contributors,
    transitions: readiness.gates.transitionsTotal,
    transitionsArise: readiness.gates.transitionsArise,
    transitionsDoubleProgression: readiness.gates.transitionsDoubleProgression,
    eligible: readiness.ready,
    reasons: readiness.reasons,
    deficits: {
      participants: Math.max(0, gates.minContributors - readiness.gates.contributors.total),
      transitions: Math.max(0, gates.minTransitions - readiness.gates.transitionsTotal),
      arise: Math.max(0, gates.minTransitionsPerArm - readiness.gates.transitionsArise),
      'double-progression': Math.max(0, gates.minTransitionsPerArm - readiness.gates.transitionsDoubleProgression),
    },
    rankingAllowed: false, // recomputed below
  };
  gate.rankingAllowed = gate.eligible;

  return {
    generatedAtISO: nowISO ? new Date(`${todayStr}T00:00:00Z`).toISOString() : new Date().toISOString(),
    activeWindowDays: ACTIVE_WINDOW_DAYS,
    totals,
    participants: rows,
    contribution: { topQuintileSessionShare: topShare, concentration: concentration, ranking: contribution },
    armBalance,
    gate,
    quality,
    missingObservations: missingObservationsSummary(rows, cfg),
    loggingFrictionCompleteness: frictionCompleteness(participants),
    unresolvedRecommendations: {
      total: totals.openRecommendations,
      byParticipant: rows.filter(r => r.openRecommendations > 0).map(r => ({ code: r.code, open: r.openRecommendations })),
    },
  };
}

function mondayKey(dateISO){
  const d = new Date(`${dateISO}T00:00:00Z`);
  if(Number.isNaN(d.getTime())) return null;
  const m = new Date(d); m.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return m.toISOString().slice(0, 10);
}

function median(values){
  const list = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
  if(!list.length) return 0;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

function gini(values){
  const list = (values || []).filter(v => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const n = list.length;
  if(!n) return 0;
  const sum = list.reduce((a, b) => a + b, 0);
  if(!sum) return 0;
  let cum = 0;
  for(const [i, v] of list.entries()) cum += (i + 1) * v;
  return round((2 * cum) / (n * sum) - (n + 1) / n, 3);
}

// Data-quality warnings from store contents (complementing the file-level
// warnings from ingestParticipantFiles).
// (rows only — file-level anomalies live in ingest warnings, store-level ones here)
function dataQualityWarnings(rows){
  const out = [];
  for(const r of rows){
    if(r.missing.undatedSessions) out.push({ participant: r.code, kind: 'undated-sessions', detail: `${r.missing.undatedSessions} session(s) without a parseable date` });
    if(r.missing.readinessDates) out.push({ participant: r.code, kind: 'undated-readiness', detail: `${r.missing.readinessDates} readiness entr(ies) without a date — excluded from readiness segmentation` });
    if(r.enrolled && !r.consented) out.push({ participant: r.code, kind: 'enrolled-without-consent', detail: 'enrollment present but measurement consent is off — assigned transitions cannot be collected' });
    if(r.assignedTransitions > 0 && !r.enrolled && r.lifecycle !== 'withdrawn') out.push({ participant: r.code, kind: 'transitions-without-enrollment', detail: 'assigned-arm transitions present without an enrollment — check study-version history (a WITHDRAWN participant keeps their assigned history by design, so they are not flagged)' });
  }
  return out;
}

// Missing-observation summary: consent, readiness dates and timing consent are
// the three observation streams the study reads; each reports how many
// participants are missing it.
function missingObservationsSummary(rows){
  return {
    consentMissing: rows.filter(r => r.missing.consent).length,
    sessionsUndated: rows.reduce((n, r) => n + r.missing.undatedSessions, 0),
    readinessUndated: rows.reduce((n, r) => n + r.missing.readinessDates, 0),
    note: 'Missing observations are reported per stream with n; they are never imputed.',
  };
}

// Logging-friction completeness: how much of the friction telemetry the cohort
// could have produced is actually present (timing consent is a separate
// refinement, so completeness has two tiers).
export function frictionCompleteness(participants){
  let withEvents = 0, withTimings = 0;
  for(const p of (participants || [])){
    const events = p.store?.eventHistory || [];
    const interactionTypes = new Set(['recommendation:shown', 'recommendation:accepted', 'set:complete', 'complete-set', 'session:start']);
    if(events.some(e => interactionTypes.has(e?.type))) withEvents++;
    if(events.some(e => Number.isFinite(Number(e?.elapsedMs)))) withTimings++;
  }
  const n = (participants || []).length;
  return {
    participants: n,
    withInteractionEvents: withEvents,
    withTimingEvents: withTimings,
    interactionCompleteness: pct(withEvents, n),
    timingCompleteness: pct(withTimings, n),
    note: 'Timing medians degrade to null without the sessionTimings refinement; counts survive without it.',
  };
}

// ── Markdown rendering ──────────────────────────────────────────────────

export function renderCohortReport(summary, { ingest = null } = {}){
  const L = [];
  L.push('# Cohort operations report');
  L.push('');
  L.push(`Generated ${summary.generatedAtISO} · activity window ${summary.activeWindowDays} days`);
  L.push('');
  const t = summary.totals;
  L.push('## Enrollment & activity');
  L.push('');
  L.push('| Metric | Value |');
  L.push('|---|---|');
  L.push(`| Participants (unique people) | ${t.participants} |`);
  L.push(`| Enrolled in the randomised study | ${t.enrolled} |`);
  L.push(`| Contributing (consented + ≥1 valid resolved assigned transition) | ${t.contributors} |`);
  L.push(`| Contributing · arise arm | ${t.contributorsArise} |`);
  L.push(`| Contributing · double-progression arm | ${t.contributorsDoubleProgression} |`);
  L.push(`| Active (session ≤${summary.activeWindowDays}d) | ${t.active} |`);
  L.push(`| Lapsed | ${t.lapsed} |`);
  L.push(`| Withdrawn | ${t.withdrawn} |`);
  L.push(`| Consented (telemetry on) | ${t.consented} |`);
  L.push(`| Sessions logged (total) | ${t.sessions} |`);
  L.push(`| Median sessions per participant | ${t.medianSessionsPerParticipant} |`);
  L.push(`| Assigned transitions (total) | ${t.assignedTransitions} |`);
  L.push(`| Median transitions per participant | ${t.medianTransitionsPerParticipant} |`);
  L.push(`| Exports received | ${t.exports} |`);
  if(ingest){
    L.push('');
    L.push('## Ingestion');
    L.push('');
    L.push(`Files read ${ingest.counts.files} → ${ingest.counts.uniqueParticipants} unique participants · ${ingest.counts.duplicateFiles} duplicate file(s) · ${ingest.counts.importErrors} import error(s) · ${ingest.counts.unidentifiedExports} export(s) without a valid study id.`);
  }
  L.push('');
  L.push('## Treatment arms (operations view)');
  L.push('');
  L.push('Assigned exercises and ledger transitions per arm. This is a BALANCE report, not a comparison — arms are never ranked here.');
  L.push('');
  L.push('| Arm | Exercises assigned | Resolved transitions |');
  L.push('|---|---|---|');
  L.push(`| arise | ${summary.armBalance.arise} | ${summary.armBalance.ledgerTransitions.arise} |`);
  L.push(`| double-progression | ${summary.armBalance['double-progression']} | ${summary.armBalance.ledgerTransitions['double-progression']} |`);
  L.push(`| (unassigned rows) | — | ${summary.armBalance.ledgerTransitions.unassigned} |`);
  L.push(`| (open, awaiting outcome) | — | ${summary.armBalance.ledgerTransitions.open} |`);
  L.push(`| (resolved but unproven provenance) | — | ${summary.armBalance.ledgerTransitions.unproven} |`);
  L.push(`| (resolved but ungraded) | — | ${summary.armBalance.ledgerTransitions.ungraded} |`);
  L.push(`| (cross-export duplicates, folded) | — | ${summary.armBalance.ledgerTransitions.duplicate} |`);
  L.push('');
  L.push(`Arm balance: arise share ${summary.armBalance.ariseShare == null ? '—' : `${Math.round(summary.armBalance.ariseShare * 100)}%`} of assigned exercises.`);
  L.push('');
  L.push('## Analysis gate eligibility');
  L.push('');
  L.push('| Gate | Need | Have | Met |');
  L.push('|---|---|---|---|');
  const g = summary.gate;
  L.push(`| Contributing participants | ${g.minParticipants} | ${g.participants} | ${g.participants >= g.minParticipants ? '✓' : `need ${g.deficits.participants} more`} |`);
  L.push(`| Assigned transitions | ${g.minTransitions} | ${g.transitions} | ${g.transitions >= g.minTransitions ? '✓' : `need ${g.deficits.transitions} more`} |`);
  L.push(`| Transitions · arise | ${g.minTransitionsPerArm} | ${g.transitionsArise} | ${g.transitionsArise >= g.minTransitionsPerArm ? '✓' : `need ${g.deficits.arise} more`} |`);
  L.push(`| Transitions · double-progression | ${g.minTransitionsPerArm} | ${g.transitionsDoubleProgression} | ${g.transitionsDoubleProgression >= g.minTransitionsPerArm ? '✓' : `need ${g.deficits['double-progression']} more`} |`);
  L.push('');
  L.push(g.eligible
    ? '**Gates met.** Effectiveness analysis (field study) may run — rankings come only from that prespecified pipeline, never from this report.'
    : '**Gates unmet — no treatment comparison is made.** Any arm ranking before these gates clear would read noise as signal.');
  L.push('');
  L.push('## Participant contribution balance');
  L.push('');
  L.push(`Top-quintile session share ${summary.contribution.topQuintileSessionShare == null ? '—' : `${Math.round(summary.contribution.topQuintileSessionShare * 100)}%`} · concentration (Gini) ${summary.contribution.concentration ?? '—'} (0 = balanced, 1 = one person does everything).`);
  L.push('');
  L.push('| Participant | Lifecycle | Sessions | Transitions | Exports | Last session |');
  L.push('|---|---|---|---|---|---|');
  for(const r of summary.contribution.ranking){
    L.push(`| ${r.code} | ${r.lifecycle} | ${r.sessions} | ${r.transitions} | ${r.exportCount ?? '—'} | ${r.lastSessionISO ?? '—'} |`);
  }
  L.push('');
  L.push('## Data quality');
  L.push('');
  const q = summary.quality;
  if(!q.length){
    L.push('No store-level data-quality issues detected in this cohort.');
  }else{
    L.push('| Participant | Kind | Detail |');
    L.push('|---|---|---|');
    for(const w of q) L.push(`| ${w.participant} | ${w.kind} | ${w.detail} |`);
  }
  if(ingest && ingest.warnings.length){
    L.push('');
    L.push('### File-level warnings');
    L.push('');
    L.push('| File | Kind | Detail |');
    L.push('|---|---|---|');
    for(const w of ingest.warnings) L.push(`| ${w.file} | ${w.kind} | ${w.detail} |`);
  }
  const mo = summary.missingObservations;
  L.push('');
  L.push('## Missing observations');
  L.push('');
  L.push(`Consent missing for ${mo.consentMissing}/${t.participants} participants · ${mo.sessionsUndated} undated session rows · ${mo.readinessUndated} undated readiness entries. ${mo.note}`);
  const fr = summary.loggingFrictionCompleteness;
  L.push('');
  L.push(`Logging-friction completeness: interaction events ${fr.withInteractionEvents}/${fr.participants} (${fr.interactionCompleteness == null ? '—' : `${Math.round(fr.interactionCompleteness * 100)}%`}) · timing events ${fr.withTimingEvents}/${fr.participants} (${fr.timingCompleteness == null ? '—' : `${Math.round(fr.timingCompleteness * 100)}%`}). ${fr.note}`);
  L.push('');
  L.push('## Unresolved recommendations');
  L.push('');
  L.push(`${summary.unresolvedRecommendations.total} open recommendation record(s) awaiting their outcome.`);
  if(summary.unresolvedRecommendations.byParticipant.length){
    L.push('');
    L.push(summary.unresolvedRecommendations.byParticipant.map(r => `${r.code}: ${r.open}`).join(' · '));
  }
  L.push('');
  return L.join('\n');
}
