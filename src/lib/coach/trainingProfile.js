// trainingProfile.js — the persistent personal training model.
//
// A structured, user-specific profile derived ONLY from data already on this
// device. Its purpose is to improve training decisions and to let the user
// see what Arise believes about them — not to rate their body, rank their
// habits, or score their worth. There is no appearance dimension here and
// there never will be.
//
// Every row carries:
//   value       the short, plain answer
//   detail      one line of context
//   confidence  high | medium | low | null (null = not enough data yet)
//   evidence    the observations behind it (progressive disclosure)
//   source      the engine/function it came from (auditable)
//   editableVia how to correct or change the inputs where that applies
//
// Pure, deterministic, offline. Rows with too little data are OMITTED rather
// than shown as confident claims.

import { EXERCISE_BY_ID } from '../data.js';
import { trainingAgeDisplay, consistencyInsights } from '../product.js';
import { programAdherence, isoToday, plateauDetection } from '../programming.js';
import { observedPrescriptionFollowThrough } from '../analytics.js';

const conf = (n, highAt, mediumAt) => n >= highAt ? 'high' : n >= mediumAt ? 'medium' : 'low';

function medianQuartiles(values){
  if(!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[Math.max(0, Math.floor(sorted.length * 0.25))];
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))];
  return { lo: Math.round(lo), hi: Math.round(hi), n: sorted.length };
}

