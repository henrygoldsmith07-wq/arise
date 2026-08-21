// Attributes derive from actual training history — not program labels.
// This is the "levelled up" system: train, log load, watch attributes climb.

import { EXERCISE_BY_ID } from './data.js';

const ATTRS = ['Strength','Endurance','Consistency','Technique'];

export function deriveAttributes(history){
  if(!history.length) return baseAttrs();

  const sessions = history.length;
  const muscles = new Set(history.flatMap(h=> (h.blocks||[]).map(b=> EXERCISE_BY_ID[b.exerciseId]?.muscle).filter(Boolean)));

  // Strength: best estimated 1RM trend across main lifts, plus volume
  const strengthScore = Math.min(100, Math.round(30 + sessions*2 + Math.min(30, maxE1RM(history)/2) + muscles.size*2));
  // Endurance: total reps + cardio minutes + number of conditioning sessions
  const enduranceScore = Math.min(100, Math.round(25 + totalReps(history)/60 + cardioMinutes(history)/2 + sessions*1.2));
  // Consistency: streak, frequency, and completion rate
  const consistencyScore = Math.min(100, Math.round(20 + streakBonus(history) + sessions*1.5 + (muscles.size>=5?8:0)));
  // Technique: variety, balanced muscle coverage, and logging discipline (rpe/notes present)
  const techniqueScore = Math.min(100, Math.round(25 + muscles.size*6 + loggingBonus(history) + Math.min(20, sessions)));

  return [
    { id:'strength', label:'Strength', value: clamp(strengthScore), blurb: oneLiner('strength', strengthScore) },
    { id:'endurance', label:'Endurance', value: clamp(enduranceScore), blurb: oneLiner('endurance', enduranceScore) },
    { id:'consistency', label:'Consistency', value: clamp(consistencyScore), blurb: oneLiner('consistency', consistencyScore) },
    { id:'technique', label:'Technique', value: clamp(techniqueScore), blurb: oneLiner('technique', techniqueScore) },
  ];
}

function baseAttrs(){
  return [
    { id:'strength', label:'Strength', value: 12, blurb: 'Log a session to start building strength.' },
    { id:'endurance', label:'Endurance', value: 12, blurb: 'Conditioning and volume grow this over time.' },
    { id:'consistency', label:'Consistency', value: 10, blurb: 'Show up — the streak does the rest.' },
    { id:'technique', label:'Technique', value: 14, blurb: 'Variety and good logging raise technique.' },
  ];
}

function totalReps(history){
  let n=0;
  for(const h of history) for(const b of h.blocks||[]) for(const s of b.sets||[]) n += Number(s.reps)||0;
  return n;
}
function cardioMinutes(history){
  let m=0;
  for(const h of history) for(const b of h.blocks||[]){
    const ex = EXERCISE_BY_ID[b.exerciseId];
    if(ex?.muscle==='Cardio') for(const s of b.sets||[]) {
      // reps field may be minutes like "20 min" — parse number
      const v = String(s.reps||'');
      const num = parseFloat(v);
      if(Number.isFinite(num)) m += num;
    }
  }
  return m;
}
function maxE1RM(history){
  // Epley 1RM = w * (1 + reps/30)
  let best=0;
  for(const h of history) for(const b of h.blocks||[]) for(const s of b.sets||[]){
    const w = Number(s.weightKg)||0;
    const r = Number(s.reps)||0;
    if(w>0 && r>0) best = Math.max(best, w * (1 + r/30));
  }
  return best;
}
function streakBonus(history){
  const dates=[...new Set(history.map(h=>h.dateISO))].sort();
  let cur=1, best=1;
  for(let i=1;i<dates.length;i++){
    const d = (new Date(dates[i]+'T00:00:00') - new Date(dates[i-1]+'T00:00:00'))/86400000;
    if(d===1) cur++; else cur=1;
    best=Math.max(best,cur);
  }
  return Math.min(20, best*4);
}
function loggingBonus(history){
  let withRpe=0, total=0;
  for(const h of history) for(const b of h.blocks||[]) for(const s of b.sets||[]) { total++; if(s.rpe) withRpe++; }
  if(!total) return 0;
  return Math.round((withRpe/total)*12);
}
function clamp(n){ return Math.max(0, Math.min(100, Math.round(n))); }
function oneLiner(attr, v){
  if(v>=80) return attr==='strength' ? 'Strong — progressive overload is landing.' : attr==='endurance' ? 'Engine built — you can go long.' : attr==='consistency' ? 'Reliable — the habit is yours.' : 'Clean — balanced, well-logged training.';
  if(v>=50) return 'Solid base — keep stacking sessions.';
  if(v>=30) return 'Early momentum — stay consistent.';
  return 'Just getting started — every session counts.';
}

export function levelFromAttributes(attrs){
  const avg = Math.round(attrs.reduce((a,b)=>a+b.value,0)/attrs.length);
  // Level 1 at avg ~15, level 10 at ~85 — gentle curve
  const level = Math.max(1, Math.min(20, Math.floor(avg/7)+1));
  return { level, avg, title: levelTitle(level) };
}
function levelTitle(l){
  if(l>=18) return 'Veteran';
  if(l>=15) return 'Conditioned';
  if(l>=12) return 'Committed';
  if(l>=9) return 'Steady';
  if(l>=6) return 'Active';
  if(l>=3) return 'Starter';
  return 'New';
}
