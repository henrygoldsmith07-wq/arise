// studyReadiness.js — THE canonical definition of study readiness.
//
// One predicate, one gate configuration, one readiness result, consumed by
// cohort operations (cohortOps.js), causal analysis (fieldStudy.js) and every
// rendered report. Nothing else may re-implement an equivalent filter or a
// parallel threshold set: when these definitions change, every readiness
// surface changes with them, and no report can say "sufficient" while another
// says "gates unmet".
//
// THE PREDICATE — what counts as usable evidence:
//   isValidAssignedStudyTransition(row) requires ALL of:
//     • a recommendation exists (it is a recommendation-ledger row at all);
//     • genuine prospective/live provenance on the recommendation
//       (live-engine, never import/replay/seed);
//     • genuine live outcome provenance;
//     • the row is assigned to a primary study arm (arise or
//       double-progression) — shadow rows never count;
//     • the outcome is resolved; and
//     • assignedMet is graded (not null/undefined).
//
// THE GATES — one threshold set for operations and analysis alike:
//   minContributors 10 · minTransitions 1000 · minTransitionsPerArm 400
//   At least 400 valid transitions must come from each primary arm. The
//   remaining 200+ transitions must also be valid assigned transitions and
//   may be distributed across either primary arm.
//
// THE RULES the canonical evaluation enforces:
//   • total transitions = valid arise + valid double-progression. Unassigned,
//     open, malformed, imported/unproven, duplicate or unresolved rows never
//     help satisfy any gate — they are reported separately instead.
//   • Contribution requires identity: unidentified exports never earn
//     breadth credit, and unconsented participants contribute nothing.
//   • Cross-export duplicate rows collapse before counting (same
//     prospectiveTransitionKey + arm folds to one transition), so repeated
//     exports cannot inflate either the depth or the breadth gate.
//   • Readiness is computed ONCE and reused everywhere, so
//     cohort.gate.eligible, fieldStudy status, assigned.gates.sufficient and
//     claim readiness can never disagree.

import { isProspectiveRecord, isProspectiveRecommendation } from './longitudinalCore.js';
import { prospectiveTransitionKey } from './evaluation.js';

// Primary assigned arms — the only rows that can ever count as evidence.
export const PRIMARY_STUDY_ARMS = Object.freeze(['arise', 'double-progression']);

// THE shared gate configuration. study-report.mjs, cohortOps and fieldStudy
// all read these; CLI overrides exist only for exploration and must never be
// used to declare readiness in production reporting.
export const STUDY_GATES = Object.freeze({
  minContributors: 10,
  minTransitions: 1000,
  minTransitionsPerArm: 400,
});

// ── The one transition predicate ─────────────────────────────────────────
// True only for a usable assigned-arm study transition. This exact function
// is the sole authority on whether a ledger row counts — no consumer may
// maintain an equivalent filter.
export function isValidAssignedStudyTransition(row){
  return Boolean(
    row
    && row.recommendation
    && isProspectiveRecommendation(row)      // live-engine recommendation provenance
    && isProspectiveRecord(row)              // + resolved with live-engine outcome provenance
    && PRIMARY_STUDY_ARMS.includes(row.assignedArm)
    && row.outcome
    && row.outcome.assignedMet != null
  );
}

// Partition a ledger (or row list) once, canonically: valid rows per arm,
// plus every exclusion bucket reported separately so nothing disappears.
export function evaluateTransitionEvidence(rows){
  const valid = { arise: [], 'double-progression': [] };
  const invalid = { noRecommendation: 0, open: 0, unassigned: 0, unproven: 0, ungraded: 0 };
  for(const row of (rows || [])){
    if(!row || typeof row !== 'object') { invalid.noRecommendation++; continue; }
    if(!row.recommendation){ invalid.noRecommendation++; continue; }
    if(!row.outcome){ invalid.open++; continue; }
    if(!PRIMARY_STUDY_ARMS.includes(row.assignedArm)){ invalid.unassigned++; continue; }
    if(!isProspectiveRecord(row)){ invalid.unproven++; continue; }
    if(row.outcome.assignedMet == null){ invalid.ungraded++; continue; }
    valid[row.assignedArm].push(row);
  }
  return { valid, invalid };
}

