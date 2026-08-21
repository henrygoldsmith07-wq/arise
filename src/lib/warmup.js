// warmup.js — generate warm-up sets from previous session + target load.
// Conservative, explains every suggestion.

import { epleyToLoad } from './progression.js';

export function warmupSets({ exerciseId, targetLoad, targetReps, lastSets }){
  // targetLoad: number kg (0 or null = bodyweight)
  // Returns array of { reps, weightKg, note } to prepend before work sets
  if(targetLoad==null || targetLoad<=0) {
    // Bodyweight / cardio — activation only
    return [
      { reps: '8', weightKg: '', note: 'Activation — slow, controlled' },
      { reps: '6', weightKg: '', note: 'Build to working tempo' },
    ];
  }
  // Standard ramp: 50% ×5, 70% ×3, 85% ×1-2
  const w1 = Math.max(0, snapWarmup(targetLoad*0.5));
  const w2 = Math.max(0, snapWarmup(targetLoad*0.7));
  const w3 = Math.max(0, snapWarmup(targetLoad*0.85));
  const out = [];
  if(w1) out.push({ reps: '5', weightKg: String(w1), note: 'Warm-up 50%' });
  if(w2 && w2!==w1) out.push({ reps: '3', weightKg: String(w2), note: 'Warm-up 70%' });
  if(w3 && w3!==w2) out.push({ reps: '1', weightKg: String(w3), note: 'Warm-up 85% — feel the load' });
  // If last session was heavier, mention it
  if(lastSets && lastSets[0] && Number(lastSets[0].weightKg) > targetLoad) {
    out.push({ reps: String(targetReps||'5'), weightKg: String(targetLoad), note: `Work sets at ${targetLoad}kg` });
  }
  return out;
}

function snapWarmup(v){
  if(v<20) return Math.round(v/1);
  if(v<60) return Math.round(v/2.5)*2.5;
  return Math.round(v/5)*5;
}

// Estimate rest between sets (seconds) from exercise + load + RPE
export function recommendedRest({ exerciseId, load, rpe, setIndex, totalSets }){
  const heavy = load && load >= 60;
  const nearFailure = rpe!=null && Number(rpe) >= 8;
  let base = 90;
  if(/squat|deadlift|bench|press|pull-up/.test(exerciseId||'')) base = heavy ? 150 : 120;
  if(/isolation|raise|curl|plank|dead-bug/.test(exerciseId||'')) base = 60;
  if(nearFailure) base += 30;
  if(setIndex === totalSets-1) base = Math.max(60, base-15); // last set slightly shorter
  return base;
}

// Predict session duration (minutes) from blocks + warm-ups + rests
export function predictSessionDuration(blocks){
  let totalSec = 0;
  for(const b of blocks||[]){
    const sets = Number(b.sets)||3;
    const rest = Number(b.restSec)||90;
    const warmups = b.warmups ? b.warmups.length : 0;
    // 45s per set execution + rest between sets + warm-up time
    totalSec += sets*45 + Math.max(0, sets-1)*rest + warmups*60;
    totalSec += 90; // transition between exercises
  }
  return Math.max(8, Math.round(totalSec/60));
}

// Superset compatibility scoring (0..1)
export function supersetScore(aId, bId, byId){
  const a = byId?.[aId], b = byId?.[bId];
  if(!a || !b) return 0.5;
  if(a.muscle === b.muscle) return 0.2; // same muscle — poor
  const pushPull = new Set(['Chest|Back','Chest|Glutes','Back|Legs','Shoulders|Legs','Arms|Legs','Core|Legs','Cardio|Core']);
  const key = [a.muscle,b.muscle].sort().join('|');
  if(pushPull.has(key)) return 0.95;
  if(a.muscle==='Cardio' || b.muscle==='Cardio') return 0.3; // don't superset cardio
  return 0.7;
}

