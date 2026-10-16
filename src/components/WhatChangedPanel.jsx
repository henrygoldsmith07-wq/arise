import { useMemo } from 'react';
import { whatChangedSummary } from '../lib/product.js';
import { confidenceLanguage } from '../lib/performance.js';

// WhatChangedPanel — the single "why did training change?" surface, shared by
// Today, the workout runner, Weekly Review and Progress. It never asks the
// user to reverse-engineer the progression engine: each change names what
// moved, why, and how confident the engine is. Pure presentation over the
// records the app already stores (schedule.lastAdaptation, session
// adaptationBasis) — it never invents a reason. Changes are visible without
// expanding a disclosure: the region renders rows directly (compact mode caps
// height with scroll, never a toggle), keyboard reachable, announced via the
// existing live region.
export default function WhatChangedPanel({ schedule, history = [], compact = false }){
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
      <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">What changed <span className="normal-case font-semibold">· {rows.length} change{rows.length === 1 ? '' : 's'} since last session</span></p>
      <ul className={`mt-1 space-y-2 ${compact ? 'max-h-48 overflow-auto' : ''}`} aria-live="polite">
        {rows.map((row, i)=> (
          <li key={i} className="text-[11px]">
            {row.exercise && <span className="font-bold text-ink">{row.exercise}</span>}
            <span className={row.exercise ? ' block text-ink3' : 'text-ink3'}>{row.detail}</span>
            {row.confidence && <span className="block text-ink3">{confidenceLanguage(row.confidence)}</span>}
            {row.when && <span className="block text-[10px] text-ink3">{row.when}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
