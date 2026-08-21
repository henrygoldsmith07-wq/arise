import { scheduleProgram, PROGRAM_BY_ID } from './data.js';

export function todayISO(){
  const d = new Date();
  const pad = value=> String(value).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

export function sessionForToday(schedule){
  if(!schedule?.sessions?.length) return null;
  const t = todayISO();
  return schedule.sessions.find(s=> s.dateISO===t && s.status!=='done') || null;
}

export function nextSession(schedule){
  if(!schedule?.sessions?.length) return null;
  const t = todayISO();
  return schedule.sessions.find(s=> s.dateISO >= t && s.status!=='done') || schedule.sessions.find(s=> s.status!=='done') || null;
}

export function progress(schedule, history){
  if(!schedule) return { done:0, total:0, pct:0 };
  const total = schedule.sessions.length;
  const doneIds = new Set((history||[]).map(h=> h.id));
  const done = schedule.sessions.filter(s=> doneIds.has(s.id) || s.status==='done').length;
  return { done, total, pct: total? Math.round(done/total*100):0 };
}

export function startProgram(store, programId){
  const start = todayISO();
  const sched = scheduleProgram({ programId, startDateISO: start });
  return { ...store, activeSchedule: sched };
}

export function markSessionDone(store, session){
  const entry = {
    id: session.id,
    dateISO: session.dateISO,
    programId: session.programId,
    week: session.week,
    day: session.day,
    title: session.title,
    blocks: session.blocks.map(b=> ({ exerciseId: b.exerciseId, sets: Array.from({length:b.sets}, ()=> ({ reps: parseReps(b.reps), weightKg: '', rpe: '' })) })),
  };
  // mark schedule
  let activeSchedule = store.activeSchedule;
  if(activeSchedule){
    activeSchedule = { ...activeSchedule, sessions: activeSchedule.sessions.map(s=> s.id===session.id ? { ...s, status:'done' } : s) };
  }
  return { ...store, activeSchedule, history: [...(store.history||[]), entry] };
}

function parseReps(reps){
  if(typeof reps==='number') return String(reps);
  // "8–12" or "30–45s" — default to lower bound number
  const m = String(reps).match(/\d+/);
  return m ? m[0] : '';
}

export function programName(programId){ return PROGRAM_BY_ID[programId]?.name || programId; }
