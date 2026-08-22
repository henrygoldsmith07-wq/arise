// longitudinal.js — prospective real-world validation of Arise's recommendations.
//
// This is deliberately separate from backtesting.js:
//   - backtesting replays an existing history retrospectively;
//   - this module records each recommendation BEFORE the workout it targets,
//     attaches the real outcome afterwards, and aggregates the pairs.
//
// Hard rules enforced here:
//   1. Consent: nothing is recorded unless the user enabled local measurements
//      (preferences.telemetryEnabled === true).
//   2. Separation: the evaluation ledger lives under its own storage key and is
//      NEVER fed into recommendNext or any training-history consumer. Training
//      history (store.history) and evaluation history stay apart.
//   3. No future leakage: a record snapshots the recommendation and the basis
//      (visible session count, priors version) at record time. Analysis reads
//      the stored recommendation; it never recomputes one from later data.
//   4. Sample gates: segment-level conclusions are withheld (null rates,
//      conclusive:false) until the configured minimum sample size is met.

import { resolveArisePriors } from './priors.js';
import { EXERCISE_BY_ID } from './data.js';
import { movementPatternFor } from './substitutions.js';

export const EVALUATION_SCHEMA_VERSION = 1;
export const EVALUATION_KEY = 'arise.evaluation.v1';

const SCALE = 100;

function round(value, digits = 3){
  if(!Number.isFinite(Number(value))) return null;
  const p = 10 ** digits;
  return Math.round(Number(value) * p) / p;
}

