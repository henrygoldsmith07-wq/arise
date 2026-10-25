import { useMemo } from 'react';
import JargonHelp from './JargonHelp.jsx';
import { exerciseSessionHistory, sparklinePoints } from '../lib/exerciseHistory.js';
import { useDialogA11y } from '../lib/a11y.js';
import { fmtWeight } from '../lib/units.ts';

// Last five exposures of the current lift, with a best-e1RM sparkline.
export default function ExerciseHistorySheet({ exerciseId, name, history, unit = 'kg', onClose }){
  const a11y = useDialogA11y({ active: true, onClose });
  const sessions = useMemo(()=> exerciseSessionHistory(history, exerciseId, 5), [history, exerciseId]);
  const points = sparklinePoints(sessions);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div ref={a11y.rootRef} onKeyDown={a11y.trapTab} role="dialog" aria-modal="true" aria-label={`${name} history`}
        onClick={e=> e.stopPropagation()} className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-ink">{name}: last {sessions.length || 5} sessions</h2>
          <button ref={a11y.closeRef} type="button" onClick={onClose} className="min-h-11 min-w-11 text-xs font-bold px-3 rounded-full border border-line">Close</button>
        </div>
        {sessions.length === 0 && <p className="text-xs text-ink3">Nothing logged for this lift yet. Your first session becomes the baseline.</p>}
        {points && (
          <div>
            <svg viewBox="0 0 120 32" role="img" aria-label="Estimated 1-rep max trend, oldest to newest" className="w-full h-10 text-ink">
              <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            <p className="text-[11px] text-ink3">Best estimated 1RM per session, oldest to newest. An estimate from your sets, not a test.</p>
          </div>
        )}
        <ul className="space-y-2">
          {sessions.map((s, i)=> (
            <li key={`${s.dateISO}-${i}`} className="rounded-xl border border-line bg-surface2 p-2.5 text-xs">
              <p className="font-bold text-ink">{s.dateISO}{s.bestE1rm ? <span className="font-normal text-ink3"> · e1RM {fmtWeight(s.bestE1rm, unit)}<JargonHelp term="e1RM"/></span> : null}</p>
              <p className="text-ink2 tabular-nums">{s.sets.map(x=> `${x.weightKg ? `${fmtWeight(x.weightKg, unit)} × ` : ''}${x.reps}${x.rir != null ? ` @${x.rir}RIR` : ''}`).join(' · ')}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
