// longitudinalCore.js � shared constants and helpers for the evaluation
// ledger (ADR 0007). Split from longitudinal.js so the pure aggregation in
// evaluation.js can import these without touching storage or consent logic.

export const EVALUATION_SCHEMA_VERSION = 2;

// ── Statistics helpers ──────────────────────────────────────────────────
// Wilson score interval: honest uncertainty for proportion estimates even at
// small n (a 3/3 rate must NOT read as "certainly 100%").
export function wilsonInterval(successes, n, z = 1.96){
  const s = Number(successes), total = Number(n);
  if(!total || total < 0 || s < 0 || s > total) return null;
  const p = s / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denom;
  // The variance term divides by n, not by the (1+z²/n) denominator — the
  // textbook Wilson interval. Dividing by the denominator too makes intervals
  // materially too wide (100/100 reported low≈0.81 instead of ≈0.97), which
  // read as "we know nothing" exactly when the evidence was strongest.
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denom;
  return {
    low: round(Math.max(0, centre - spread), 3),
    high: round(Math.min(1, centre + spread), 3),
  };
}

// Flag an open recommendation as overridden by the user (they edited targets
// away from the engine's prescription before logging). Studies can then
// separate "engine decided" transitions from "user decided" ones.

export const EVALUATION_KEY = 'arise.evaluation.v1';

// ── Canonical participant identity ───────────────────────────────────────
// ONE helper decides who counts as a participant, everywhere: recording,
// primary assigned-arm analysis, pooled field-study aggregation, confidence
// gates and clustering. The invariant it enforces:
//   a participant identity is a PERSON/STORE, never an exercise or session —
//   one person must never become multiple statistical participants simply
//   because they performed multiple exercises.
//
// Rules (canonical, no local overrides):
//   row.participantId present (string, non-empty) → that id, trimmed;
//   otherwise                        → ONE shared anonymous-local participant
//     ('anonymous-local'), because a single store with no study id is one
//     person by construction.
// Pooled/imported datasets stamp each store's rows with its participant id
// BEFORE aggregation, so store boundaries — the only honest unit of
// independence available — remain distinct participants there. Exercise- or
// session-derived fallbacks (e.g. `exerciseId::anonymous`) are forbidden;
// they inflate participant counts, clustered CIs and gates per exercise.
export const ANONYMOUS_LOCAL_PARTICIPANT = 'anonymous-local';
export function participantOf(record){
  const id = record?.participantId;
  if(typeof id === 'string' && id.trim() !== '') return id.trim();
  // Legacy/foreign shapes: participantId carried under participant (pooled
  // bootstrap pairs). Same rule — present id or the single anonymous store.
  const alt = record?.participant;
  if(typeof alt === 'string' && alt.trim() !== '') return alt.trim();
  return ANONYMOUS_LOCAL_PARTICIPANT;
}
// Pooled store stamping: an imported store IS one participant (its study id
// when present, else a store-scoped anonymous id). Distinct stores stay
// distinct; rows from the same store always cluster together.
export function participantOfStore(store, fallback = 'store-anonymous'){
  const id = store?.studyParticipantId ?? store?.participantId;
  if(typeof id === 'string' && id.trim() !== '') return id.trim();
  return String(fallback);
}

const SCALE = 100;

export function round(value, digits = 3){
  if(!Number.isFinite(Number(value))) return null;
  const p = 10 ** digits;
  return Math.round(Number(value) * p) / p;
}