function parseReps(value){
  const match = String(value ?? '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function e1rm(weightKg, reps){
  const w = Number(weightKg) || 0;
  const r = parseReps(reps);
  return w > 0 && r > 0 ? w * (1 + r / 30) : 0;
}

// ── Storage (separate key; never the training store) ────────────────────

function defaultStorage(){
  try{ return typeof localStorage !== 'undefined' ? localStorage : null; }catch{ return null; }
}

export function loadEvaluationLedger(storage = defaultStorage()){
  try{
    const raw = storage?.getItem?.(EVALUATION_KEY);
    if(!raw) return [];
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : [];
    return records.filter(record=> record && typeof record === 'object');
  }catch{ return []; }
}

export function saveEvaluationLedger(records, storage = defaultStorage()){
  try{
    storage?.setItem?.(EVALUATION_KEY, JSON.stringify({ schemaVersion: EVALUATION_SCHEMA_VERSION, records }));
  }catch{}
}

export function clearEvaluationLedger(storage = defaultStorage()){
  try{ storage?.removeItem?.(EVALUATION_KEY); }catch{}
}

// Union two ledgers by record id. A resolved record (outcome attached) beats
// an unresolved duplicate; otherwise the current copy wins. Deterministic:
// current-side records keep their order.
export function mergeEvaluationLedgers(current = [], incoming = []){
  const byId = new Map();
  for(const record of [...(current || []), ...(incoming || [])]){
    if(!record?.id) continue;
    const existing = byId.get(record.id);
    if(!existing){ byId.set(record.id, record); continue; }
    if(!existing.outcome && record.outcome) byId.set(record.id, record);
  }
  return [...byId.values()];
}

// ── Segmentation helpers ────────────────────────────────────────────────

// Free weights / machines / cables / bodyweight — from the exercise's declared kit.
export function equipmentClassFor(exerciseId){
  const ex = EXERCISE_BY_ID[exerciseId];
  if(!ex) return 'unknown';
  const equipment = ex.equipment || [];
  if(equipment.includes('machine')) return 'machines';
  if(equipment.includes('cable')) return 'cables';
  if(equipment.some(eq=> ['barbell', 'dumbbells', 'kettlebell'].includes(eq))) return 'free-weights';
  if(equipment.length === 1 && equipment[0] === 'bodyweight') return 'bodyweight';
  return 'other';
}

function trainingAgePhase(history, asOfDateISO, config){
  // Local re-implementation to avoid importing progression.js (which would risk
  // pulling evaluation data into training logic — separation rule #2).
  const cfg = resolveArisePriors(config).progression.trainingAge;
  const end = asOfDateISO ? Date.parse(`${asOfDateISO}T00:00:00`) : Date.now();
  const dates = (history || []).map(h=> Date.parse(`${h?.dateISO || ''}T00:00:00`))
    .filter(t=> Number.isFinite(t) && t <= end).sort((a, b)=> a - b);
  if(!dates.length) return 'unknown';
  const months = Math.max(0, (end - dates[0]) / (resolveArisePriors(config).progression.daysPerMonth * 86400000));
  if(months < cfg.noviceMaxMonths) return 'novice';
  if(months < cfg.intermediateMaxMonths) return 'intermediate';
  return 'advanced';
}

// ── Recording (prospective) ─────────────────────────────────────────────

function hasConsent(preferences){
  return preferences?.telemetryEnabled === true;
}

function bestSetOfBlock(block){
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

function lastExposureBest(history, exerciseId, beforeDateISO){
  let best = null;
  for(const session of history || []){
    if(beforeDateISO && String(session.dateISO || '') >= String(beforeDateISO)) continue;
    for(const block of session.blocks || []){
      if(block.exerciseId !== exerciseId) continue;
      const candidate = bestSetOfBlock(block);
      if(candidate && (!best || candidate.score > best.score)) best = candidate;
    }
  }
  return best;
}

function classifyRecommendedAction(recommendation, previous){
  if(!recommendation) return 'unknown';
  if(recommendation.plateau?.isPlateau || /plateau|hold/i.test(recommendation.reason || '')) return 'hold';
  if(recommendation.assistKg != null && previous && recommendation.assistKg < previous.assistedKg) return 'reduce_assistance';
  if(recommendation.reps != null && previous && recommendation.reps > previous.reps) return 'add_reps';
  if(recommendation.load != null && recommendation.load > 0 && previous && recommendation.load > previous.weightKg) return 'add_load';
  if(recommendation.load != null && recommendation.load > 0 && !previous) return 'add_load';
  return 'hold';
}

function makeRecordId(now = Date.now()){
  return `eval-${now}-${Math.random().toString(36).slice(2, 8)}`;
}

// Snapshot a recommendation before the workout it targets. Only prior history
// may be passed in; the basis records how much was visible so audits can
// confirm no future rows were involved.
export function recordRecommendation({ exerciseId, recommendation, history = [], dueDateISO = null, preferences = null, config = null, nowISO = null, programId = null, programVersion = null, storage = defaultStorage() } = {}){
  if(!hasConsent(preferences)) return null;
  if(!exerciseId || !recommendation) return null;
  const phase = trainingAgePhase(history, dueDateISO, config);
  const previous = lastExposureBest(history, exerciseId, dueDateISO);
  const record = {
    id: makeRecordId(nowISO ? Date.parse(nowISO) || Date.now() : Date.now()),
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    recordedAtISO: nowISO || new Date().toISOString(),
    dueDateISO,
    exerciseId,
    movementPattern: movementPatternFor(exerciseId) || 'unknown',
    equipmentClass: equipmentClassFor(exerciseId),
    // Programme identity lets effectiveness roll up per programme/version so
    // "did this programme work" is answerable from real outcomes.
    programId: programId || null,
    programVersion: programVersion ?? null,
    recommendation: {
      load: recommendation.load ?? null,
      reps: recommendation.reps ?? null,
      assistKg: recommendation.assistKg ?? null,
      reason: recommendation.reason || '',
      strategy: recommendation.strategy || null,
    },
    recommendedAction: classifyRecommendedAction(recommendation, previous),
    basis: {
      visibleSessions: (history || []).length,
      previousBest: previous ? { reps: previous.reps, weightKg: previous.weightKg, assistedKg: previous.assistedKg, e1rm: round(previous.score, 2) } : null,
      trainingAgePhase: phase,
      priorsVersion: resolveArisePriors(config).version,
    },
    outcome: null,
  };
  const ledger = loadEvaluationLedger(storage);
  // Cap open (unresolved) records per exercise so skipped sessions cannot pile up.
  const maxOpen = resolveArisePriors(config).longitudinal.maxOpenRecordsPerExercise;
  const openForExercise = ledger.filter(row=> row.exerciseId === exerciseId && !row.outcome);
  const dropIds = new Set(openForExercise.slice(Math.max(0, openForExercise.length - maxOpen + 1)).map(row=> row.id));
  const next = [...ledger.filter(row=> !dropIds.has(row.id)), record];
  const retention = resolveArisePriors(config).longitudinal.retentionLimit;
  saveEvaluationLedger(next.slice(-retention), storage);
  return record;
}

// Attach the real outcome once the following workout completes. The outcome is
// taken from the saved session payload only — never from recommendations.
export function attachOutcome({ sessionId, dateISO, blocks = [], historyBefore = [], preferences = null, config = null, nowISO = null, storage = defaultStorage() } = {}){
  if(!hasConsent(preferences)) return [];
  const ledger = loadEvaluationLedger(storage);
  const resolved = [];
  const byExercise = new Map();
  for(const block of blocks || []){
    if(!block?.exerciseId) continue;
    const best = bestSetOfBlock(block);
    if(best && !byExercise.has(block.exerciseId)) byExercise.set(block.exerciseId, { best, sets: (block.sets || []).length });
  }
  const next = ledger.map(record=>{
    if(record.outcome) return record;
    if(!byExercise.has(record.exerciseId)) return record;
    // A record is resolved by the first logged session at or after its due date.
    if(record.dueDateISO && dateISO && String(dateISO) < String(record.dueDateISO)) return record;
    const { best } = byExercise.get(record.exerciseId);
    const rec = record.recommendation || {};
    const previous = record.basis?.previousBest || null;
    const repTarget = rec.reps != null ? Number(rec.reps) : null;
    const loadTarget = rec.load != null && Number(rec.load) > 0 ? Number(rec.load) : null;
    const assistTarget = rec.assistKg != null ? Number(rec.assistKg) : null;
    const repsMet = repTarget == null || best.reps >= repTarget;
    const loadMet = loadTarget == null || best.weightKg >= loadTarget;
    const assistMet = assistTarget == null || best.assistedKg <= assistTarget;
    const metTarget = repsMet && loadMet && assistMet;
    const actualE1rm = round(e1rm(best.weightKg, best.reps), 2);
    const previousE1rm = previous?.e1rm ?? null;
    const changePct = previousE1rm ? round((actualE1rm - previousE1rm) / previousE1rm, 4) : null;
    const action = record.recommendedAction;
    const progressed = action !== 'hold' && metTarget;
    const regressed = changePct != null && changePct <= -0.05;
    const stagnated = action === 'hold' && (changePct == null || Math.abs(changePct) < 0.02);
    const errors = {
      loadErrorKg: loadTarget != null && best.weightKg > 0 ? round(Math.abs(loadTarget - best.weightKg), 2) : null,
      repError: repTarget != null ? Math.abs(repTarget - best.reps) : null,
    };
    const enriched = {
      ...record,
      outcome: {
        sessionId: sessionId || null,
        dateISO: dateISO || null,
        recordedAtISO: nowISO || new Date().toISOString(),
        load: best.weightKg,
        reps: best.reps,
        assistedKg: best.assistedKg,
        rpe: best.rpe,
        sets: byExercise.get(record.exerciseId).sets,
        e1rm: actualE1rm,
        previousE1rm,
        changePct,
        metTarget,
        repsMet, loadMet, assistMet,
        loadErrorKg: errors.loadErrorKg,
        repError: errors.repError,
        classification: progressed ? 'progression-success'
          : regressed && action !== 'hold' ? 'regression'
          : stagnated ? 'stagnation'
          : metTarget ? 'target-met-hold'
          : 'target-missed',
      },
    };
    resolved.push(enriched);
    return enriched;
  });
  saveEvaluationLedger(next, storage);
  return resolved;
}

// ── Aggregation ─────────────────────────────────────────────────────────

function emptySegment(key){
  return { key, n: 0, resolved: 0, conclusive: false, progressionSuccessRate: null, regressionRate: null, stagnationRate: null, adherenceRate: null, meanLoadErrorKg: null, meanRepError: null };
}

function summarise(records, minimumSamples){
  const segment = emptySegment('all');
  segment.n = records.length;
  const outcomes = records.filter(row=> row.outcome);
  segment.resolved = outcomes.length;
  if(outcomes.length < minimumSamples) return segment;
  segment.conclusive = true;
  const rate = predicate=> round(outcomes.filter(predicate).length / outcomes.length, 3);
  segment.progressionSuccessRate = rate(row=> row.outcome.classification === 'progression-success');
  segment.regressionRate = rate(row=> row.outcome.classification === 'regression');
  segment.stagnationRate = rate(row=> row.outcome.classification === 'stagnation');
  segment.adherenceRate = rate(row=> row.outcome.metTarget);
  const loadErrors = outcomes.map(row=> row.outcome.loadErrorKg).filter(Number.isFinite);
  const repErrors = outcomes.map(row=> row.outcome.repError).filter(Number.isFinite);
  segment.meanLoadErrorKg = loadErrors.length ? round(loadErrors.reduce((a, b)=> a + b, 0) / loadErrors.length, 2) : null;
  segment.meanRepError = repErrors.length ? round(repErrors.reduce((a, b)=> a + b, 0) / repErrors.length, 2) : null;
  return segment;
}

function groupBy(records, keyFn){
  const groups = new Map();
  for(const record of records){
    const key = keyFn(record) || 'unknown';
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.entries()].sort(([a], [b])=> a.localeCompare(b));
}

// Aggregate the ledger. Reads only stored recommendation/outcome pairs — it
// never recomputes a recommendation, so later sessions cannot influence past
// evaluations.
export function evaluateLongitudinal(ledger, { config = null } = {}){
  const cfg = resolveArisePriors(config).longitudinal;
  const minimum = Math.max(1, Number(cfg.minimumSegmentSamples) || 1);
  const records = (ledger || []).filter(row=> row && row.recommendation);
  const overall = summarise(records, minimum);
  const dimension = keyFn=> {
    const output = {};
    for(const [key, group] of groupBy(records, keyFn)){
      const summary = summarise(group, minimum);
      summary.key = key;
      output[key] = summary;
    }
    return output;
  };
  return {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    minimumSegmentSamples: minimum,
    totalRecords: records.length,
    openRecords: records.filter(row=> !row.outcome).length,
    overall,
    byTrainingAge: dimension(row=> row.basis?.trainingAgePhase),
    byExercise: dimension(row=> row.exerciseId),
    byMovementPattern: dimension(row=> row.movementPattern),
    byEquipmentClass: dimension(row=> row.equipmentClass),
    byProgramme: dimension(row=> row.programId ? `${row.programId}@v${row.programVersion == null ? '?' : row.programVersion}` : null),
    note: records.length
      ? `Segments with fewer than ${minimum} resolved recommendation→outcome pairs withhold their rates (conclusive:false). Evaluation data is stored separately from training history and never calibrates recommendations from future sessions.`
      : 'No consented recommendation→outcome pairs recorded yet.',
  };
}

export function longitudinalSummary({ preferences = null, config = null, storage = defaultStorage() } = {}){
  if(!hasConsent(preferences)) return { consented: false, evaluation: null };
  return { consented: true, evaluation: evaluateLongitudinal(loadEvaluationLedger(storage), { config }) };
}

// ── Substitution quality validation ─────────────────────────────────────
// For every engine-recorded swap (block.substitutionFrom): was the swapped-in
// lift actually performed with real sets, and did its performance hold on the
// next exposure? Reads only saved history — no recommendations involved.
export function validateSubstitutions(history, { retentionRatio = 0.95 } = {}){
  const ordered = [...(history || [])].sort((a, b)=> String(a?.dateISO || '').localeCompare(String(b?.dateISO || '')));
  const rows = [];
  for(const session of ordered){
    for(const block of session.blocks || []){
      if(!block?.substitutionFrom) continue;
      const best = bestSetOfBlock(block);
      rows.push({
        sessionId: session.id || null,
        dateISO: session.dateISO || null,
        from: block.substitutionFrom,
        to: block.exerciseId,
        reason: block.substitutionReason || '',
        performed: !!(best && best.reps > 0),
        e1rm: best ? round(best.score, 2) : null,
        nextE1rm: null,
        nextDateISO: null,
        retained: null,
      });
    }
  }
  const nextExposureAfter = (exerciseId, dateISO, sessionId)=>{
    for(const session of ordered){
      if(sessionId && session.id === sessionId) continue;
      if(String(session.dateISO || '') <= String(dateISO || '')) continue;
      for(const block of session.blocks || []){
        if(block.exerciseId !== exerciseId) continue;
        const best = bestSetOfBlock(block);
        if(best && best.reps > 0) return { score: best.score, dateISO: session.dateISO };
      }
    }
    return null;
  };
  for(const row of rows){
    if(!row.performed || !row.e1rm) continue;
    const next = nextExposureAfter(row.to, row.dateISO, row.sessionId);
    if(next){
      row.nextE1rm = round(next.score, 2);
      row.nextDateISO = next.dateISO;
      row.retained = round(next.score / Math.max(1e-9, row.e1rm), 3) >= retentionRatio;
    }
  }
  const performedRows = rows.filter(row=> row.performed);
  const followUps = performedRows.filter(row=> row.retained != null);
  const pct = (part, whole)=> whole ? Math.round(part / whole * 100) / 100 : null;
  return {
    substitutions: rows.length,
    performed: performedRows.length,
    performedRate: pct(performedRows.length, rows.length),
    followedUp: followUps.length,
    retainedRate: pct(followUps.filter(row=> row.retained).length, followUps.length),
    rows,
  };
}
