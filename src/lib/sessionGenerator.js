// sessionGenerator.js — build a session from goal + availableEquipment + recent history.
// Explains why each block was chosen.
import { EXERCISES, EXERCISE_BY_ID } from "./data.js";
import { recommendNext, personalisedRate } from "./progression.js";
import { rankedSubstitutions } from "./substitutions.js";
import { warmupSets, recommendedRest, predictSessionDuration, bestSupersets, fatigueAwareOrder, weakPointMuscles } from "./warmup.js";

export function generateSession({ goal="general", availableEquipment=[], history=[], length=5, includeWarmup=true }){
  const has = new Set(availableEquipment);
  let pool = EXERCISES.filter(e=> e.equipment.every(eq=> has.has(eq)) || (e.equipment.length===1 && e.equipment[0]==="bodyweight"));
  if(!pool.length) pool = EXERCISES.filter(e=> e.equipment.length===1 && e.equipment[0]==="bodyweight");
  // History-based substitution: prefer exercises the user has actually progressed on
  const performed = new Set();
  for(const h of history||[]) for(const b of h.blocks||[]) performed.add(b.exerciseId);
  const bias = { strength: ["Legs","Back","Chest","Shoulders","Glutes"], muscle: ["Chest","Back","Legs"], endurance: ["Cardio","Full body","Core"], "fat-loss": ["Full body","Cardio","Legs"], general: [] }[goal] || [];
  pool.sort((a,b)=> {
    const ai = bias.indexOf(a.muscle), bi = bias.indexOf(b.muscle);
    const av = ai===-1? 99: ai; const bv = bi===-1? 99: bi;
    if(av!==bv) return av - bv;
    // tie-break: prefer exercises user has data for
    const pa = performed.has(a.id)?0:1, pb = performed.has(b.id)?0:1;
    return pa - pb;
  });
  // Ensure variety: pick one per muscle round-robin
  const seenMuscle=new Set(); const picked=[];
  for(const ex of pool){ if(picked.length>=length) break; if(!seenMuscle.has(ex.muscle) || picked.length>2){ picked.push(ex); seenMuscle.add(ex.muscle); } }
  // Fill remainder
  for(const ex of pool){ if(picked.length>=length) break; if(!picked.some(p=> p.id===ex.id)) picked.push(ex); }
  let blocks = picked.map(ex=>{
    const rec = recommendNext({ exerciseId: ex.id, history, targetReps: "8–12" });
    const sets = setsForProgression(ex.progression || 'hypertrophy', rec);
    const reps = rec.reps || "8";
    const loadHint = rec.load != null && rec.load>0 ? `${rec.load}kg` : rec.assistKg != null && rec.assistKg>0 ? `${rec.assistKg}kg assist` : (rec.load===null? "bodyweight": "as prescribed");
    const isUnilateral = ex.unilateral || /lunge|split|single|bulgarian/i.test(ex.id);
    // Rest: use helper, fallback to 90
    const restSec = ex.muscle==="Cardio"?0: (recommendedRest({ exerciseId: ex.id, load: rec.load, rpe: null, setIndex: 0, totalSets: sets }) || 90);
    // Warm-ups: includeWarmup -> generate from previous session + target
    let warmups = [];
    if(includeWarmup){
      const prev = history.length ? history[history.length-1] : null;
      const prevBlock = prev ? (prev.blocks||[]).find(b=> b.exerciseId===ex.id) : null;
      warmups = warmupSets({ exerciseId: ex.id, targetLoad: rec.load, targetReps: rec.reps, lastSets: prevBlock?.sets||null });
    }
    return {
      exerciseId: ex.id, sets, reps: String(reps), restSec, loadHint,
      why: rec.reason, unilateral: isUnilateral, includeWarmup, warmups,
      progression: ex.progression || 'hypertrophy',
      supportsWeighted: !!ex.supportsWeighted,
      supportsAssisted: !!ex.supportsAssisted,
    };
  });
  // Fatigue-aware ordering: heavy compounds first, least-trained muscles early
  // while fresh, same-muscle/family exercises kept apart, cardio last.
  const weak = weakPointMuscles(history, EXERCISE_BY_ID);
  blocks = fatigueAwareOrder(blocks, EXERCISE_BY_ID, { priorityMuscles: weak });
  // Superset scoring (best compatible pairs)
  const supersets = bestSupersets(blocks, EXERCISE_BY_ID);
  const estimatedDurationMin = predictSessionDuration(blocks.map(b=> ({ sets: b.sets, restSec: b.restSec, warmups: b.warmups })));
  return { blocks, supersets, estimatedDurationMin };
}

function setsForProgression(progression, rec){
  if(progression==='strength') return 4;
  if(progression==='time') return 3;
  return 3;
}

// Generate next mesocycle week: periodised progression (volume/intensity trade-off)
export function nextMesocycleWeek({ programId, currentWeek, history }){
  // Simple linear periodisation: week 1 base, week 2 +volume, week 3 peak, week 4 deload
  const weekInCycle = ((currentWeek - 1) % 4) + 1;
  if(weekInCycle===4) return { type: 'deload', volumeCut: 0.6, note: 'Deload week — cut volume ~40%, keep loads moderate.' };
  if(weekInCycle===3) return { type: 'peak', note: 'Peak week — push for small PRs where form holds.' };
  if(weekInCycle===2) return { type: 'build', note: 'Build week — add a set or reps where RIR ≥2.' };
  return { type: 'base', note: 'Base week — establish working loads.' };
}
