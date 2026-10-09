// WhyExplainer.jsx — the single "Why?" affordance for adaptive decisions.
//
// One decision, progressively disclosed — never duplicated into separate
// systems (P1.3):
//
//   simple    the reason in one plain sentence (shown when collapsed is open
//             or when the caller renders `item.reason` alongside).
//   standard  what changed (previousState), what to expect (expectedOutcome),
//             the engine's own evidence lines, and honest confidence language.
//   expert    the structured inputs, the policy name and the source engine —
//             nested behind "Show the working" so audit is always one tap
//             away without cluttering the default view.
//
// Presentation only: every string it shows was produced by a deterministic
// engine and handed to it — this component never invents, rewords engine
// reasons, or computes anything of its own.

import { confidenceLanguage } from '../lib/performance.js';

/**
 * @param item  { action?, reason?, confidence?, previousState?, expectedOutcome?,
 *                evidence?: string[], rule?, expert?: { inputs?: [{label,value}], policy?, source? } }
 * @param label summary text for the disclosure trigger.
 * @param defaultOpen start expanded (used when the item sits in an
 *        already-scoped panel where the reason IS the point).
 * @param showAction render `action` as the lead line (recommendation first,
 *        reason second — the ACTION → RESULT → REASON hierarchy).
 */
export default function WhyExplainer({ item, label = 'Why?', defaultOpen = false, showAction = false }){
  if(!item) return null;
  const hasBody = item.reason || item.previousState || item.expectedOutcome
    || (item.evidence && item.evidence.length) || item.rule || item.confidence;
  if(!hasBody && !item.expert) return null;

  return (
    <details open={defaultOpen} className="rounded-xl border border-line bg-surface2/60 px-3 py-2">
      <summary className="text-[11px] font-bold cursor-pointer text-ink2 select-none min-h-8 flex items-center gap-1.5">
        <span aria-hidden className="text-ink3">?</span>
        {label}
        {item.confidence && (
          <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
            item.confidence === 'high' ? 'border-success/50 text-success'
              : item.confidence === 'medium' ? 'border-line text-ink3'
              : 'border-review/40 text-review'
          }`}>{item.confidence}</span>
        )}
      </summary>

      <div className="mt-1.5 space-y-1.5">
        {showAction && item.action && (
          <p className="text-xs font-bold text-ink">{item.action}</p>
        )}
        {item.reason && <p className="text-[11px] text-ink2 leading-snug">{item.reason}</p>}
        {item.previousState && (
          <p className="text-[11px] text-ink3 leading-snug">
            <span className="font-semibold text-ink2">Before:</span> {item.previousState}
          </p>
        )}
        {item.expectedOutcome && (
          <p className="text-[11px] text-ink3 leading-snug">
            <span className="font-semibold text-ink2">What to expect:</span> {item.expectedOutcome}
          </p>
        )}
        {item.rule && <p className="text-[11px] text-ink3 leading-snug">{item.rule}</p>}
        {item.confidence && (
          <p className="text-[11px] text-ink3 leading-snug">{confidenceLanguage(item.confidence)}</p>
        )}
        {item.evidence && item.evidence.length > 0 && (
          <ul className="space-y-0.5 pt-0.5 border-t border-line/60">
            {item.evidence.map((line, i) => (
              <li key={i} className="text-[10px] text-ink3 leading-snug">• {line}</li>
            ))}
          </ul>
        )}

        {/* Expert level: structured inputs, policy, source — always available,
            never in the way. Nothing here is hidden from simple users who tap
            through; it is disclosure, not removal. */}
        {item.expert && (
          <details className="pt-1 border-t border-line/60">
            <summary className="text-[10px] font-bold uppercase tracking-widest text-ink3 cursor-pointer min-h-7 flex items-center">Show the working</summary>
            <div className="mt-1 space-y-1">
              {(item.expert.inputs || []).length > 0 && (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-[10px]">
                  {item.expert.inputs.map((row, i) => (
                    <span key={i} className="contents">
                      <dt className="text-ink3 font-semibold whitespace-nowrap">{row.label}</dt>
                      <dd className="text-ink2 tabular-nums break-words">{String(row.value)}</dd>
                    </span>
                  ))}
                </dl>
              )}
              {item.expert.policy && (
                <p className="text-[10px] text-ink3"><span className="font-semibold text-ink2">Policy:</span> {item.expert.policy}</p>
              )}
              {item.expert.source && (
                <p className="text-[10px] text-ink3"><span className="font-semibold text-ink2">Source:</span> <code className="text-[10px]">{item.expert.source}</code></p>
              )}
            </div>
          </details>
        )}
      </div>
    </details>
  );
}
