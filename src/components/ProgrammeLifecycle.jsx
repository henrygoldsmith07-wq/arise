// ProgrammeLifecycle.jsx — programmes as adaptive objects, made legible.
//
// The loop the app actually runs:  START → TRAIN → ADAPT → REVIEW →
// COMPLETE → NEXT BLOCK (→ TRAIN …). Each stage's status is derived from
// records the store already keeps (schedule.startDateISO, progress(),
// schedule.lastAdaptation, store.lastWeeklyReviewAck, upcoming sessions) —
// this component narrates them; it never decides anything.
//
// Purpose (P2.6): a user should understand what the original plan was, what
// changed, why it changed, how their own behaviour shaped it, and what the
// next block focuses on — without reconstructing it across screens.

import { useMemo, useState } from 'react';
import { PROGRAM_BY_ID } from '../lib/data.js';
import { progress } from '../lib/schedule.js';
import { programAdherence, isoToday } from '../lib/programming.js';
import { weekPhaseFor } from '../lib/mesocycle.js';
import WhatChangedPanel from './WhatChangedPanel.jsx';

export default function ProgrammeLifecycle({ schedule, history = [], lastReviewAck = null }){
  const [open, setOpen] = useState(false);
  const data = useMemo(()=>{
    if(!schedule) return null;
    const prog = PROGRAM_BY_ID[schedule.programId] || null;
    const progProgress = progress(schedule, history);
    const adherence = programAdherence(schedule, history, { today: isoToday() });
    const adaptation = schedule.lastAdaptation || null;
    const reviewed = Boolean(lastReviewAck);
    const complete = progProgress.pct >= 100;
    const weekPhase = weekPhaseFor(schedule, isoToday());
    const upcoming = (schedule.sessions || []).filter(s => s.status !== 'done').slice(0, 3);

    const stages = [
      { id: 'start', label: 'Start', done: true, meta: schedule.startDateISO || null },
      { id: 'train', label: 'Train', done: progProgress.done > 0, meta: `${progProgress.done}/${progProgress.total} sessions` },
      { id: 'adapt', label: 'Adapt', done: !!adaptation, meta: adaptation ? `${adaptation.changes?.length || 0} change${(adaptation.changes?.length || 0) === 1 ? '' : 's'} · ${adaptation.dateISO || ''}` : 'no adjustments yet' },
      { id: 'review', label: 'Review', done: reviewed, meta: reviewed ? 'latest week reviewed' : 'waiting for your first weekly review' },
      { id: 'complete', label: 'Complete', done: complete, meta: `${progProgress.pct}% of the programme` },
      { id: 'next', label: 'Next block', done: false, meta: upcoming[0] ? `${upcoming[0].title}${upcoming[0].dateISO ? ` · ${upcoming[0].dateISO}` : ''}` : 'finished — pick what’s next' },
    ];
    // "Currently" = the first stage not yet satisfied, walked in loop order.
    const currentId = complete ? 'complete' : (stages.find(s => !s.done && s.id !== 'next')?.id || 'next');

    return {
      prog, progProgress, adherence, adaptation, weekPhase, upcoming, stages, currentId,
      // How the user's own behaviour shaped the plan: overdue sessions are
      // the input replan/skip decisions act on; this states it without blame.
      behaviour: adherence.missed > 0
        ? `${adherence.missed} missed session${adherence.missed === 1 ? '' : 's'} so far — handled explicitly (replan or skip), never silently.`
        : adherence.toDateRate != null
          ? `${Math.round(adherence.toDateRate * 100)}% of due sessions done — the plan is tracking as written.`
          : 'No sessions due yet — the plan starts on its first date.',
    };
  }, [schedule, history, lastReviewAck]);

  if(!data) return null;
  const { stages, currentId, prog, adaptation, weekPhase, upcoming, behaviour } = data;

  return (
    <div className="rounded-xl border border-line bg-surface2 p-3" role="region" aria-label="Programme lifecycle">
      <button onClick={()=> setOpen(o=> !o)} aria-expanded={open} className="w-full flex items-baseline gap-2 text-left min-h-8">
        <span className="text-[11px] font-bold uppercase tracking-widest text-ink3">Programme lifecycle</span>
        <span className="ml-auto text-[11px] text-ink3">{open ? 'Hide' : 'Where am I?'}</span>
      </button>

      {/* The loop itself: one row of chips, current stage emphasised. */}
      <ol className="mt-2 flex flex-wrap gap-1" aria-label="Programme stages">
        {stages.map((stage, i)=> (
          <li key={stage.id} className="flex items-center gap-1">
            <span
              title={stage.meta || stage.label}
              className={`text-[10px] font-bold px-2 py-1 rounded-full border whitespace-nowrap ${
                stage.id === currentId
                  ? 'bg-ink text-bg border-ink'
                  : stage.done
                    ? 'bg-surface border-line text-ink2'
                    : 'bg-surface border-line text-ink3 opacity-70'
              }`}
            >
              {stage.done && stage.id !== currentId ? '✓ ' : ''}{stage.label}
            </span>
            {i < stages.length - 1 && <span aria-hidden className="text-[9px] text-ink3">→</span>}
          </li>
        ))}
      </ol>

      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-ink2 leading-snug">
            <span className="font-semibold text-ink">Original plan:</span>{' '}
            {prog ? `${prog.name}${prog.tagline ? ` — ${prog.tagline}` : ''}` : 'this programme'}{prog?.weeks?.length ? ` · ${prog.weeks.length} week${prog.weeks.length === 1 ? '' : 's'}` : ''}.
          </p>
          <p className="text-[11px] text-ink2 leading-snug">
            <span className="font-semibold text-ink">How you’ve shaped it:</span> {behaviour}
          </p>
          <p className="text-[11px] text-ink2 leading-snug">
            <span className="font-semibold text-ink">What changed:</span>{' '}
            {adaptation
              ? `${adaptation.changes?.length || 0} adjustment${(adaptation.changes?.length || 0) === 1 ? '' : 's'}${adaptation.dateISO ? ` on ${adaptation.dateISO}` : ''} — each with its reason below.`
              : 'Nothing yet — the schedule still matches the programme as generated.'}
            {weekPhase?.kind === 'deload' ? ' This week is a planned deload.' : weekPhase?.kind === 'recovery' ? ' This week is a planned recovery week.' : ''}
          </p>
          <p className="text-[11px] text-ink2 leading-snug">
            <span className="font-semibold text-ink">Next up:</span>{' '}
            {upcoming.length
              ? upcoming.map(s => `${s.title}${s.dateISO ? ` (${s.dateISO})` : ''}`).join(' · ')
              : 'No sessions left — completion. Choose what’s next in Train.'}
          </p>
          {/* The audit trail itself: same shared panel as Today. */}
          <WhatChangedPanel schedule={schedule} history={history} compact />
        </div>
      )}
    </div>
  );
}
