// TrainingProfileCard.jsx — the personal training model, made inspectable.
//
// Renders buildTrainingProfile()'s rows with ACTION → RESULT → REASON →
// DETAIL hierarchy: value first, one line of context second, the evidence
// and source behind it one tap deeper. Rows that say "how to correct this"
// get an edit affordance pointing at the existing editor — the model is a
// view over inputs the user already owns, never a black box.

import { useMemo } from 'react';
import { buildTrainingProfile } from '../lib/coach/trainingProfile.js';

const CONF_BADGE = {
  high: 'border-success/50 text-success',
  medium: 'border-line text-ink3',
  low: 'border-review/40 text-review',
};

export default function TrainingProfileCard({ store }){
  const profile = useMemo(()=> buildTrainingProfile({ store }), [store]);
  if(!profile.rows.length) return null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4" aria-label="Your training model">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-bold">Your training model</h3>
        <span className="ml-auto text-[11px] text-ink3">private · on this device</span>
      </div>
      <p className="text-[11px] text-ink3 mt-1">{profile.summary}</p>

      <ul className="mt-2 space-y-1.5">
        {profile.rows.map(row=> (
          <li key={row.id} className="rounded-xl border border-line bg-surface2 px-3 py-2">
            <details>
              <summary className="cursor-pointer min-h-9 flex items-center gap-2">
                <span className="text-xs font-semibold truncate">{row.label}</span>
                <span className="ml-auto text-xs font-bold tabular-nums shrink-0">{row.value}</span>
                {row.confidence && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${CONF_BADGE[row.confidence] || 'border-line text-ink3'}`}>
                    {row.confidence}
                  </span>
                )}
              </summary>
              <div className="mt-1 space-y-1">
                <p className="text-[11px] text-ink2 leading-snug">{row.detail}</p>
                {row.evidence.length > 0 && (
                  <ul className="space-y-0.5">
                    {row.evidence.map((line, i)=> (
                      <li key={i} className="text-[10px] text-ink3 leading-snug">• {line}</li>
                    ))}
                  </ul>
                )}
                <p className="text-[10px] text-ink3"><span className="font-semibold text-ink2">Source:</span> <code>{row.source}</code></p>
                {row.editableVia && (
                  <p className="text-[10px] text-ink3">
                    <span className="font-semibold text-ink2">{row.editableVia.label}.</span> {row.editableVia.hint}
                  </p>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
