import { useMemo, useState } from 'react';
import { reviewCompletedWeek } from '../lib/mesocycle.js';
import { e1rm } from '../lib/progression.js';
import { EXERCISE_BY_ID } from '../lib/data.js';

function mondayKey(dateISO){
  const d = new Date(`${dateISO}T00:00:00Z`);
  if(Number.isNaN(d.getTime())) return null;
  const m = new Date(d); m.setUTCDate(d.getUTCDate() - ((d.getUTCDay()+6)%7));
  return m.toISOString().slice(0,10);
}
const pctDelta = (a,b)=> b>0 ? Math.round((a-b)/b*1000)/10 : null;

export default function WeeklyReviewCard({ store, setStore }){
  const [expanded,setExpanded]=useState(false);

  const data = useMemo(()=>{
    try{
      const review = reviewCompletedWeek({ schedule: store.activeSchedule, history: store.history||[], readinessLog: store.readinessLog||[], availableEquipment: store.onboarding?.equipment||[] });
      if(!review.ready) return null;
      const ackKey = `week:${review.reviewedWeekKey}`;
      if((store.lastWeeklyReviewAck||'') === ackKey && !review.directives.some(d=>d.kind!=='hold')) return null;
      if((store.lastWeeklyReviewAck||'') === ackKey) return { review, ackKey, alreadyApplied:true };

      const wkSessions = (store.history||[]).filter(h=> mondayKey(h.dateISO)===review.reviewedWeekKey);
      const allPrev = (store.history||[]).filter(h=> mondayKey(h.dateISO)<review.reviewedWeekKey);
      const weekE1=[] , prevE1=[];
      let volW=0, volP=0;
      const collect=(h,arr,v)=>{ for(const b of h.blocks||[]) for(const s of b.sets||[]){ const r=Number(s.reps)||0,w=Number(s.weightKg)||0; v.v+=r*w; arr.push(e1rm(w,r)); } };
      const vw={v:0}, vp={v:0};
      for(const h of wkSessions){ collect(h,weekE1,vw); volW+=vw.v; }
      for(const h of allPrev.slice(-4)){ collect(h,prevE1,vp); volP+=vp.v; }
      const strength = (weekE1.length&&prevE1.length)? pctDelta(Math.max(...weekE1),Math.max(...prevE1)) : null;
      const volume = (volP>0)? pctDelta(volW,volP) : null;
      const rs=(store.readinessLog||[]).map(r=>Number(r.score)).filter(Number.isFinite).slice(-8);
      const readiness= rs.length? Math.round(rs.reduce((a,b)=>a+b,0)/rs.length):null;
      // New PRs this week: best e1RM exceeds any prior occurrence per exercise.
      let prs=0;
      const bestBefore=new Map();
      for(const h of allPrev) for(const b of h.blocks||[]) for(const s of b.sets||[]){
        const v=e1rm(Number(s.weightKg)||0,Number(s.reps)||0);
        if(v>(bestBefore.get(b.exerciseId)||0)) bestBefore.set(b.exerciseId,v);
      }
      const weekSet=new Set(wkSessions.map(h=>h.id));
      const seen=new Set();
      for(const h of wkSessions) for(const b of h.blocks||[]) for(const s of b.sets||[]){
        const v=e1rm(Number(s.weightKg)||0,Number(s.reps)||0);
        if(!seen.has(b.exerciseId)&&v>0&&v>(bestBefore.get(b.exerciseId)||0)){ prs++; seen.add(b.exerciseId); }
      }
      void weekSet;
      return { review, ackKey, strength, volume, readiness, prs,
        completion:{ done: wkSessions.length, total: review.targetWeekNumber ? wkSessions.length : wkSessions.length },
        weekNumber: review.targetWeekNumber ? review.targetWeekNumber-1 : null };
    }catch{ return null; }
  },[store]);

  if(!data || !data.review) return null;
  const { review } = data;
  const structural = review.directives.filter(d=>d.kind!=='hold');
  const fmtDir = d=>{
    const name = EXERCISE_BY_ID[d.exerciseId]?.name || d.exerciseId;
    if(d.kind==='add-sets') return `${name}: sets → ${d.sets}`;
    if(d.kind==='deload'||d.kind==='reduce-sets') return `${name}: hold ${d.sets} sets`;
    if(d.kind==='rotate') return `${name} → ${EXERCISE_BY_ID[d.toExerciseId]?.name||d.toExerciseId}`;
    return `${name}: hold`;
  };

  const accept = ()=>{ try{ setStore({ ...store, lastWeeklyReviewAck: data.ackKey }); }catch{} };

  return (
    <section className="mx-4 mt-4 rounded-2xl border border-line bg-surface p-4 space-y-3" aria-label="Weekly review">
      <div className="flex items-baseline gap-2">
        <p className="text-sm font-extrabold tracking-tight">WEEK {data.weekNumber ?? ''} REVIEW</p>
        <span className={`ml-auto text-[11px] font-bold px-2 py-0.5 rounded-full border ${structural.length?'border-success text-success':'border-line text-ink3'}`}>{structural.length?`${structural.length} change${structural.length===1?'':'s'} queued`:'no changes'}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
        {[['Strength', data.strength==null?'—':`${data.strength>0?'↑':'↓'} ${Math.abs(data.strength)}%`],
          ['Completion', `${review.deloadDecision? '':''}${data.completion.done}/${data.completion.total}`],
          ['Readiness', data.readiness??'—'],
          ['Volume', data.volume==null?'—':`${data.volume>0?'+':''}${data.volume}%`],
          ['New PRs', data.prs]].map(([label,val])=> (
          <div key={label} className="rounded-xl bg-surface2 border border-line px-2 py-2">
            <p className="text-[10px] uppercase tracking-widest text-ink3">{label}</p>
            <p className="text-sm font-bold tabular-nums">{val}</p>
          </div>
        ))}
      </div>
      {!!structural.length && (
        <div className="space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">Next week</p>
          {structural.map((d,i)=>(
            <div key={i} className="rounded-xl border border-line bg-surface2 px-3 py-2">
              <button onClick={()=>setExpanded(e=>!e)} className="w-full text-left flex items-center gap-2">
                <span className="text-xs font-bold">{fmtDir(d)}</span>
                <span className="ml-auto text-[11px] text-ink3">{expanded?'Hide reason':'Why?'}</span>
              </button>
              {(expanded || d.kind==='rotate') && <p className="text-[11px] text-ink3 mt-1">{d.reason}</p>}
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={accept} className="btn btn-primary flex-1 min-h-10 rounded-xl">Accept week</button>
        <button onClick={()=>setExpanded(e=>!e)} className="btn btn-secondary min-h-10 rounded-xl px-4">{expanded?'Hide details':'Review changes'}</button>
      </div>
    </section>
  );
}
