import { useEffect, useRef, useState } from 'react';
import { EQUIPMENT, LOCATIONS, GOALS, LEVELS, EXERCISES, exerciseAvailable } from '../lib/data.js';
import { DEFAULT_PLATE_DENOMINATIONS_KG } from '../lib/plates.js';

export default function Onboarding({ open, onClose, onComplete, initial }){
  const [step,setStep]=useState(0);
  const [goal,setGoal]=useState(initial?.goal || 'general');
  const [equipment,setEquipment]=useState(initial?.equipment || ['bodyweight']);
  const [location,setLocation]=useState(initial?.location || 'home');
  const [level,setLevel]=useState(initial?.level || 'Beginner');
  const [days,setDays]=useState(initial?.daysPerWeek || 3);
  const [minutes,setMinutes]=useState(initial?.availableMinutes || 45);
  const [preferredExerciseIds,setPreferredExerciseIds]=useState(initial?.preferredExerciseIds || []);
  const [dislikedExerciseIds,setDislikedExerciseIds]=useState(initial?.dislikedExerciseIds || []);
  const [barWeightKg,setBarWeightKg]=useState(initial?.plateConfig?.barWeightKg ?? 20);
  const [plateDenominationsKg,setPlateDenominationsKg]=useState(initial?.plateConfig?.platesKg || DEFAULT_PLATE_DENOMINATIONS_KG);
  const dialogRef = useRef(null);

  useEffect(()=>{
    if(!open) return;
    setStep(0);
    setGoal(initial?.goal || 'general');
    setEquipment(initial?.equipment || ['bodyweight']);
    setLocation(initial?.location || 'home');
    setLevel(initial?.level || 'Beginner');
    setDays(initial?.daysPerWeek || 3);
    setMinutes(initial?.availableMinutes || 45);
    setPreferredExerciseIds(initial?.preferredExerciseIds || []);
    setDislikedExerciseIds(initial?.dislikedExerciseIds || []);
    setBarWeightKg(initial?.plateConfig?.barWeightKg ?? 20);
    setPlateDenominationsKg(initial?.plateConfig?.platesKg || DEFAULT_PLATE_DENOMINATIONS_KG);
    const onKey = (e)=>{ if(e.key==='Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // focus close button for keyboard users
    requestAnimationFrame(()=> dialogRef.current?.querySelector('button[aria-label="Close"]')?.focus());
    return ()=> window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if(!open) return null;

  const toggleEq = (id)=>{
    setEquipment(prev=> prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  };

  const togglePreference = (id, kind)=>{
    if(kind==='preferred'){
      setPreferredExerciseIds(prev=> prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
      setDislikedExerciseIds(prev=> prev.filter(x=>x!==id));
    } else {
      setDislikedExerciseIds(prev=> prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
      setPreferredExerciseIds(prev=> prev.filter(x=>x!==id));
    }
  };

  const togglePlate = (kg)=>{
    setPlateDenominationsKg(prev=> prev.includes(kg) ? prev.filter(value=> value!==kg) : [...prev, kg].sort((a, b)=> a - b));
  };

  const preferenceKit = [...new Set([...(equipment.length ? equipment : ['bodyweight']), 'bodyweight'])];
  const preferenceExercises = EXERCISES.filter(ex=> exerciseAvailable(ex.id, preferenceKit));

  const complete = ()=>{
    const payload = {
      goal,
      equipment: equipment.length ? equipment : ['bodyweight'],
      location,
      level,
      daysPerWeek: days,
      availableMinutes: Math.max(10, Number(minutes) || 45),
      preferredExerciseIds,
      dislikedExerciseIds,
      plateConfig: equipment.includes('barbell') ? { barWeightKg: Number(barWeightKg) || 0, platesKg: plateDenominationsKg } : null,
    };
    onComplete(payload);
    onClose();
  };

  const steps = [
    {
      title: 'What’s the goal?',
      body: (
        <div className="grid gap-2">
          {GOALS.map(g=> (
            <button key={g.id} onClick={()=> setGoal(g.id)} className={`text-left rounded-2xl border p-4 ${goal===g.id ? 'bg-ink text-bg border-ink' : 'bg-surface border-line hover:border-ink3'}`}>
              <span className="block font-bold">{g.label}</span><span className={`block text-xs ${goal===g.id ? 'text-bg/80' : 'text-ink3'}`}>{g.hint}</span>
            </button>
          ))}
        </div>
      )
    },
    {
      title: 'Where will you train?',
      body: (
        <div className="grid gap-2">
          {LOCATIONS.map(l=> (
            <button key={l.id} onClick={()=> setLocation(l.id)} className={`text-left rounded-2xl border p-4 ${location===l.id ? 'bg-ink text-bg border-ink' : 'bg-surface border-line hover:border-ink3'}`}>
              <span className="block font-bold">{l.label}</span><span className={`block text-xs ${location===l.id ? 'text-bg/80' : 'text-ink3'}`}>{l.hint}</span>
            </button>
          ))}
        </div>
      )
    },
    {
      title: 'What kit do you have?',
      body: (
        <div className="space-y-2">
          <p className="text-xs text-ink3">Pick everything you can use today. We’ll only recommend exercises you can actually do, and surface substitutions otherwise. You can change this anytime in More.</p>
          <div className="grid grid-cols-2 gap-2">
            {EQUIPMENT.map(eq=> (
              <label key={eq.id} className={`flex items-center gap-2 rounded-2xl border p-3 cursor-pointer ${equipment.includes(eq.id) ? 'bg-ink text-bg border-ink' : 'bg-surface border-line'}`}>
                <input type="checkbox" checked={equipment.includes(eq.id)} onChange={()=> toggleEq(eq.id)} className="accent-ink" />
                <span className="text-sm font-semibold"><span aria-hidden>{eq.icon}</span> {eq.label}</span>
              </label>
            ))}
          </div>
          {!equipment.length && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">Pick at least one — bodyweight is always an option.</p>}
          {equipment.includes('barbell') && (
            <div className="rounded-xl border border-line bg-surface2 p-3 space-y-2">
              <div>
                <p className="text-xs font-bold">Barbell load setup</p>
                <p className="text-[11px] text-ink3">Used only to round barbell recommendations to loads you can actually build.</p>
              </div>
              <div className="flex gap-2">
                {[20,15,0].map(weight=> (
                  <button key={weight} onClick={()=> setBarWeightKg(weight)} className={`flex-1 min-h-9 rounded-lg border text-xs font-bold ${barWeightKg===weight ? 'bg-ink text-bg border-ink' : 'bg-surface border-line'}`}>{weight ? `${weight}kg bar` : 'No fixed bar'}</button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {DEFAULT_PLATE_DENOMINATIONS_KG.map(kg=> (
                  <button key={kg} onClick={()=> togglePlate(kg)} aria-pressed={plateDenominationsKg.includes(kg)} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${plateDenominationsKg.includes(kg) ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink3'}`}>{kg}kg</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )
    },
    {
      title: 'Level & schedule',
      body: (
        <div className="space-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-ink3">Your level</p>
            <div className="mt-2 flex gap-2">
              {LEVELS.map(l=> (
                <button key={l} onClick={()=> setLevel(l)} className={`flex-1 min-h-10 rounded-xl border text-sm font-bold ${level===l ? 'bg-ink text-bg border-ink' : 'bg-surface border-line'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-ink3">Days per week</p>
            <div className="mt-2 flex gap-2">
              {[2,3,4,5].map(n=> (
                <button key={n} onClick={()=> setDays(n)} className={`flex-1 min-h-10 rounded-xl border text-sm font-bold ${days===n ? 'bg-ink text-bg border-ink' : 'bg-surface border-line'}`}>{n}×</button>
              ))}
            </div>
            <p className="text-xs text-ink3 mt-2">Used to rank programs. Your schedule still follows the program you pick in Train.</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-ink3">Time per session</p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {[20,30,45,60].map(n=> (
                <button key={n} onClick={()=> setMinutes(n)} className={`min-h-10 rounded-xl border text-sm font-bold ${minutes===n ? 'bg-ink text-bg border-ink' : 'bg-surface border-line'}`}>{n} min</button>
              ))}
            </div>
            <p className="text-xs text-ink3 mt-2">Shorter caps preserve the highest-value blocks and reduce sets when needed.</p>
          </div>
          <div className="rounded-xl border border-line bg-surface2 p-3 text-xs">
            <p className="font-bold">How this affects recommendations</p>
            <ul className="list-disc pl-5 mt-1 text-ink3 space-y-1">
              <li>Exercises needing kit you don’t have are hidden when “Only my kit” is on.</li>
              <li>Programs that need missing kit show an amber “Needs…” badge and sit lower in the list.</li>
              <li>Location biases conditioning picks (outdoor → runs/walks, small space → bodyweight circuits).</li>
            </ul>
          </div>
        </div>
      )
    },
    {
      title: 'Preferences (optional)',
      body: (
        <div className="space-y-3">
          <p className="text-xs text-ink3">Tell us which movements you like or want to avoid. These choices only influence generated programmes; they never erase logged history.</p>
          <div className="flex gap-2 text-[11px] text-ink3">
            <span className="rounded-full border border-success/40 bg-success/10 px-2 py-1">Like = prefer when substituting</span>
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1">Avoid = do not prescribe</span>
          </div>
          <div className="max-h-72 overflow-auto space-y-1.5 pr-1">
            {preferenceExercises.map(ex=> {
              const liked = preferredExerciseIds.includes(ex.id);
              const avoided = dislikedExerciseIds.includes(ex.id);
              return (
                <div key={ex.id} className="flex items-center gap-2 rounded-xl border border-line bg-surface2 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold truncate">{ex.name}</span>
                    <span className="block text-[11px] text-ink3">{ex.muscle} • {ex.equipment.join(', ')}</span>
                  </span>
                  <button onClick={()=> togglePreference(ex.id, 'preferred')} aria-pressed={liked} className={`rounded-lg border px-2 py-1 text-[11px] font-bold ${liked ? 'bg-success text-white border-success' : 'bg-surface border-line text-ink3'}`}>Like</button>
                  <button onClick={()=> togglePreference(ex.id, 'disliked')} aria-pressed={avoided} className={`rounded-lg border px-2 py-1 text-[11px] font-bold ${avoided ? 'bg-amber-200 text-amber-900 border-amber-300' : 'bg-surface border-line text-ink3'}`}>Avoid</button>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-ink3">{preferredExerciseIds.length} liked • {dislikedExerciseIds.length} avoided. You can change these choices by editing onboarding.</p>
        </div>
      )
    },
  ];

  const cur = steps[step];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Onboarding" onClick={(e)=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="w-full max-w-lg rounded-3xl bg-surface border border-line overflow-hidden max-h-[90dvh] flex flex-col">
        <div className="px-6 pt-6 pb-3 border-b border-line">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-extrabold tracking-tight">{cur.title}</h2>
            <button onClick={onClose} className="w-9 h-9 grid place-items-center rounded-full border border-line bg-surface2" aria-label="Close">✕</button>
          </div>
          <div className="mt-3 flex gap-1.5" aria-hidden>
            {steps.map((_,i)=> <span key={i} className={`h-1.5 flex-1 rounded-full ${i<=step ? 'bg-ink' : 'bg-line'}`} />)}
          </div>
          <p className="text-[11px] text-ink3 mt-2">Step {step+1} of {steps.length}</p>
        </div>
        <div className="flex-1 overflow-auto p-6">{cur.body}</div>
        <div className="p-4 border-t border-line flex gap-2 bg-surface2">
          <button disabled={step===0} onClick={()=> setStep(s=> Math.max(0,s-1))} className="btn btn-secondary flex-1 min-h-11 rounded-xl disabled:opacity-40">Back</button>
          {step < steps.length-1 ? (
            <button onClick={()=> setStep(s=> Math.min(steps.length-1,s+1))} className="btn btn-primary flex-1 min-h-11 rounded-xl">Next</button>
          ) : (
            <button onClick={complete} className="btn btn-primary flex-1 min-h-11 rounded-xl">Save & continue</button>
          )}
        </div>
      </div>
    </div>
  );
}