// Canonical validity, dedupe and contributor accounting for a set of
// participant packages (the shapes both cohortOps ingestion and fieldStudy
// consume). Dedupe folds cross-export repeats of the same transition
// (same prospectiveTransitionKey + arm) so repeated exports cannot inflate
// depth — the same folds pooledAssignedComparison has always applied.
export function countStudyEvidence(participants, { config = null } = {}){
  const validByArm = { arise: new Map(), 'double-progression': new Map() };
  const invalid = { noRecommendation: 0, open: 0, unassigned: 0, unproven: 0, ungraded: 0, unidentified: 0 };
  const contributors = new Map(); // participant code → Set<arm>
  for(const p of (participants || [])){
    const store = p?.store || {};
    const consented = store?.preferences?.telemetryEnabled === true;
    const identity = p.studyParticipantId || store?.studyParticipantId || null;
    if(!identity){
      // An unidentified export is not a participant: no breadth credit, and
      // its rows can never be attributed to anyone, so no depth credit either.
      // The rows are still reported — never silently dropped.
      for(const row of (Array.isArray(store.evaluationLedger) ? store.evaluationLedger : [])){
        if(row && typeof row === 'object') invalid.unidentified++;
      }
      continue;
    }
    const code = identity;
    for(const row of (Array.isArray(store.evaluationLedger) ? store.evaluationLedger : [])){
      if(!isValidAssignedStudyTransition(row)){
        // Bucket invalid rows for reporting (never hidden), but only rows
        // that even look like recommendation rows; bare junk stays uncounted.
        if(row && typeof row === 'object'){
          if(!row.recommendation) invalid.noRecommendation++;
          else if(!row.outcome) invalid.open++;
          else if(!PRIMARY_STUDY_ARMS.includes(row.assignedArm)) invalid.unassigned++;
          else if(!isProspectiveRecord(row)) invalid.unproven++;
          else invalid.ungraded++;
        }
        continue;
      }
      if(!consented) continue; // unconsented data contributes nothing
      // Dedupe identity: the same transition repeated across exports folds;
      // different people never collide (participant identity is stamped into
      // the key exactly as pooledAssignedComparison stamps participantId).
      const key = `${code}::${prospectiveTransitionKey({ ...row, participantId: row.participantId ?? code })}::${row.assignedArm}`;
      const bucket = validByArm[row.assignedArm];
      const first = !bucket.has(key);
      if(first) bucket.set(key, row);
      else continue; // cross-export duplicate: folds, never inflates
      let arms = contributors.get(code);
      if(!arms){ arms = new Set(); contributors.set(code, arms); }
      arms.add(row.assignedArm);
      void config;
    }
  }
  const arise = validByArm.arise.size;
  const dp = validByArm['double-progression'].size;
  return {
    transitionsArise: arise,
    transitionsDoubleProgression: dp,
    transitionsTotal: arise + dp, // total = valid arise + valid double-progression
    contributors: {
      total: contributors.size,
      arise: [...contributors.values()].filter(a => a.has('arise')).length,
      'double-progression': [...contributors.values()].filter(a => a.has('double-progression')).length,
    },
    invalid,
  };
}

// THE one readiness result. Both cohortOps.gate and fieldStudy gates derive
// from this, so status and claim readiness can never disagree.
export function evaluateStudyReadiness(evidence, gates = STUDY_GATES){
  const minContributors = gates.minContributors ?? 10;
  const minTransitions = gates.minTransitions ?? 1000;
  const minPerArm = gates.minTransitionsPerArm ?? 400;
  const contributors = evidence.contributors.total;
  const perArmMinimum = Math.min(minPerArm, Math.floor(minTransitions / 2));
  const reasons = [];
  if(contributors < minContributors) reasons.push(`only ${contributors} contributing participants (need ${minContributors}+)`);
  if(evidence.transitionsTotal < minTransitions) reasons.push(`only ${evidence.transitionsTotal} valid assigned transitions (need ${minTransitions}+)`);
  if(evidence.transitionsArise < perArmMinimum) reasons.push(`only ${evidence.transitionsArise} valid arise transitions (need ${perArmMinimum}+)`);
  if(evidence.transitionsDoubleProgression < perArmMinimum) reasons.push(`only ${evidence.transitionsDoubleProgression} valid double-progression transitions (need ${perArmMinimum}+)`);
  if(contributors < 2) reasons.push('fewer than 2 participants — no clustered uncertainty');
  return {
    ready: reasons.length === 0,
    reasons,
    gates: {
      minContributors,
      minTransitions,
      minTransitionsPerArm: perArmMinimum,
      contributors: evidence.contributors,
      transitionsArise: evidence.transitionsArise,
      transitionsDoubleProgression: evidence.transitionsDoubleProgression,
      transitionsTotal: evidence.transitionsTotal,
    },
    // Frozen view for reports: status wording stays identical everywhere.
    status: reasons.length === 0 ? 'sufficient-evidence' : 'insufficient-evidence',
  };
}
