// studyEnrollment.js — turns STUDY_DESIGN into the treatment users receive.
//
// Randomised trial, exercise-level assignment (see STUDY_DESIGN in study.js):
//   - consented participants are enrolled under their pseudonymous
//     studyParticipantId;
//   - every scheduled exercise is assigned ARISE or DOUBLE-PROGRESSION with
//     EXACT per-participant balance (⌈n/2⌉ / ⌊n/2⌋);
//   - assignment is deterministic (same participant + seed ⇒ same arms) and
//     is persisted BEFORE any treated session runs;
//   - which lift lands in which arm varies across participants, so exercise
//     identity never confounds treatment.
//
// The assigned arm's prescription is what the product displays and logs.
// Everything else frozen in the ledger remains SHADOW analysis.

import { STUDY_DESIGN } from './study.js';
import { resolveArisePriors } from './priors.js';

export const STUDY_VERSION = 1;
export const PRIMARY_ARMS = ['arise', 'double-progression'];
export const DP_POLICY_VERSION = 'double-progression-v1';

function hash32(str){
  let h = 2166136261;
  for(const ch of String(str)){ h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function enrollmentSeed({ participantId, studyVersion = STUDY_VERSION, baseSeed = STUDY_DESIGN.seed }){
  return `${baseSeed}::${participantId}::v${studyVersion}`;
}

// Exact-balance assignment: walk the exercises in a per-participant pseudo-
// random order and alternate arms. Balance is structural, not probabilistic;
// the shuffle guarantees lift↔arm pairing varies between participants.
export function assignArmsBalanced(exerciseIds, { seed }){
  const items = [...exerciseIds].sort();
  const h = hash32(seed);
  const startArmIsArise = h % 2 === 0;
  const pair = startArmIsArise ? ['arise', 'double-progression'] : ['double-progression', 'arise'];
  const order = items.map(id => ({ id, r: hash32(`${seed}::${id}`) })).sort((a,b)=> a.r - b.r || a.id.localeCompare(b.id));
  const assignment = {};
  order.forEach((o, i)=> { assignment[o.id] = pair[i % 2]; });
  return { assignment, startArm: pair[0] };
}

// Stable set of exercises the participant is actually scheduled to train.
export function scheduledExerciseIds(schedule){
  const ids = new Set();
  for(const s of schedule?.sessions || []) for(const b of s.blocks || []) if(b?.exerciseId) ids.add(b.exerciseId);
  return [...ids].sort();
}

export function enrollParticipant({ participantId, schedule = null, exerciseIds = null, studyVersion = STUDY_VERSION, baseSeed = STUDY_DESIGN.seed, config = null, nowISO = null }){
  if(!participantId) throw new Error('Study enrollment requires a participant id.');
  const ids = Array.isArray(exerciseIds) && exerciseIds.length ? [...exerciseIds] : scheduledExerciseIds(schedule);
  if(!ids.length) throw new Error('No eligible exercises to randomise.');
  const seed = enrollmentSeed({ participantId, studyVersion, baseSeed });
  const { assignment, startArm } = assignArmsBalanced(ids, { seed });
  const priors = resolveArisePriors(config);
  return {
    studyVersion,
    participantId,
    seed,
    enrolledAtISO: nowISO || new Date().toISOString(),
    startArm,
    // Frozen at entry — no tuning from observed treatment effects.
    policyVersions: {
      arise: `priors-v${priors.version}`,
      doubleProgression: DP_POLICY_VERSION,
    },
    targetDefinition: STUDY_DESIGN.primaryEndpoint,
    meaningfulGainThreshold: 0.02, // sessionQuality.pr.meaningfulGainPct
    analysisCodeVersion: STUDY_DESIGN.designVersion,
    assignments: Object.fromEntries(Object.entries(assignment).map(([id, arm]) => [id, {
      arm,
      assignmentVersion: STUDY_VERSION,
      assignedAtISO: nowISO || new Date().toISOString(),
    }])),
  };
}

export function assignmentFor(enrollment, exerciseId){
  return enrollment?.assignments?.[exerciseId]?.arm || null;
}

// Pilot checklist in one object — everything P1 verification needs.
export function enrollmentAudit(enrollment){
  if(!enrollment) return { ok:false, reason:'no enrollment' };
  const arms = Object.values(enrollment.assignments || {}).map(a => a.arm);
  const arise = arms.filter(a => a === 'arise').length;
  const dp = arms.filter(a => a === 'double-progression').length;
  const balanced = Math.abs(arise - dp) <= 1;
  const complete = Object.keys(enrollment.assignments || {}).length > 0 &&
    typeof enrollment.policyVersions?.arise === 'string' &&
    typeof enrollment.policyVersions?.doubleProgression === 'string';
  return { ok: balanced && complete, balanced, arise, doubleProgression: dp, complete };
}
