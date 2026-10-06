import { useMemo, useState } from 'react';
import { whatChangedSummary } from '../lib/product.js';
import { confidenceLanguage } from '../lib/performance.js';

// WhatChangedPanel — the single "why did training change?" surface, shared by
// Today, the workout runner, Weekly Review and Progress. It never asks the
// user to reverse-engineer the progression engine: each change names what
// moved, why, and how confident the engine is. Pure presentation over the
// records the app already stores (schedule.lastAdaptation, session
// adaptationBasis) — it never invents a reason.
export default function WhatChangedPanel({ schedule, history = [], compact = false }){
  // In compact mode the panel sits inside an already-collapsed disclosure, so
  // its rows must be one tap deep — no second toggle inside a toggle.
  const [open, setOpen] = useState(compact === true);
  const changes = useMemo(()=> whatChangedSummary({ schedule, history }), [schedule, history]);
  const adaptations = schedule?.lastAdaptation?.changes || [];
  if(!changes.length && !adaptations.length) return null;

  const rows = adaptations.length ? adaptations.map((change)=> ({
    exercise: change.exerciseId,
    detail: change.reason,
    confidence: change.confidence || null,
    when: schedule.lastAdaptation?.dateISO || null,
  })) : changes.flatMap((c)=> c.lines.map((line)=> ({ exercise: null, detail: line, confidence: null, when: c.when })));

  return (
    <div className={`rounded-2xl border border-line bg-surface ${compact ? 'px-3 py-2' : 'p-4 space-y-2'}`} role="region" aria-label="What changed">
      <button onClick={()=> setOpen((v)=> !v)} aria-expanded={open} className="w-full flex items-baseline gap-2 text-left">
        <span className="text-[11px] font-bold uppercase tracking-widest text-ink3">What changed</span>
        <span className="ml-auto text-[11px] text-ink3">{open ? 'Hide' : `${rows.length} change${rows.length === 1 ? '' : 's'}`}</span>
      </button>
      {open && (
        <ul className="mt-1 space-y-2">
          {rows.map((row, i)=> (
            <li key={i} className="text-[11px]">
              {row.exercise && <span className="font-bold text-ink">{row.exercise}</span>}
              <span className={row.exercise ? ' block text-ink3' : 'text-ink3'}>{row.detail}</span>
              {row.confidence && <span className="block text-ink3">{confidenceLanguage(row.confidence)}</span>}
              {row.when && <span className="block text-[10px] text-ink3">{row.when}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