export function bestSupersets(blocks, byId){
  if(!blocks || blocks.length < 4) return [];
  const pairs=[];
  for(let i=0;i<blocks.length;i++) for(let j=i+1;j<blocks.length;j++){
    const score = supersetScore(blocks[i].exerciseId, blocks[j].exerciseId, byId);
    pairs.push({ a: blocks[i].exerciseId, b: blocks[j].exerciseId, score });
  }
  pairs.sort((x,y)=> y.score - x.score);
  return pairs.slice(0, 2).map(p=> [p.a, p.b]);
}

// ── Fatigue-aware exercise ordering ────────────────────────────────────
// Better than a static sort: heavy compounds and weak-point muscles still get
// placed early (fresh), but a greedy step avoids stacking exercises that share
// a muscle or movement family back-to-back (e.g. two Chest pushes in a row),
// and cardio is always pushed to the end.

const FAMILIES = { push: new Set(['Chest','Shoulders','Arms']), pull: new Set(['Back','Arms']), legs: new Set(['Legs','Glutes']) };

// Muscle/family overlap between two exercises (0..1): same exercise 1, same
// muscle 1, same push/pull/legs family 0.6, unrelated 0.
export function muscleOverlap(aId, bId, byId){
  if(!aId || !bId) return 0;
  if(aId===bId) return 1;
  const a = byId?.[aId], b = byId?.[bId];
  if(!a || !b) return 0;
  if(a.muscle === b.muscle) return 1;
  const fam = m=> FAMILIES.push.has(m) ? 'push' : FAMILIES.pull.has(m) ? 'pull' : FAMILIES.legs.has(m) ? 'legs' : null;
  const fa = fam(a.muscle), fb = fam(b.muscle);
  return (fa && fa===fb) ? 0.6 : 0;
}

// How early an exercise should be placed: heavy compounds first, weak-point
// muscles (priority) while fresh, unilateral before fatigue bites, isolation/
// core late, cardio last.
export function exercisePriorityScore(b, byId, priorityMuscles=[]){
  if(!b) return 0;
  const ex = byId?.[b.exerciseId];
  let s = 0;
  if(/squat|deadlift|bench|barbell|press|pull-up/.test(b.exerciseId||'')) s += 8;
  if(ex?.muscle==='Legs' || ex?.muscle==='Back') s += 3;
  if(ex?.muscle==='Cardio') s -= 20;
  if(ex?.unilateral || b.unilateral) s += 1;
  if(/isolation|raise|curl|plank|dead-bug|dip/.test(b.exerciseId||'')) s -= 3;
  if(priorityMuscles.includes(ex?.muscle)) s += 6;
  return s;
}

// Muscles trained least often (excluding Cardio) — train these while fresh.
export function weakPointMuscles(history, byId, count=2){
  const counts = {};
  for(const h of history||[]) for(const b of h.blocks||[]){
    const m = byId?.[b.exerciseId]?.muscle;
    if(!m || m==='Cardio') continue;
    counts[m] = (counts[m]||0) + 1;
  }
  return Object.entries(counts).sort((a,b)=> a[1]-b[1]).slice(0, count).map(([m])=> m);
}

export function fatigueAwareOrder(blocks, byId, opts={}){
  if(!blocks || blocks.length<=2) return blocks;
  const priority = opts.priorityMuscles || [];
  const remaining = [...blocks];
  // start with the highest-priority exercise
  remaining.sort((a,b)=> exercisePriorityScore(b, byId, priority) - exercisePriorityScore(a, byId, priority));
  const ordered = [remaining.shift()];
  // greedy: each step picks the remaining exercise that maximises priority minus
  // fatigue overlap with the one just placed (weighted so adjacency matters)
  while(remaining.length){
    const last = ordered[ordered.length-1];
    let bestIdx = 0, best = -Infinity;
    for(let i=0;i<remaining.length;i++){
      const v = exercisePriorityScore(remaining[i], byId, priority) - muscleOverlap(last.exerciseId, remaining[i].exerciseId, byId)*12;
      if(v > best){ best = v; bestIdx = i; }
    }
    ordered.push(remaining.splice(bestIdx,1)[0]);
  }
  return ordered;
}