export function buildTrainingProfile({ store = {}, today = null } = {}){
  const now = today || isoToday();
  const history = (store.history || []).filter(h => h && !h.deletedAt);
  const rows = [];

  // 1. Training age — how long Arise has seen you train.
  const age = trainingAgeDisplay(history, { today: now });
  if(age.months != null){
    rows.push({
      id: 'training-age',
      label: 'Training age',
      value: `${age.phase} · ${age.months} month${age.months === 1 ? '' : 's'}`,
      detail: 'Progression rates scale with how established your training is.',
      confidence: conf(history.length, 12, 4),
      evidence: [`First logged session: ${age.started}`, `${history.length} session${history.length === 1 ? '' : 's'} observed.`],
      source: 'product.trainingAgeDisplay',
      editableVia: null,
    });
  }

  // 2. Typical session length — measured, never guessed.
  const durations = history.slice(-20).map(h => Number(h.durationMinutes)).filter(d => Number.isFinite(d) && d > 0);
  const quartiles = medianQuartiles(durations);
  if(quartiles && quartiles.n >= 3){
    rows.push({
      id: 'session-length',
      label: 'Typical session',
      value: `≈${quartiles.lo}–${quartiles.hi} min`,
      detail: 'The middle half of your recent sessions — used to sanity-check time budgets.',
      confidence: conf(quartiles.n, 10, 5),
      evidence: [`Measured across your last ${quartiles.n} timed sessions.`],
      source: 'history.durationMinutes (quartiles)',
      editableVia: null,
    });
  }

  // 3. Consistency — weeks with training, never a streak to break.
  const consistency = consistencyInsights(history, { today: now, weeks: 6 });
  if(consistency.weeksElapsed >= 2 && consistency.rate != null){
    rows.push({
      id: 'consistency',
      label: 'Consistency',
      value: `${consistency.weeksActive} of the last ${consistency.weeksElapsed} weeks had training`,
      detail: consistency.currentRunWeeks >= 2 ? `${consistency.currentRunWeeks}-week run going — keep it sustainable.` : 'Weeks with any session count; gaps are information, not failure.',
      confidence: null,
      evidence: [`Active weeks: ${consistency.weeksActive}/${consistency.weeksElapsed}`, `Current run: ${consistency.currentRunWeeks} week(s).`],
      source: 'product.consistencyInsights',
      editableVia: null,
    });
  }

  // 4. Programme adherence — only when there is a real denominator.
  const adherence = programAdherence(store.activeSchedule, history, { today: now });
  if(store.activeSchedule && adherence.due >= 3 && adherence.toDateRate != null){
    rows.push({
      id: 'adherence',
      label: 'Programme adherence',
      value: `${Math.round(adherence.toDateRate * 100)}% of due sessions`,
      detail: `${adherence.missed} missed · ${adherence.upcoming} upcoming. Missed sessions change the plan only when you choose how.`,
      confidence: conf(adherence.due, 8, 4),
      evidence: [`${adherence.due} sessions due so far on this programme.`],
      source: 'programming.programAdherence',
      editableVia: null,
    });
  }

  // 5. Response to prescriptions — do you follow what you're given, and how
  //    does that track? Uses STORED prescription snapshots (observed), never
  //    reconstructed ones.
  const followThrough = observedPrescriptionFollowThrough(history);
  if(followThrough.prescribedSets >= 4 && followThrough.workouts >= 1){
    rows.push({
      id: 'prescription-follow-through',
      label: 'Following the plan',
      value: `${Math.round(followThrough.followThroughPct)}% of prescribed targets met`,
      detail: followThrough.followThroughPct >= 80
        ? 'You execute what the plan asks — progression can stay aggressive.'
        : followThrough.followThroughPct >= 50
          ? 'Partial execution — Arise keeps progressions conservative when targets are missed.'
          : 'Targets are rarely met — the plan may be too ambitious for current capacity.',
      confidence: conf(followThrough.workouts, 8, 3),
      evidence: [
        `${followThrough.prescribedSets} prescribed set-checks across ${followThrough.workouts} workout(s).`,
        `${followThrough.skippedSets || 0} skipped · ${followThrough.failedSets || 0} failed · ${followThrough.userAddedSets || 0} user-added sets.`,
      ],
      source: 'analytics.observedPrescriptionFollowThrough (stored snapshots)',
      editableVia: null,
    });
  }

  // 6. Movement preferences & most-trained — editable via onboarding.
  const counts = new Map();
  for(const h of history){
    for(const b of h.blocks || []){
      if(b?.exerciseId) counts.set(b.exerciseId, (counts.get(b.exerciseId) || 0) + 1);
    }
  }
  const favourites = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([id, n]) => `${EXERCISE_BY_ID[id]?.name || id} (${n}×)`);
  const preferred = (store.onboarding?.preferredExerciseIds || []).map(id => EXERCISE_BY_ID[id]?.name || id);
  const disliked = (store.onboarding?.dislikedExerciseIds || []).map(id => EXERCISE_BY_ID[id]?.name || id);
  if(favourites.length || preferred.length || disliked.length){
    rows.push({
      id: 'movement-preferences',
      label: 'Movement preferences',
      value: preferred.length || disliked.length
        ? `${preferred.length} liked · ${disliked.length} avoided`
        : 'No explicit preferences set',
      detail: 'Liked moves are preferred when substituting; avoided moves are never prescribed.',
      confidence: (preferred.length || disliked.length) ? null : 'low',
      evidence: [
        favourites.length ? `Most trained: ${favourites.join(', ')}.` : '',
        preferred.length ? `Liked: ${preferred.join(', ')}.` : '',
        disliked.length ? `Avoided: ${disliked.join(', ')}.` : '',
      ].filter(Boolean),
      source: 'onboarding preferences + history exposure counts',
      editableVia: { label: 'Edit in More → Your profile', hint: 'Like/Avoid lists live in onboarding and change future substitutions only.' },
    });
  }

  // 7. Kit-driven substitutions — the swap engine's actual usage.
  const substitutions = history.flatMap(h => (h.blocks || []).filter(b => b?.substitutionFrom)
    .map(b => `${EXERCISE_BY_ID[b.substitutionFrom]?.name || b.substitutionFrom} → ${EXERCISE_BY_ID[b.exerciseId]?.name || b.exerciseId}`));
  if(substitutions.length){
    const recent = [...new Set(substitutions)].slice(-4);
    rows.push({
      id: 'substitution-history',
      label: 'Substitutions used',
      value: `${substitutions.length} swap${substitutions.length === 1 ? '' : 's'} across your history`,
      detail: 'Exercises your kit can’t support are swapped to the nearest equivalent — deterministically, with the reason stamped on the set.',
      confidence: 'high',
      evidence: recent.map(s => s),
      source: 'history blocks.substitutionFrom (substitutions engine)',
      editableVia: { label: 'Change what swaps are possible', hint: 'Update your kit in More → Equipment.' },
    });
  }

  // 8. Genuine plateaus — only what the attribution engine calls real.
  const plateauIds = [...counts.keys()];
  const plateauNames = plateauIds
    .map(id => ({ id, result: plateauDetection(history, id, { readinessLog: store.readinessLog || [] }) }))
    .filter(r => r.result.detected && r.result.attribution?.kind === 'genuine')
    .map(r => EXERCISE_BY_ID[r.id]?.name || r.id);
  if(plateauNames.length){
    rows.push({
      id: 'plateau-patterns',
      label: 'Plateau patterns',
      value: plateauNames.slice(0, 3).join(', '),
      detail: 'These lifts are flat across a genuine plateau window — the engine holds load and suggests variation instead of grinding.',
      confidence: 'high',
      evidence: plateauNames.map(n => `${n}: genuine plateau (not a single bad session).`),
      source: 'programming.plateauDetection → sessionQuality.plateauAttribution',
      editableVia: null,
    });
  }

  // 9. Recovery signal — the user's own check-ins, averaged honestly.
  const readiness = (store.readinessLog || []).map(r => Number(r.score)).filter(Number.isFinite).slice(-8);
  if(readiness.length >= 3){
    const avg = Math.round(readiness.reduce((a, b) => a + b, 0) / readiness.length);
    rows.push({
      id: 'recovery-readiness',
      label: 'Recovery signal',
      value: `Readiness averaging ${avg} (last ${readiness.length} check-ins)`,
      detail: avg >= 60 ? 'No sustained fatigue signal in your recent check-ins.' : 'Recent check-ins read low — sleep and load are worth watching.',
      confidence: conf(readiness.length, 6, 4),
      evidence: [`Scores: ${readiness.join(', ')}.`],
      source: 'readinessLog (your own check-ins)',
      editableVia: { label: 'Log a check-in from Today', hint: 'The signal is only as good as the check-ins behind it.' },
    });
  }

  return {
    rows,
    summary: rows.length
      ? `${rows.length} pattern${rows.length === 1 ? '' : 's'} Arise uses when deciding what to change — tap any row to see the evidence.`
      : 'Not enough logged training yet — the model fills in as you go.',
  };
}
