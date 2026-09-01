import { useMemo, useState } from 'react';
import { PROGRAMS, PROGRAM_BY_ID, PROGRAM_TEMPLATES, programHistory as programVersionHistory, availablePrograms, EXERCISE_BY_ID, EXERCISES, plannedVsCompleted, GOALS, LEVELS, scheduleProgram } from '../lib/data.js';
import { startProgram } from '../lib/schedule.js';
import { adaptScheduleForEquipment, programAdherence, recordProgramStart, userProgramHistory } from '../lib/programming.js';
import { generateProgramme } from '../lib/programmeGenerator.js';

const EMPTY_DAY = { title: '', exercises: [{ exerciseId: '', sets: 3, reps: '8–12' }] };

function makeId(){ return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; }

function buildCustomTemplate({ name, description, level, goal, days }, existing = null){
  const id = existing?.id || makeId();
  const usedEquipment = new Set(['bodyweight']);
  const workouts = days.map((day, i)=> ({
    day: i + 1,
    title: day.title?.trim() || `Day ${i + 1}`,
    blocks: day.exercises
      .filter(e => e.exerciseId)
      .map(e => {
        for(const eq of (EXERCISE_BY_ID[e.exerciseId]?.equipment || [])) usedEquipment.add(eq);
        return { exerciseId: e.exerciseId, sets: Math.max(1, Number(e.sets) || 3), reps: e.reps?.trim() || '8–12', restSec: 90, loadHint: '' };
      }),
  }));
  const nowISO = new Date().toISOString();
  const base = existing ? { ...existing, version: (existing.version || 1) + 1 } : { id, isCustom: true, version: 1, createdAtISO: nowISO };
  return {
    ...base,
    name: name.trim(),
    description: description.trim() || 'Your own template.',
    level, goal, daysPerWeek: days.length,
    updatedAtISO: nowISO,
    program: {
      id, name: name.trim(), tagline: description.trim() || 'Your own template.',
      level, daysPerWeek: days.length,
      mesocycle: { weeks: 4, deloadWeek: null, progression: 'double-progression' },
      version: base.version,
      equipment: [...usedEquipment],
      weeks: [{ week: 1, workouts }],
    },
  };
}

