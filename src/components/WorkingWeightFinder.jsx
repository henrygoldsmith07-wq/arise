import { useState } from 'react';
import { suggestWorkingLoad } from '../lib/workingWeight.js';
import { equipmentForExercise } from '../lib/progression.js';
import { fmtWeight, weightInputToKg } from '../lib/units.ts';

// First-session helper: one easy trial set → a starting load for every set.
export default function WorkingWeightFinder({ exerciseId, targetReps, unit = 'kg', plateConfig = null, onUse }){
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState('');
  const [reps, setReps] = useState('');
  const [rir, setRir] = useState('');
  const [result, setResult] = useState(null);
  const field = 'min-h-11 w-full rounded-lg border border-line bg-surface px-2 text-sm tabular-nums';
  const run = ()=> setResult(suggestWorkingLoad({
    loadKg: Number(weightInputToKg(load, unit)), reps: Number(reps), rir: rir === '' ? null : Number(rir),
    targetReps, equipment: equipmentForExercise(exerciseId), config: plateConfig,
  }));
  if(!open) return (
    <button type="button" onClick={()=> setOpen(true)} className="min-h-11 text-xs font-bold px-3 py-1.5 rounded-full border border-line bg-surface2 self-start">Not sure what weight? Find it</button>
  );
  return (
    <div role="group" aria-label="Find your starting weight" className="rounded-xl border border-line bg-surface2 p-2.5 space-y-2 text-[11px] text-ink3">
      <p className="text-xs font-bold text-ink">Find your starting weight</p>
      <p>Do one easy set at a weight you could lift for 10+ reps, then tell me how it went. This is an estimate, not a test.</p>
      <div className="grid grid-cols-3 gap-2">
        <label className="space-y-0.5"><span>Weight ({unit})</span><input inputMode="decimal" aria-label="Trial weight" value={load} onChange={e=> setLoad(e.target.value)} className={field} /></label>
        <label className="space-y-0.5"><span>Reps done</span><input inputMode="numeric" aria-label="Trial reps" value={reps} onChange={e=> setReps(e.target.value)} className={field} /></label>
        <label className="space-y-0.5"><span>Left in tank</span><input inputMode="numeric" aria-label="Reps in reserve" placeholder="reps" value={rir} onChange={e=> setRir(e.target.value)} className={field} /></label>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={run} className="min-h-11 text-xs font-bold px-3 rounded-full bg-ink text-bg">Suggest a weight</button>
        <button type="button" onClick={()=> { setOpen(false); setResult(null); }} className="min-h-11 text-xs px-3 underline">Close</button>
      </div>
      {result && (
        <p role="status" className="text-ink2 leading-snug">
          {result.ok ? <>
            Start at <strong>{fmtWeight(result.loadKg, unit)}</strong> for {result.reps}+ reps. {result.note}{' '}
            <button type="button" onClick={()=> { onUse(String(result.loadKg)); setOpen(false); }} className="min-h-11 font-bold underline">Use for all sets</button>
          </> : result.reason}
        </p>
      )}
    </div>
  );
}
