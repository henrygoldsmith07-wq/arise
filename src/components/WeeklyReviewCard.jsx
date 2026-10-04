import { useMemo, useState } from 'react';
import { reviewCompletedWeek, weekOf } from '../lib/mesocycle.js';
import { acknowledgeWeeklyReview } from '../services/settingsService.js';
import { e1rm } from '../lib/progression.js';
import { EXERCISE_BY_ID } from '../lib/data.js';
import { totalVolumeKg } from '../lib/store.js';
import { confidenceLanguage } from '../lib/performance.js';

const pctDelta = (a,b)=> b>0 ? Math.round((a-b)/b*1000)/10 : null;
const exName = (id)=> EXERCISE_BY_ID[id]?.name || id;

// The signature Weekly Review. Answers four questions in order:
//   1. What did I do?      — completion + volume
//   2. Did I improve?      — per-exercise performance, with honest evidence
//   3. What did Arise notice? — the narrative signals (flat exposures, hot targets, PRs)
//   4. What changes next week? — the engine's directives, each with its reason
// Analytics are converted into decisions; nothing here is a metric wall.
export default function WeeklyReviewCard({ store, setStore }){
  const [expanded,setExpanded]=useState(false);

  const data = useMemo(()=>{
    try{
      const review = reviewCompletedWeek({ schedule: store.activeSchedule, history: store.history||[], readinessLog: store.readinessLog||[], availableEquipment: store.onboarding?.equipment||[], policy: store.preferences?.progressionPolicy || 'standard' });
      if(!review.ready) return null;
      const ackKey = `week:${review.reviewedWeekKey}`;
      if((store.lastWeeklyReviewAck||'') === ackKey && !review.directives.some(d=>d.kind!=='hold')) return null;
      if((store.lastWeeklyReviewAck||'') === ackKey) return { review, ackKey, alreadyApplied:true };

      const wkSessions = (store.history||[]).filter(h=> weekOf(h.dateISO)===review.reviewedWeekKey);
      const allPrev = (store.history||[]).filter(h=> weekOf(h.dateISO)<review.reviewedWeekKey);
      const previousWeekKey = [...new Set(allPrev.map(h=> weekOf(h.dateISO)).filter(Boolean))].sort().at(-1);
      const prevSessions = previousWeekKey ? allPrev.filter(h=> weekOf(h.dateISO)===previousWeekKey) : [];

      const volW = totalVolumeKg(wkSessions), volP = totalVolumeKg(prevSessions);
      const volumeDelta = volP>0 ? pctDelta(volW, volP) : null;

      // ── Did I improve? Per-exercise comparable performance ──
      const bestOf = (sessions)=>{
        const map = new Map();
        for(const h of sessions) for(const b of h.blocks||[]) for(const s of b.sets||[]){
          if(s.failed || s.skipped) continue;
          const v = e1rm(Number(s.weightKg)||0, Number(s.reps)||0);
          if(v > 0) map.set(b.exerciseId, Math.max(map.get(b.exerciseId)||0, v));
        }
        return map;
      };
      const weekBest = bestOf(wkSessions), prevBest = bestOf(prevSessions);
      const exposuresBefore = new Map();
      for(const h of allPrev) for(const b of h.blocks||[]) exposuresBefore.set(b.exerciseId, (exposuresBefore.get(b.exerciseId)||0)+1);

      const improved = [], steady = [], insufficient = [];
      for(const [id, cur] of weekBest){
        const before = prevBest.get(id) || 0;
        const exposures = exposuresBefore.get(id)||0;
        const name = exName(id);
        if(before <= 0 || exposures < 2){ insufficient.push(name); continue; }
        const delta = (cur-before)/before;
        if(delta >= 0.02) improved.push({ name, deltaPct: Math.round(delta*100) });
        else if(delta <= -0.02) steady.push({ name, note:'a little down on last time' });
        else steady.push({ name, note:'level with last time' });
      }

      // ── What did Arise notice? ──
      const noticed = [];
      for(const [id, cur] of weekBest){
        const before = prevBest.get(id)||0;
        if(before > 0 && (cur-before)/before >= 0.02 && improved.length <= 4){
          // reaching the top of the rep range twice is a real, named signal
          let topRange = 0;
          for(const h of wkSessions) for(const b of h.blocks||[]) if(b.exerciseId===id) for(const s of b.sets||[]){
            if(!s.failed && !s.skipped && Number(s.rpe) >= 8) topRange++;
          }
          if(topRange >= 2) noticed.push(`${exName(id)}: you pushed hard in ${topRange} sets — the load increase is earned.`);
        }
      }
      const flatExposures = [];
      for(const [id] of weekBest){
        const before = prevBest.get(id)||0, cur = weekBest.get(id)||0;
        if(before > 0 && Math.abs(cur-before)/before < 0.02 && (exposuresBefore.get(id)||0) >= 3) flatExposures.push(exName(id));
      }
      if(flatExposures.length) noticed.push(`${flatExposures.slice(0,3).join(', ')}: flat across three or more exposures — a change of stimulus is the plan, not more grinding.`);
      const rs = (store.readinessLog||[]).map(r=>Number(r.score)).filter(Number.isFinite).slice(-8);
      if(rs.length >= 3){
        const avg = rs.reduce((a,b)=>a+b,0)/rs.length;
        noticed.push(avg >= 60 ? 'Recovery: no sustained fatigue signal detected.' : `Recovery: readiness averaged ${Math.round(avg)} — worth keeping an eye on sleep.`);
      } else {
        noticed.push('Recovery: not enough check-ins yet to read fatigue — the log grows with your sessions.');
      }
      if(!noticed.length && !improved.length && !steady.length) noticed.push('Not enough logged work this week to say much yet. Two or three sessions and the picture sharpens.');

      // New PRs: best e1RM exceeds every prior session per exercise.
      let prs = 0; const seen = new Set();
      for(const h of wkSessions) for(const b of h.blocks||[]) for(const s of b.sets||[]){
        const v = e1rm(Number(s.weightKg)||0, Number(s.reps)||0);
        if(!seen.has(b.exerciseId) && v > 0 && v > (prevBest.get(b.exerciseId)||0) && (exposuresBefore.get(b.exerciseId)||0) >= 1){ prs++; seen.add(b.exerciseId); }
      }

      return {
        review, ackKey,
        weekNumber: review.targetWeekNumber ? review.targetWeekNumber-1 : null,
        completion: { done: review.completedSessionCount ?? wkSessions.length, total: review.reviewedSessionCount ?? wkSessions.length },
        volumeKg: volW,
        volumeDelta,
        improved, steady, insufficient, noticed, prs,
      };
    }catch{ return null; }
  },[store]);

  if(!data || !data.review) return null;
  const { review } = data;
  const structural = review.directives.filter(d=>d.kind!=='hold');
  const fmtDir = (d)=>{
    const name = exName(d.exerciseId);
    if(d.kind==='add-sets') return `${name}: sets → ${d.sets}`;
    if(d.kind==='deload'||d.kind==='reduce-sets'||d.kind==='recovery-session') return `${name}: ${d.sets} sets (recovery)`;
    if(d.kind==='rotate') return `${name} → ${exName(d.toExerciseId)}`;
    return `${name}: hold`;
  };

  const accept = ()=>{ try{ setStore(acknowledgeWeeklyReview(store, data.ackKey)); }catch{} };

  return (
    <section className="mx-4 mt-4 rounded-2xl border border-line bg-surface p-4 space-y-3" aria-label="Weekly review">
      <div className="flex items-baseline gap-2">
        <p className="text-sm font-extrabold tracking-tight">Your week{data.weekNumber != null ? ` — week ${data.weekNumber}` : ''}</p>
        <span className={`ml-auto text-[11px] font-bold px-2 py-0.5 rounded-full border ${structural.length?'border-success text-success':'border-line text-ink3'}`}>{structural.length?`${structural.length} change${structural.length===1?'':'s'} next week`:'no changes needed'}</span>
      </div>

      {/* 1. What did I do? */}
      <div className="rounded-xl bg-surface2 border border-line px-3 py-2">
        <p className="text-sm font-bold">{data.completion.done}/{data.completion.total} workouts completed</p>
        <p className="text-[11px] text-ink3">{data.volumeKg.toLocaleString()} kg of work{data.volumeDelta != null ? ` · ${data.volumeDelta > 0 ? '+' : ''}${data.volumeDelta}% volume vs last week` : ''}</p>
      </div>

      {/* Deload as a first-class state */}
      {review.deloadDecision?.yes && (
        <div className="rounded-xl bg-reviewsoft border border-review/30 px-3 py-2" role="status">
          <p className="text-xs font-bold text-review">🔄 Deload week ahead</p>
          <p className="text-[11px] text-ink2 leading-snug">Next week's volume is reduced on purpose — the plan is the deload. Keep the loads honest, let the fatigue clear.</p>
        </div>
      )}

      {/* 2. Did I improve? */}
      <div className="rounded-xl border border-line bg-surface2 px-3 py-2 space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">Did I improve?</p>
        {data.improved.map((row)=> (
          <p key={row.name} className="text-xs"><span className="font-semibold">{row.name}</span> <span className="text-success font-bold">↑ {row.deltaPct}%</span> <span className="text-ink3">estimated 1RM vs your last comparable session</span></p>
        ))}
        {data.steady.map((row)=> (
          <p key={row.name} className="text-xs"><span className="font-semibold">{row.name}</span> <span className="text-ink3">— {row.note}</span></p>
        ))}
        {!!data.insufficient.length && (
          <p className="text-[11px] text-ink3">No clear trend yet on {data.insufficient.slice(0,3).join(', ')} — Arise needs a couple of comparable sessions per exercise first.</p>
        )}
        {!data.improved.length && !data.steady.length && !data.insufficient.length && (
          <p className="text-xs text-ink3">Nothing comparable yet — keep logging and this fills in.</p>
        )}
        {data.prs > 0 && <p className="text-xs font-semibold text-success">🏆 {data.prs} new personal best{data.prs === 1 ? '' : 's'} — best estimated 1RM yet on the day's top set.</p>}
      </div>

      {/* 3. What did Arise notice? */}
      <div className="rounded-xl border border-line bg-surface2 px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">What Arise noticed</p>
        <ul className="mt-1 space-y-1">
          {data.noticed.map((line, i)=> <li key={i} className="text-[11px] text-ink2 leading-snug">{line}</li>)}
        </ul>
      </div>

      {/* 4. What changes next week? */}
      {structural.length > 0 && (
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
          <p className="text-[11px] text-ink3">Programme: {review.deloadDecision?.yes ? 'deload planned — no new stress.' : 'no deload needed.'}</p>
        </div>
      )}
      {structural.length === 0 && (
        <p className="text-[11px] text-ink3">Programme: no deload needed — next week continues as planned.</p>
      )}

      <div className="flex gap-2">
        <button onClick={accept} className="btn btn-primary flex-1 min-h-10 rounded-xl">{data.alreadyApplied ? 'Done' : 'Accept week'}</button>
        <button onClick={()=>setExpanded(e=>!e)} className="btn btn-secondary min-h-10 rounded-xl px-4">{expanded?'Hide reasons':'Show reasons'}</button>
      </div>
    </section>
  );
}