export default function TrainView({ store, setStore, onStartSession, availableEquipment }){
  const [programId,setProgramId]=useState(store.activeSchedule?.programId || PROGRAMS[0].id);
  const [builderOpen,setBuilderOpen]=useState(false);
  const [editingId,setEditingId]=useState(null);
  const [form,setForm]=useState({ name:'', description:'', level:'Beginner', goal:'general', days:[{ ...EMPTY_DAY }] });
  const customTemplates = store.customTemplates || [];
  const allPrograms = useMemo(()=> [
    ...PROGRAMS,
    ...customTemplates.map(t => ({ ...t.program, id: t.id, isCustom: true })),
  ], [customTemplates]);
  const programMeta = (pid)=> allPrograms.find(p => p.id === pid) || null;
  const availIds = useMemo(()=> new Set(availablePrograms(availableEquipment).map(p=>p.id)), [availableEquipment]);
  const program = programMeta(programId) || PROGRAMS[0];
  const active = store.activeSchedule;
  const pvc = useMemo(()=> active ? plannedVsCompleted(active, store.history||[]) : [], [active, store.history]);
  const adaptation = useMemo(()=> active ? adaptScheduleForEquipment(active, availableEquipment, store.history || []) : null, [active, availableEquipment, store.history]);
  const adherence = useMemo(()=> active ? programAdherence(active, store.history || []) : null, [active, store.history]);
  const userHistory = useMemo(()=> userProgramHistory(store.programHistory || [], active, store.history || []), [store.programHistory, active, store.history]);

  const start = ()=>{
    const custom = customTemplates.find(t => t.id === programId);
    const startDateISO = new Date().toISOString().slice(0, 10);
    const next = custom
      ? { ...store, activeSchedule: scheduleProgram({ programId, startDateISO, program: custom.program }) }
      : startProgram(store, programId);
    const prog = custom ? custom.program : PROGRAM_BY_ID[programId];
    if(!prog) return;
    const entry = { programId, version: prog.version||1, startDateISO: next.activeSchedule.startDateISO, endDateISO: null };
    const adapted = adaptScheduleForEquipment(next.activeSchedule, availableEquipment, store.history || []);
    const hist = recordProgramStart(store.programHistory || [], entry);
    setStore({ ...next, activeSchedule: adapted.schedule, programHistory: hist });
  };

  // ── Custom template builder helpers ──────────────────────────────────
  const openBuilder = (tplToEdit = null)=>{
    if(tplToEdit){
      const p = tplToEdit.program;
      setForm({
        name: tplToEdit.name, description: tplToEdit.description || '',
        level: tplToEdit.level || 'Beginner', goal: tplToEdit.goal || 'general',
        days: (p.weeks?.[0]?.workouts || [EMPTY_DAY]).map(w => ({
          title: w.title,
          exercises: (w.blocks || []).map(b => ({ exerciseId: b.exerciseId, sets: b.sets, reps: b.reps })),
        })),
      });
      setEditingId(tplToEdit.id);
    }else{
      setForm({ name:'', description:'', level:'Beginner', goal:'general', days:[{ ...EMPTY_DAY }] });
      setEditingId(null);
    }
    setBuilderOpen(true);
  };
  const setDay = (di, patch)=> setForm(f => ({ ...f, days: f.days.map((d,i)=> i===di ? { ...d, ...patch } : d) }));
  const addDay = ()=> setForm(f => ({ ...f, days: [...f.days, { ...EMPTY_DAY }] }));
  const removeDay = (di)=> setForm(f => ({ ...f, days: f.days.length > 1 ? f.days.filter((_,i)=> i!==di) : f.days }));
  const setExercise = (di, ei, patch)=> setForm(f => ({ ...f, days: f.days.map((d,i)=> i!==di ? d : {
    ...d, exercises: d.exercises.map((e,j)=> j===ei ? { ...e, ...patch } : e),
  })}));
  const addExerciseRow = (di)=> setForm(f => ({ ...f, days: f.days.map((d,i)=> i!==di ? d : { ...d, exercises: [...d.exercises, { exerciseId:'', sets:3, reps:'8–12' }] }) }));
  const removeExerciseRow = (di, ei)=> setForm(f => ({ ...f, days: f.days.map((d,i)=> i!==di ? d : { ...d, exercises: d.exercises.filter((_,j)=> j!==ei) }) }));

  const saveBuilder = ()=>{
    if(!form.name.trim() || form.days.some(d => !d.exercises.some(e => e.exerciseId))){
      alert('Give the template a name and at least one exercise per day.');
      return;
    }
    const tpl = buildCustomTemplate(form, editingId ? customTemplates.find(t => t.id === editingId) : null);
    const nextList = editingId
      ? customTemplates.map(t => t.id === editingId ? tpl : t)
      : [...customTemplates, tpl];
    setStore({ ...store, customTemplates: nextList });
    setBuilderOpen(false);
    setProgramId(tpl.id);
  };
  const deleteCustom = (id)=>{
    if(!confirm('Delete this template? Schedules already started from it are not affected.')) return;
    setStore({ ...store, customTemplates: customTemplates.filter(t => t.id !== id) });
    if(programId === id) setProgramId(PROGRAMS[0].id);
  };

  const applyEquipmentChanges = ()=>{
    if(adaptation?.changed) setStore({ ...store, activeSchedule: adaptation.schedule });
  };

  const generateFromProfile = ()=>{
    if(!store.onboarding) return;
    const generated = generateProgramme({
      ...store.onboarding,
      availableEquipment: store.onboarding.equipment || [],
      history: store.history || [],
      startDateISO: new Date().toISOString().slice(0, 10),
    });
    const next = { ...store, activeSchedule: generated, programHistory: recordProgramStart(store.programHistory || [], { programId: generated.programId, version: generated.programVersion || 1, startDateISO: generated.startDateISO }) };
    setProgramId(generated.programId);
    setStore(next);
  };

  return (
    <div className="px-4 py-5 space-y-4">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight">Train</h2>
        <p className="text-xs text-ink3">Programs are scheduled training — picking one creates dated sessions you can run from Today. Templates are reusable blueprints; mesocycles periodise load across weeks.</p>
      </div>

      <div className="rounded-xl border border-line bg-surface2 px-3 py-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold">Templates</p>
          <button onClick={()=> openBuilder()} className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-full bg-ink text-bg min-h-8">+ New template</button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {PROGRAM_TEMPLATES.map(t=> (
            <button key={t.id} onClick={()=> setProgramId(t.programId)} className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${programId===t.programId?'bg-ink text-bg border-ink':'bg-surface border-line'}`}>{t.name}</button>
          ))}
          {customTemplates.map(t => (
            <span key={t.id} className="inline-flex items-center gap-1">
              <button onClick={()=> setProgramId(t.id)} className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${programId===t.id?'bg-ink text-bg border-ink':'bg-surface border-line'}`}>{t.name} ★</button>
              <button onClick={()=> openBuilder(t)} aria-label={`Edit ${t.name}`} className="text-[10px] text-ink3 underline">edit</button>
              <button onClick={()=> deleteCustom(t.id)} aria-label={`Delete ${t.name}`} className="text-[10px] text-danger underline">del</button>
            </span>
          ))}
        </div>
        <p className="text-[11px] text-ink3 mt-1">{PROGRAM_TEMPLATES.find(t=> t.programId===programId)?.description || customTemplates.find(t=> t.id===programId)?.description || ''}</p>
      </div>

      <div className="grid gap-2">
        {allPrograms.map(p=>{
          const ok = p.isCustom ? true : availIds.has(p.id);
          const isActive = active?.programId===p.id;
          return (
            <button key={p.id} onClick={()=> setProgramId(p.id)}
              className={`text-left rounded-2xl border p-4 transition-colors ${programId===p.id ? 'bg-surface2 border-ink ring-1 ring-ink' : 'bg-surface border-line hover:border-ink3'} ${!ok ? 'opacity-90' : ''}`}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold px-2 py-1 rounded-full border bg-surface border-line text-ink3">{p.level} • {p.daysPerWeek}×/week</span>
                {programId===p.id && <span className="text-xs font-bold px-2 py-1 rounded-full bg-ink text-bg">✓ Selected</span>}
                {isActive && <span className="text-xs font-bold px-2 py-1 rounded-full bg-success text-bg">Active</span>}
                {!ok && <span className="text-[11px] font-semibold text-review bg-reviewsoft border border-review/30 rounded-full px-2 py-1">Needs: {p.equipment.join(', ')}</span>}
                {p.mesocycle && <span className="text-[11px] text-ink3">• {p.mesocycle.weeks}w • {p.mesocycle.progression}</span>}
              </span>
              <span className="block mt-2 font-bold text-ink">{p.name} <span className="text-xs font-semibold">v{p.version||1}</span></span>
              <span className="block text-xs text-ink3">{p.tagline}</span>
            </button>
          );
        })}
      </div>

      {!availIds.has(programId) && (
        <p className="text-xs bg-reviewsoft border border-review/30 text-ink2 rounded-xl px-3 py-2">This program needs kit you didn’t select in onboarding. You can still start it — exercises show substitutions — but recommendations in Today will bias toward what you actually have. Update kit in More → Onboarding.</p>
      )}

      {active && adaptation?.changed && (
        <div className="rounded-xl border border-review/30 bg-reviewsoft px-3 py-3 space-y-2">
          <p className="text-xs font-bold text-review">Equipment change detected</p>
          <p className="text-xs text-ink2">{adaptation.reason} Your completed history stays attached to the original exercise IDs.</p>
          <ul className="text-[11px] text-ink2 space-y-1">
            {adaptation.substitutions.slice(0, 4).map((swap, i)=> <li key={`${swap.sessionId}-${i}`}>{swap.from} → {swap.to}</li>)}
          </ul>
          <button onClick={applyEquipmentChanges} className="btn btn-primary min-h-10 rounded-xl px-3 text-xs">Apply kit changes to schedule</button>
        </div>
      )}

      {active?.generationReasons?.length > 0 && (
        <details className="rounded-xl border border-line bg-surface2 px-3 py-3">
          <summary className="cursor-pointer text-xs font-bold">Why this programme was generated</summary>
          <ul className="mt-2 list-disc pl-5 text-[11px] text-ink3 space-y-1">
            {active.generationReasons.map((reason, index)=> <li key={`reason-${index}`}>{reason}</li>)}
          </ul>
          {!!active.substitutions?.length && (
            <div className="mt-3">
              <p className="text-[11px] font-bold">Recorded substitutions</p>
              <ul className="mt-1 space-y-1 text-[11px] text-ink3">
                {active.substitutions.slice(0, 6).map((swap, index)=> (
                  <li key={`${swap.sessionId}-${swap.from}-${index}`}>{EXERCISE_BY_ID[swap.from]?.name || swap.from} → {EXERCISE_BY_ID[swap.to]?.name || swap.to}</li>
                ))}
              </ul>
              {active.substitutions.length > 6 && <p className="mt-1 text-[11px] text-ink3">…and {active.substitutions.length - 6} more in the schedule record.</p>}
            </div>
          )}
          {!!active.generationWarnings?.length && (
            <div className="mt-3 rounded-lg border border-review/30 bg-reviewsoft px-2.5 py-2 text-[11px] text-ink2">
              <p className="font-bold text-review">Needs review</p>
              <ul className="mt-1 list-disc pl-4 space-y-1">{active.generationWarnings.map((warning, index)=> <li key={`${warning.sessionId}-${index}`}>{warning.reason}</li>)}</ul>
            </div>
          )}
        </details>
      )}

      {program && program.mesocycle && (
        <p className="text-xs text-ink3">Mesocycle: {program.mesocycle.weeks} weeks • progression {program.mesocycle.progression} {program.mesocycle.deloadWeek?`• deload week ${program.mesocycle.deloadWeek}`:''}</p>
      )}

      <div className="flex gap-2">
        {store.onboarding && <button onClick={generateFromProfile} className="btn btn-secondary flex-1 min-h-11 rounded-xl">Generate from profile</button>}
        <button onClick={start} className="btn btn-primary flex-1 min-h-11 rounded-xl">{active?.programId===programId ? 'Restart schedule from today' : 'Schedule this program'}</button>
        {active && <button onClick={()=> setStore({...store, activeSchedule:null})} className="btn btn-secondary min-h-11 rounded-xl px-4">Clear schedule</button>}
      </div>

      {builderOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 p-4 overflow-auto" role="dialog" aria-modal="true" aria-label="Template builder">
          <div className="max-w-xl mx-auto my-6 rounded-3xl bg-surface border border-line p-4 space-y-4">
            <div className="flex items-center gap-2">
              <p className="text-base font-bold">{editingId ? 'Edit template' : 'New template'}</p>
              <button onClick={()=> setBuilderOpen(false)} aria-label="Close builder" className="ml-auto w-9 h-9 grid place-items-center rounded-full border border-line">✕</button>
            </div>
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-widest text-ink3">Name</span>
              <input value={form.name} onChange={e=> setForm(f=> ({...f, name:e.target.value}))} className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm" placeholder="My push-pull split" />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-widest text-ink3">Description (optional)</span>
              <input value={form.description} onChange={e=> setForm(f=> ({...f, description:e.target.value}))} className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm" placeholder="What is this plan for?" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] font-semibold text-ink3">Level</span>
                <select value={form.level} onChange={e=> setForm(f=> ({...f, level:e.target.value}))} className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm">
                  {LEVELS.map(l=> <option key={l}>{l}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-ink3">Goal</span>
                <select value={form.goal} onChange={e=> setForm(f=> ({...f, goal:e.target.value}))} className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm">
                  {GOALS.map(g=> <option key={g.id} value={g.id}>{g.label}</option>)}
                </select>
              </label>
            </div>
            {form.days.map((day, di)=> (
              <div key={di} className="rounded-2xl border border-line bg-surface2 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input value={day.title} onChange={e=> setDay(di, { title: e.target.value })} placeholder={`Day ${di+1} title`} aria-label={`Day ${di+1} title`} className="flex-1 min-w-0 rounded-lg border border-line bg-surface px-2.5 py-2 text-xs font-bold" />
                  {form.days.length > 1 && <button onClick={()=> removeDay(di)} aria-label={`Remove day ${di+1}`} className="w-9 h-9 grid place-items-center rounded-full border border-line text-ink3">×</button>}
                </div>
                {day.exercises.map((exRow, ei)=> (
                  <div key={ei} className="grid grid-cols-[minmax(0,1fr)_56px_minmax(64px,88px)_36px] gap-1.5 items-center">
                    <select value={exRow.exerciseId} onChange={e=> setExercise(di, ei, { exerciseId: e.target.value })} aria-label={`Day ${di+1} exercise ${ei+1}`} className="min-w-0 rounded-lg border border-line bg-surface px-2 py-2 text-xs">
                      <option value="">Pick an exercise…</option>
                      {EXERCISES.map(ex=> <option key={ex.id} value={ex.id}>{ex.name}</option>)}
                    </select>
                    <input type="number" min="1" max="10" inputMode="numeric" value={exRow.sets} onChange={e=> setExercise(di, ei, { sets: e.target.value })} aria-label={`Day ${di+1} exercise ${ei+1} sets`} className="rounded-lg border border-line bg-surface px-2 py-2 text-xs tabular-nums" />
                    <input value={exRow.reps} onChange={e=> setExercise(di, ei, { reps: e.target.value })} aria-label={`Day ${di+1} exercise ${ei+1} reps`} placeholder="8–12" className="min-w-0 rounded-lg border border-line bg-surface px-2 py-2 text-xs" />
                    <button onClick={()=> removeExerciseRow(di, ei)} aria-label={`Remove exercise ${ei+1} of day ${di+1}`} className="w-8 h-8 grid place-items-center rounded-full border border-line text-ink3">×</button>
                  </div>
                ))}
                <button onClick={()=> addExerciseRow(di)} className="text-[11px] font-bold underline underline-offset-2">+ exercise</button>
              </div>
            ))}
            <div className="flex gap-2">
              <button onClick={addDay} disabled={form.days.length >= 6} className="btn btn-secondary flex-1 min-h-10 rounded-xl disabled:opacity-40">+ Add day</button>
              <button onClick={saveBuilder} className="btn btn-primary flex-1 min-h-10 rounded-xl">{editingId ? 'Save changes' : 'Create template'}</button>
            </div>
            <p className="text-[11px] text-ink3">One-week blueprint — scheduling repeats it weekly with a 4-week mesocycle and honest kit swaps. Templates live on this device and ride along in backups.</p>
          </div>
        </div>
      )}

      {program && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold">Preview — {program.name} <span className="text-xs text-ink3">v{program.version||1}</span></h3>
          <details className="text-xs rounded-xl border border-line bg-surface2 px-3 py-2">
            <summary className="font-semibold cursor-pointer">Version history</summary>
            <ul className="mt-2 space-y-1">
              {programVersionHistory(program.id).map(h=> <li key={h.version}><span className="font-bold">v{h.version}</span> {h.date} — {h.changes}</li>)}
            </ul>
          </details>
          {program.weeks.map(wk=> (
            <div key={wk.week} className="rounded-2xl border border-line bg-surface overflow-hidden">
              <div className="px-4 py-2 bg-surface2 border-b border-line flex items-center justify-between">
                <span className="text-xs font-bold">Week {wk.week}</span>
                <span className="text-[11px] text-ink3">{wk.workouts.length} sessions</span>
              </div>
              <div className="divide-y divide-line">
                {wk.workouts.map(w=> (
                  <div key={w.day} className="px-4 py-3">
                    <p className="text-sm font-bold">Day {w.day} — {w.title}</p>
                    <ul className="mt-2 space-y-1.5">
                      {w.blocks.map((b,i)=>{
                        const ex = EXERCISE_BY_ID[b.exerciseId];
                        return <li key={i} className="flex gap-2 text-sm"><span className="text-ink3 tabular-nums w-14 shrink-0">{b.sets}× {b.reps}</span><span className="font-medium">{ex?.name || b.exerciseId}</span><span className="ml-auto text-xs text-ink3 hidden sm:inline">{b.restSec ? `${b.restSec}s rest` : ''} {b.loadHint?`• ${b.loadHint}`:''}</span></li>
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {active && (
        <div className="rounded-2xl border border-line bg-surface p-4 space-y-2">
          <h3 className="text-sm font-bold">Your schedule</h3>
          <p className="text-xs text-ink3">Start: {active.startDateISO} • {active.sessions.length} sessions • {adherence?.completed || 0} completed • {adherence?.missed || 0} missed</p>
          <ul className="space-y-1.5 max-h-72 overflow-auto pr-1">
            {pvc.map(({ session, completed, delta, actual })=> (
              <li key={session.id} className="flex items-center gap-2 text-sm border border-line rounded-xl px-3 py-2 bg-surface2">
                <span className="text-xs font-mono tabular-nums text-ink3 w-24 shrink-0">{session.dateISO}</span>
                <span className="font-medium truncate">{session.title}</span>
                <span className={`ml-auto text-[11px] font-bold px-2 py-1 rounded-full border ${completed ? 'bg-success text-bg border-success' : 'bg-surface border-line text-ink3'}`}>{completed?'done':'planned'}</span>
                {completed && delta && <span className="text-[11px] text-ink3">{delta.sets>=0?'+':''}{delta.sets} sets{delta.volumeKg!=null ? ` • ${delta.volumeKg>=0?'+':''}${delta.volumeKg}kg vs plan` : ''}</span>}
                {!completed && <button onClick={()=> onStartSession(session)} className="text-xs font-bold text-ink underline">Start</button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!userHistory.length && (
        <section className="rounded-2xl border border-line bg-surface p-4 space-y-2">
          <h3 className="text-sm font-bold">Your programme history</h3>
          <p className="text-xs text-ink3">Starts and completions are kept separately from the built-in programme version changelog.</p>
          <ul className="space-y-1.5">
            {userHistory.slice(0, 8).map((entry, index)=> (
              <li key={`${entry.programId}-${entry.startDateISO}-${index}`} className="flex items-center gap-2 text-xs border border-line rounded-xl px-3 py-2 bg-surface2">
                <span className="font-bold">{PROGRAM_BY_ID[entry.programId]?.name || entry.programId}</span>
                <span className="text-ink3">v{entry.version} • {entry.startDateISO}</span>
                <span className={`ml-auto font-bold ${entry.active ? 'text-success' : 'text-ink3'}`}>{entry.active ? 'active' : entry.status} • {entry.completedSessions} logged</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
