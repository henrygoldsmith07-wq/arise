// TeachingPanel.jsx — the exercise teaching layer, rendered wherever an
// exercise appears. Sections come from exerciseTeaching (library-derived +
// curated core-lift content): setup, execution, breathing/bracing, common
// mistakes, regressions & progressions, equipment variations, one safety
// cue. Practical coaching language only.
import { useState } from 'react';
import { teachingFor } from '../lib/exerciseTeaching.js';
import { useDialogA11y } from '../lib/a11y.js';
import ExerciseIllustration from './ExerciseIllustration.jsx';

export default function TeachingPanel({ exerciseId, variant = 'dialog' }){
  const [open, setOpen] = useState(false);
  const a11y = useDialogA11y({ active: open && variant !== 'inline' });
  const t = teachingFor(exerciseId);
  if(!t) return null;
  const trigger = (
    <button
      onClick={()=> setOpen(v=> !v)}
      aria-expanded={open}
      aria-label={`${open ? 'Hide how to do it' : 'Show how to do it'} for ${t.name}`}
      title={open ? 'Hide how-to guide' : 'Show how-to guide'}
      className={`relative text-[11px] font-bold px-2.5 py-1 rounded-full border ${open ? 'bg-ink text-bg border-ink' : 'border-line bg-surface2 text-ink2'}`}
    >
      {open ? 'How-to ✓' : 'How-to'}
    </button>
  );
  // Compact variant: inline disclosure inside set blocks — never a modal, so
  // logging and focus stay untouched.
  if(variant === 'inline'){
    return (
      <div className="shrink-0">
        {trigger}
        {open && <TeachingBody t={t} />}
      </div>
    );
  }
  if(!open) return trigger;
  return (
    <div ref={a11y.rootRef} onKeyDown={a11y.trapTab} className="fixed inset-0 z-50 bg-black/40 p-4 overflow-auto" role="dialog" aria-modal="true" aria-label={`How to do the ${t.name}`} onClick={()=> setOpen(false)}>
      <div className="max-w-md mx-auto my-6 rounded-3xl bg-surface border border-line p-4 space-y-3" onClick={(e)=> e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <ExerciseIllustration exerciseId={t.id} size="sm" />
          <div className="min-w-0">
            <p className="text-sm font-bold truncate">{t.name}</p>
            <p className="text-[11px] text-ink3">{t.muscle} · {t.level}</p>
          </div>
          <button ref={a11y.closeRef} onClick={()=> setOpen(false)} aria-label="Close how to do it" className="ml-auto w-11 h-11 grid place-items-center rounded-full border border-line">✕</button>
        </div>
        <TeachingBody t={t} bare />
      </div>
    </div>
  );
}

function TeachingBody({ t, bare }){
  const wrap = bare ? 'space-y-3' : 'mt-2 rounded-2xl border border-line bg-surface2 p-3 space-y-3';
  return (
    <div className={wrap}>
      <Section title="Set-up" body={[t.setup]} />
      <Section title="Execution" body={t.execution} />
      <Section title="Breathing & bracing" body={[t.breathing]} />
      {t.mistakes?.length > 0 && <Section title="Common mistakes" body={t.mistakes} />}
      <Section title="Stay in control" body={[t.safety]} />
      {(t.regressions.length > 0 || t.progressions.length > 0) && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">Easier · Harder</p>
          <p className="text-xs text-ink2 mt-1">
            {t.regressions.length > 0 ? <>Easier: {t.regressions.slice(0, 3).map(r=> r.name).join(', ')}.</> : null}
            {t.progressions.length > 0 ? <> {t.progressions.length ? 'Harder:' : ''} {t.progressions.slice(0, 3).map(r=> r.name).join(', ')}.</> : null}
          </p>
        </div>
      )}
      {t.equipmentVariations.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">With other kit</p>
          <p className="text-xs text-ink2 mt-1">{t.equipmentVariations.slice(0, 4).map(v=> v.id === t.id ? null : `${v.name}${v.equipment ? ` (${v.equipment})` : ''}`).filter(Boolean).join(' · ') || '—'}</p>
        </div>
      )}
    </div>
  );
}

function Section({ title, body }){
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">{title}</p>
      <ul className="list-disc pl-5 text-xs text-ink2 mt-1 space-y-1">
        {body.map((line, i)=> <li key={i}>{line}</li>)}
      </ul>
    </div>
  );
}