export function parseReps(value){
  const match = String(value ?? '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

export function e1rm(weightKg, reps){
  const w = Number(weightKg) || 0;
  const r = parseReps(reps);
  return w > 0 && r > 0 ? w * (1 + r / 30) : 0;
}

export function hasConsent(preferences){
  return preferences?.telemetryEnabled === true;
}



export function bestSetOfBlock(block){
  let best = null;
  for(const set of block?.sets || []){
    const reps = parseReps(set.reps);
    const weightKg = Number(set.weightKg) || 0;
    const score = e1rm(weightKg, reps) || reps;
    if(reps > 0 && (!best || score > best.score)){
      best = { reps, weightKg, assistedKg: Number(set.assistedKg) || 0, rpe: set.rpe ?? null, score };
    }
  }
  return best;
}

// ── Outcome labels + calibration primitives (ADR 0007, phase 2) ───────────
// Pure, shared by longitudinal.js (writes outcome.label) and evaluation.js
// (aggregates calibration) so both grade a recommendation→outcome pair with the
// EXACT same conservative rules. No import of the engine or the ledger — these
// modules import longitudinalCore, never the reverse.

// The five named outcome labels. Conservative by construction: an unattempted
// or un-followed prescription is 'insufficient-evidence', never blamed.
export const RECOMMENDATION_OUTCOME_LABELS = Object.freeze([
  'successful',
  'neutral',
  'too-aggressive',
  'too-conservative',
  'insufficient-evidence',
]);

// Prospective vs resolved-evidence, split into two helpers so open
// recommendations are never mislabelled:
//   isProspectiveRecommendation — the RECOMMENDATION was recorded live
//     (live-engine). True the moment it is recorded, open or resolved.
//   isProspectiveRecord — RESOLVED first-party evidence: a live recorded
//     recommendation PLUS a live measured outcome. This is the gate every
//     calibration/study rollup must use; open rows and rows whose outcome
//     arrived by import/replay/seed (or is missing) never pass it.
// Core invariant: prospective begins when a live recommendation is recorded;
// trusted resolved evidence requires both live sides.
export function isProspectiveRecommendation(record){
  return record?.provenance?.origin === 'live-engine';
}
export function isResolvedProspectiveEvidence(record){
  return record?.provenance?.origin === 'live-engine'
    && record?.outcome != null
    && record?.outcomeProvenance?.origin === 'live-engine';
}
export function isProspectiveRecord(record){
  return isResolvedProspectiveEvidence(record);
}

// ── Evidence scopes (row-list filters, one canonical partition) ─────────
// Every user-facing observed metric must draw from trustedResolvedRecords:
// live-engine recommendations resolved by live-engine outcomes. Imported,
// replayed, seeded and ambiguous rows stay available for audit/diagnostic
// display but must never move an observed rate or sample gate. The three
// scopes partition the ledger: trusted + open-prospective + diagnostic.
export function allRecords(ledger){
  return (ledger || []).filter(row=> row && row.recommendation);
}
export function prospectiveRecommendations(ledger){
  return allRecords(ledger).filter(isProspectiveRecommendation);
}
export function trustedResolvedRecords(ledger){
  return allRecords(ledger).filter(isProspectiveRecord);
}

// Confidence band from the frozen decision audit (object or string forms).
export function confidenceBandOf(record){
  const c = record?.audit?.confidence ?? record?.recommendation?.confidence ?? null;
  if(c == null) return null;
  if(typeof c === 'string') return c;
  if(typeof c === 'object' && c.band) return c.band;
  return null;
}

// Recommendation type = the graded action frozen at record time.
export function recommendationTypeOf(record){
  return record?.recommendedAction || 'unknown';
}

// Beta/Jeffreys-style shrinkage of an observed success rate toward a safe
// default. `weight` is how much the empirical rate is trusted (0..1). A lone
// session cannot produce a confident rate: n/(n+pseudoCount).
export function shrinkRate({ successes = 0, samples = 0, prior = 0.5, pseudoCount = 0 } = {}){
  const s = Math.max(0, Number(successes) || 0);
  const n = Math.max(0, Number(samples) || 0);
  const k = Math.max(0, Number(pseudoCount) || 0);
  const rate = n > 0 ? s / n : null;
  const shrunk = (s + prior * k) / (n + k);
  const weight = n > 0 ? n / (n + k) : 0;
  return { successes: s, samples: n, rate: rate == null ? null : round(rate, 3), shrunk: round(shrunk, 3), weight: round(weight, 3) };
}

// Realised success indicator for the calibration-error estimate: did the
// attempted performance meet the frozen target? Unknown → null (not counted).
export function realisedSuccess(record){
  const met = record?.outcome?.metTarget;
  return met === true ? 1 : met === false ? 0 : null;
}

// Grade one resolved (or unresolved) recommendation→outcome pair with the named
// conservative labels. Returns { label, reason, attempted }. Never mutates.
export function classifyRecommendationOutcome(record, thresholds = {}){
  const t = thresholds || {};
  const gainPct = Number(t.meaningfulGainPct ?? 0.02);
  const regCut = Number(t.regressionCutPct ?? 0.05);
  const easyRpe = Number(t.easyRpeThreshold ?? 7);
  const aggro = Number(t.aggressiveLoadPct ?? 1.1);
  const o = record?.outcome;
  if(!o) return { label: 'insufficient-evidence', reason: 'No outcome attached yet.', attempted: false };
  const action = record?.recommendedAction || 'unknown';
  const followed = o.followed;
  // A manual override means the user substituted their own target — the
  // recorded prescription was not what was tested, so it is never graded.
  if(o.userOverride === true || record?.userOverride === true){
    return { label: 'insufficient-evidence', reason: 'Manual override — the shown prescription was not what was tested; not graded.', attempted: false };
  }
  // Not followed, or adherence unknown: the engine is not punished for a
  // prescription the lifter did not meaningfully attempt.
  if(followed !== true){
    return { label: 'insufficient-evidence', reason: followed === false ? 'Prescription was not followed — engine not graded.' : 'Adherence unknown — engine not graded.', attempted: false };
  }
  // Pain or a form/technique change makes the session ungradeable as evidence.
  if(o.pain === true || o.techniqueWarning === true){
    return { label: 'neutral', reason: 'Pain or technique flag this session — outcome recorded but not used to grade the prescription.', attempted: true };
  }
  const prev = record?.basis?.previousBest || null;
  const loadTarget = Number(record?.recommendation?.load) > 0 ? Number(record.recommendation.load) : null;
  const aggressive = loadTarget != null && prev && loadTarget > Number(prev.weightKg || 0) * aggro;
  const demanded = action === 'add_load' || action === 'add_reps' || action === 'reduce_assistance';
  const regressed = o.changePct != null && o.changePct <= -regCut;
  const gained = o.changePct != null && o.changePct >= gainPct;
  const lowRpe = o.rpe != null && String(o.rpe).trim() !== '' && Number(o.rpe) <= easyRpe;
  if(demanded){
    if(!o.metTarget) return { label: 'too-aggressive', reason: 'Attempted the increase but missed the target.', attempted: true };
    if(regressed) return { label: 'too-aggressive', reason: 'Performance regressed after the increase.', attempted: true };
    if((o.failedSets || 0) > 0) return { label: 'too-aggressive', reason: 'Failed sets on a progression attempt.', attempted: true };
    if(!aggressive && lowRpe && gained) return { label: 'too-conservative', reason: 'Increase met with an easy RPE and a real gain — the step was likely too small.', attempted: true };
    return { label: 'successful', reason: 'Increase attempted and the target was met.', attempted: true };
  }
  if(action === 'hold'){
    if(gained && o.metTarget !== false) return { label: 'too-conservative', reason: 'Held, but performance still rose — a larger step may have been warranted.', attempted: true };
    return { label: 'neutral', reason: 'Held as prescribed; no progression to grade.', attempted: true };
  }
  return { label: 'neutral', reason: 'No graded progression demand to score.', attempted: true };
}
