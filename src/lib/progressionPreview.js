// progressionPreview.js — local "what will the next 4 weeks look like" simulator.
//
// Liftosaur-style preview, Arise rules: it replays the REAL engine
// (recommendNext — the same deterministic function that writes tomorrow's
// prescription) forward from the user's own history, feeding each simulated
// week's recommendation back as synthetic history. No network call, no second
// model, no mutation of progression constants — the preview and the prescription
// can never drift apart, because they are the same code.
//
// Honesty rules the preview keeps:
//   - No history for an exercise → the plan's own prescription is shown with
//     the engine's "no history" reason. Nothing is invented.
//   - Bodyweight work → reps progress, load stays "bw".
//   - Plate-aware: with a plate config, every simulated barbell/dumbbell/
//     machine load is rounded to increments the user actually owns.
//   - The simulation assumes one exposure of each exercise per week (the
//     mesocycle default) and says so.
// Pure and deterministic: same (program, history, plateConfig, today) in, same
// preview out. The synthetic history never touches the store.

import { recommendNext, equipmentForExercise } from './progression.js';
import { EXERCISE_BY_ID } from './data.js';

const DEFAULT_WEEKS = 4;
const DEFAULT_MAX_EXERCISES = 10;

// One exposure per week, anchored on the user's local "today": week 1 is the
// next scheduled exposure, not today itself.
function dateForWeek(todayISO, week){
  const base = Date.parse(`${todayISO}T00:00:00Z`);
  if(!Number.isFinite(base)) return `preview-week-${week}`;
  return new Date(base + week * 7 * 86400000).toISOString().slice(0, 10);
}

// Unique planned exercises in first-appearance order across the programme's
// first week — the weekly blueprint the mesocycle repeats.
export function plannedExercises(program, { limit = DEFAULT_MAX_EXERCISES } = {}){
  const workouts = program?.weeks?.[0]?.workouts || [];
  const seen = new Set();
  const out = [];
  for(const workout of workouts){
    for(const block of workout.blocks || []){
      if(!block?.exerciseId || seen.has(block.exerciseId)) continue;
      seen.add(block.exerciseId);
      out.push({ exerciseId:block.exerciseId, reps:block.reps || '', restSec:block.restSec || 0, loadHint:block.loadHint || '' });
    }
  }
  return { exercises:out.slice(0, limit), omitted:Math.max(0, out.length - limit) };
}

// Simulate one exercise forward `weeks` exposures. Each step asks the engine
// for the next prescription given everything known so far (real history plus
// this simulation's earlier weeks), then logs the recommendation as the
// synthetic exposure the next step reads.
export function simulateExerciseWeeks({ exerciseId, targetReps = '8–12', history = [], plateConfig = null, weeks = DEFAULT_WEEKS, todayISO }){
  const entries = [];
  const sim = [...(history || [])];
  for(let week = 1; week <= weeks; week++){
    const rec = recommendNext({
      exerciseId,
      history:sim,
      targetReps,
      plateConfig,
    });
    entries.push({
      week,
      dateISO:dateForWeek(todayISO, week),
      loadKg:rec.load ?? null,
      reps:rec.reps ?? null,
      assistKg:rec.assistKg ?? null,
      reason:rec.reason || '',
      plateEquipment:rec.plateEquipment || null,
      hasHistory:Boolean(rec.load != null || (rec.reps != null && !/No history/.test(rec.reason || ''))),
    });
    sim.push({
      id:`preview:${exerciseId}:w${week}`,
      dateISO:dateForWeek(todayISO, week),
      savedAt:`${dateForWeek(todayISO, week)}T12:00:00.000Z`,
      blocks:[{
        exerciseId,
        sets:[{
          reps:String(rec.reps ?? ''),
          weightKg:String(rec.load ?? ''),
          rpe:'',
          completed:true,
        }],
      }],
    });
  }
  return entries;
}

// Full programme preview: for every planned exercise, the engine's own next
// `weeks` prescriptions. Grouped by week for the compact UI table.
export function previewProgramProgression({
  program,
  history = [],
  plateConfig = null,
  weeks = DEFAULT_WEEKS,
  todayISO,
  maxExercises = DEFAULT_MAX_EXERCISES,
} = {}){
  if(!program?.weeks?.length) return null;
  const cut = String(todayISO || '9999-12-31');
  const priorOnly = (history || []).filter(h=> String(h?.dateISO || '') <= cut);
  const { exercises, omitted } = plannedExercises(program, { limit:maxExercises });
  const perExercise = new Map();
  for(const planned of exercises){
    perExercise.set(planned.exerciseId, simulateExerciseWeeks({
      exerciseId:planned.exerciseId,
      targetReps:planned.reps || '8–12',
      history:priorOnly,
      plateConfig,
      weeks,
      todayISO,
    }));
  }
  const byWeek = [];
  for(let week = 1; week <= weeks; week++){
    const entries = exercises.map(planned=>{
      const step = perExercise.get(planned.exerciseId)?.find(e=> e.week === week) || null;
      const ex = EXERCISE_BY_ID[planned.exerciseId];
      return {
        exerciseId:planned.exerciseId,
        name:ex?.name || planned.exerciseId,
        equipment:ex?.equipment || [],
        plannedReps:planned.reps,
        plannedLoadHint:planned.loadHint,
        isBodyweight:(ex?.equipment || []).length === 0 || (ex?.equipment || []).every(e=> e === 'bodyweight'),
        ...(step || {}),
      };
    });
    byWeek.push({ week, entries });
  }
  return {
    weeks:byWeek,
    exerciseCount:exercises.length,
    omittedExercises:omitted,
    // Same dispatch the prescription path uses — shown so a rounded preview
    // load is explainable (e.g. "dumbbell loads round to owned weights").
    equipmentDispatch:Object.fromEntries(exercises.map(p=> [p.exerciseId, equipmentForExercise(p.exerciseId)])),
    assumesOneExposurePerWeek:true,
  };
}
