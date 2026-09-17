// participation.js — the participant lifecycle state machine.
//
// The study onboarding card used to know exactly two states: enrolled or not.
// Real cohorts need the full arc — invited → eligible → enrolled → withdrawn —
// and withdrawal needs honest semantics:
//
//   WITHDRAWAL STOPS TREATMENT, NEVER ERASES HISTORY.
//
// Leaving the study drops the enrollment (no new arm assignments) and stamps
// studyStatus: 'withdrawn' so cohort reports show the person as withdrawn —
// but every already-observed session, ledger pair and event is preserved
// unless the user separately deletes it (More → Delete all data), which is a
// deliberate, destructive, confirm-guarded action and never a side effect.
//
// Pure and deterministic over its inputs.

import { enrollParticipant } from './studyEnrollment.js';
import { ensureStudyParticipantId, isValidStudyParticipantId } from './studyIdentity.js';
import { scheduledExerciseIds } from './studyEnrollment.js';

// ── Eligibility ─────────────────────────────────────────────────────────
// Mirrors the checks the UI shows. Each entry: { ok, reason } so the UI can
// list what is missing rather than just disabling the button.
export function studyEligibility(store){
  const prefs = store?.preferences || {};
  const logged = (store?.history || []).length;
  const scheduleExercises = store?.activeSchedule ? scheduledExerciseIds(store.activeSchedule) : [];
  const exerciseIds = scheduleExercises.length
    ? scheduleExercises
    : [...new Set((store?.history || []).flatMap(h => (h.blocks || []).map(b => b.exerciseId).filter(Boolean)))];
  const problems = [];
  if(prefs.telemetryEnabled !== true) problems.push('Turn on local measurements first (More → Privacy & data). The study records what was shown and what you did — that requires measurement consent.');
  if(logged < 3) problems.push(`Log at least 3 workouts first — the study needs real training, not intent (${logged}/3 so far).`);
  if(!exerciseIds.length) problems.push('Finish onboarding or start a programme so there is something to assign arms to.');
  return {
    eligible: problems.length === 0,
    problems,
    exerciseCount: exerciseIds.length,
    workoutCount: logged,
  };
}

// ── Join ────────────────────────────────────────────────────────────────
// Locks the pseudonymous id, freezes the balanced enrollment, and stamps the
// lifecycle. Throws on ineligible input so a UI bug cannot enroll silently.
export function joinStudy(store, { nowISO = null } = {}){
  const eligibility = studyEligibility(store);
  if(!eligibility.eligible) throw new Error(`Cannot join the study yet: ${eligibility.problems[0]}`);
  const withId = ensureStudyParticipantId(store);
  const enrollment = enrollParticipant({ participantId: withId.studyParticipantId, schedule: withId.activeSchedule || null });
  return {
    ...withId,
    studyEnrollment: enrollment,
    studyStatus: 'enrolled',
    studyStatusChangedAtISO: nowISO || new Date().toISOString(),
  };
}

// Re-join after withdrawal: allowed — recorded history stays and the same
// deterministic enrollment regenerates identical arms for the same exercise
// set (studyEnrollment.js), so rejoining cannot re-randomise anyone.
export function rejoinStudy(store, { nowISO = null } = {}){
  const next = joinStudy(store, { nowISO });
  return {
    ...next,
    studyStatus: 'enrolled',
    rejoinOfPriorWithdrawal: store?.studyStatus === 'withdrawn',
  };
}

// ── Current status (for the UI and cohort reports) ─────────────────────
// Lifecycle is derived from stored facts; missing fields mean pre-lifecycle
// stores still resolve to a sensible state instead of crashing.
export function participationStatus(store){
  const enrolled = Boolean(store?.studyEnrollment);
  const withdrawn = store?.studyStatus === 'withdrawn';
  if(withdrawn) return 'withdrawn';
  if(enrolled) return 'enrolled';
  const eligibility = studyEligibility(store);
  return eligibility.eligible ? 'eligible' : 'ineligible';
}

// What the current state means, in plain language for the UI.
export function participationCopy(store){
  const status = participationStatus(store);
  switch(status){
    case 'enrolled':
      return 'You are enrolled. Each workout’s targets are frozen before you train and scored against what you actually did. Nothing leaves this device unless you export it yourself.';
    case 'withdrawn':
      return 'You have withdrawn. New workouts run on the normal engine — no study assignments. Everything you already logged stays exactly where it was unless you delete it.';
    case 'eligible':
      return 'You have not joined yet. You are eligible: measurement consent is on and you have real training logged.';
    default:
      return 'The study needs measurement consent and at least 3 logged workouts before you can join.';
  }
}

// ── Withdraw ────────────────────────────────────────────────────────────
// The ONLY state change withdrawal makes beyond the status stamp is clearing
// the enrollment so no future workout receives an arm assignment. Observed
// history (store.history), the evaluation ledger, readiness, events — all
// untouched. Returns a new store; never mutates the input.
export function withdrawFromStudy(store, { nowISO = null } = {}){
  if(!store) return store;
  const wasEnrolled = Boolean(store.studyEnrollment) || store.studyStatus === 'enrolled';
  return {
    ...store,
    studyEnrollment: null,
    studyStatus: 'withdrawn',
    studyStatusChangedAtISO: nowISO || new Date().toISOString(),
    // The pseudonymous id PERSISTS on purpose: exports keep folding into the
    // same participant, so a withdrawal is visible in cohort reports instead
    // of looking like a brand-new person. (Deleting the id would orphan the
    // history as an anonymous export — a worse, less honest outcome.)
    ...(wasEnrolled ? {} : {}),
  };
}

// ── Deletion (explicit, destructive, never a lifecycle side effect) ─────
// Separate action from withdrawal. Used by the UI's delete-observations flow
// and documented as such: leaving the study ≠ deleting data.
export function deleteStudyObservations(store, { ledgerKeys = [] } = {}){
  return {
    ...store,
    history: [],
    evaluationLedger: [],
    readinessLog: [],
    eventHistory: [],
  };
}

export { isValidStudyParticipantId };
