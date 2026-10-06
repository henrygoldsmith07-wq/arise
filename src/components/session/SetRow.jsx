// SetRow.jsx — one set row of the standard runner, extracted from
// SessionRunner so the logging row can be worked on (and measured) on its own.
// Presentation only: every mutation is a callback into the runner's state
// machine, and the JSX is byte-for-byte the pre-extraction row — same grid,
// same gestures, same aria labels, same value-free field-commit telemetry.
import { Fragment } from 'react';
import { isSetPerformed } from '../../lib/progression.js';
import { rirFromRpe, rpeFromRir, stepRir } from '../../lib/sessionRunnerModel.js';
import { recordEvent } from '../../lib/telemetry.js';
import { swipeRowHandlers, WeightInput } from '../GymModePanel.jsx';
import StepperButton from '../StepperButton.jsx';

export default function SetRow({
  block,
  blockIndex,
  set,
  setIndex,
  sessionId,
  gymMode = false,
  unit = 'kg',
  supportsWeighted = false,
  rirSuggest = null,
  confirmRirSuggestion,
  updateSet,
  adjustReps,
  completeSet,
  markFailed,
  removeSet,
  openKeypad,
  commitProps,
}){
  const s = set;
  const si = setIndex;
  const bi = blockIndex;
  const b = block;
  const activeSetIdx = b.sets.findIndex(x=> !x.completed);
  const isActive = si === activeSetIdx; // the row being logged now
  // Gym Mode row gestures: right = complete, left = failed,
  // long-press = load keypad. Buttons/inputs stay exclusive.
  const gestures = gymMode && !s.completed ? swipeRowHandlers({
    onComplete: ()=> completeSet(bi,si),
    onFail: ()=> markFailed(bi,si),
    onLongPress: ()=> openKeypad(bi,si),
  }) : null;
  return (
    <Fragment>
    <div {...(gestures ? { onPointerDown:gestures.onPointerDown, onPointerMove:gestures.onPointerMove, onPointerUp:gestures.onPointerUp, onPointerLeave:gestures.onPointerLeave, onPointerCancel:gestures.onPointerCancel } : {})} style={gestures?.style}
      className={`grid grid-cols-[26px_minmax(0,1fr)_minmax(0,1fr)] gap-1 sm:grid-cols-[26px_minmax(0,1fr)_minmax(0,1fr)_64px_42px_auto_26px] sm:gap-1.5 items-center rounded-xl ${s.failed ? 'bg-reviewsoft border border-review/30' : ''}`}>
      <span className={`w-7 h-7 grid place-items-center rounded-full border text-xs font-bold tabular-nums ${s.completed?'bg-success text-bg border-success':s.failed?'bg-review text-bg border-review':'bg-surface2 border-line'}`}>{si+1}</span>
      <div className="min-w-0 flex items-center gap-1">
        <WeightInput type="text" inputMode="decimal" value={s.weightKg} unit={unit} onChange={v=> updateSet(bi,si,{weightKg:v})} {...commitProps('load-field-commit', b.exerciseId, si)} placeholder={supportsWeighted?(unit === 'lb' ? '50' : '22'):'bw'} aria-label={`Load set ${si+1} in ${unit === 'lb' ? 'pounds' : 'kilograms'}`} className={`min-w-0 w-full rounded-xl border border-line bg-surface2 px-2 py-3 text-2xl font-black tabular-nums text-center ${s.completed?'opacity-60':''}`} />
        {supportsWeighted && !s.completed && (
          <button onClick={()=> openKeypad(bi,si)} aria-label={`Open load keypad for set ${si+1}`} title="Load keypad" className="shrink-0 w-11 h-11 grid place-items-center rounded-xl border border-line bg-surface2 text-sm font-black">✛</button>
        )}
      </div>
      {isActive ? (
        <div className="flex items-center gap-1 min-w-0">
          <StepperButton label="−" ariaLabel={`Decrease reps set ${si+1}`} onStep={()=> adjustReps(bi,si,-1)} className="min-w-11 px-0" />
          <input type="number" min="0" step="1" inputMode="numeric" value={s.reps} onChange={e=> updateSet(bi,si,{reps:e.target.value})} {...commitProps('reps-field-commit', b.exerciseId, si)} placeholder="9" aria-label={`Reps set ${si+1}`} className={`min-w-0 flex-1 rounded-xl border border-line bg-surface2 px-1 py-2 text-xl font-black tabular-nums text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${s.completed?'opacity-60':''}`} />
          <StepperButton label="+" ariaLabel={`Increase reps set ${si+1}`} onStep={()=> adjustReps(bi,si,1)} className="min-w-11 px-0" />
        </div>
      ) : (
      <input type="number" min="0" step="1" inputMode="numeric" value={s.reps} onChange={e=> updateSet(bi,si,{reps:e.target.value})} {...commitProps('reps-field-commit', b.exerciseId, si)} placeholder="9" aria-label={`Reps set ${si+1}`} className={`min-w-0 rounded-xl border border-line bg-surface2 px-2 py-3 text-2xl font-black tabular-nums text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${s.completed?'opacity-60':''}`} />
      )}
      {/* Second line on narrow screens (RIR + side + actions); on
          sm+ this wrapper dissolves (display:contents) so the
          children join the single 7-column desktop grid in DOM
          order — desktop layout is pixel-identical. */}
      <div className="col-span-3 row-start-2 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-1 items-center sm:contents sm:col-auto sm:row-auto">
      <input type="number" min="0" max="10" step="1" inputMode="numeric" value={rirFromRpe(s.rpe)} onChange={e=> updateSet(bi,si,{rpe:rpeFromRir(e.target.value)})} {...commitProps('rir-field-commit', b.exerciseId, si)} placeholder="—" aria-label={`Reps in reserve set ${si+1}`} className={`min-w-0 rounded-xl border border-line bg-surface2 px-1 py-3 text-2xl font-black tabular-nums text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${s.completed?'opacity-60':''}`} />
      {b.unilateral ? (
        <select value={s.side||'L'} onChange={e=> updateSet(bi,si,{side:e.target.value})} aria-label={`Side set ${si+1}`} className="min-w-0 rounded-xl border border-line bg-surface2 px-1 py-3 text-xs font-bold"><option value="L">L</option><option value="R">R</option></select>
      ) : <span />}
      <span className="flex items-center gap-1">
        <button onClick={()=> completeSet(bi,si)} aria-pressed={s.completed} className={`min-h-12 px-2.5 rounded-xl border text-[11px] font-bold whitespace-nowrap ${s.completed?'bg-success text-bg border-success':'bg-surface2 border-line'}`}>{s.completed?'✓':'Done'}</button>
        {/* Gesture parity: the swipe-left "failed" action and the
            long-press keypad both exist as buttons, so touch-only
            gestures never gate an action (WCAG 2.5.6 / 2.1.1). */}
        {gymMode && !s.completed && (
          <button
            onClick={()=> { if(s.failed){ try{ recordEvent('undo-set', { sessionId, exerciseId:b.exerciseId, setIndex:si, ...(s.setId ? { setId: s.setId } : {}), mode: gymMode ? 'gym' : 'standard' }); }catch{} updateSet(bi,si,{ failed:false }); } else markFailed(bi,si); }}
            aria-pressed={s.failed}
            aria-label={s.failed ? `Unmark set ${si+1} failed` : `Mark set ${si+1} failed`}
            className={`min-h-12 w-9 grid place-items-center rounded-xl border text-[11px] font-bold ${s.failed?'bg-review text-bg border-review':'bg-surface2 border-line'}`}>{s.failed?'↺':'✗'}</button>
        )}
        {/* Standard mode gets the same one-tap failure log: a
            failed attempt stays a failed attempt in history
            instead of being deleted or faked as completed. */}
        {!gymMode && !s.completed && (
          <button
            onClick={()=> { if(s.failed){ try{ recordEvent('undo-set', { sessionId, exerciseId:b.exerciseId, setIndex:si, ...(s.setId ? { setId: s.setId } : {}), mode: 'standard' }); }catch{} updateSet(bi,si,{ failed:false }); } else markFailed(bi,si); }}
            aria-pressed={s.failed}
            aria-label={s.failed ? `Unmark set ${si+1} failed` : `Mark set ${si+1} failed`}
            className={`min-h-12 min-w-11 grid place-items-center rounded-xl border text-[11px] font-bold ${s.failed?'bg-review text-bg border-review':'bg-surface2 border-line'}`}>{s.failed?'↺':'✗'}</button>
        )}
      </span>
      {isSetPerformed(s) ? (
        <span className="w-9 h-9 grid place-items-center text-ink3" title="Already performed — undo it before removing" aria-label={`Set ${si+1} performed`}>·</span>
      ) : (
        <button onClick={()=> removeSet(bi,si)} aria-label={`Remove set ${si+1}`} className="relative w-9 h-9 grid place-items-center rounded-full border border-line text-ink3 before:absolute before:-inset-1.5 before:rounded-full before:content-['']">×</button>
      )}
      </div>
    </div>
    {/* RIR suggestion: the previous set's RIR offered for one-tap
        confirm — never written until confirmed or typed. Hidden
        once the row carries any RIR (confirmed, edited) or is
        done: Done alone must never persist a suggestion. */}
    {rirSuggest && rirSuggest.bi===bi && rirSuggest.si===si && !s.completed && rirFromRpe(s.rpe).trim()==='' && (
      <div role="group" aria-label={`Suggested RIR ${rirSuggest.value} for set ${si+1}`} className="flex items-center gap-1.5 rounded-xl border border-dashed border-line bg-surface2 px-2.5 py-1.5 -mt-1">
        <span className="text-[11px] text-ink3 flex-1 min-w-0">RIR {rirSuggest.value} suggested from last set</span>
        <button onClick={()=> confirmRirSuggestion(rirSuggest.value)} aria-label={`Use suggested RIR ${rirSuggest.value} for set ${si+1}`} className="min-h-11 px-3 rounded-full bg-ink text-bg text-xs font-bold">Same</button>
        <button onClick={()=> confirmRirSuggestion(stepRir(rirSuggest.value,-1))} aria-label={`Decrease suggested RIR for set ${si+1}`} className="min-h-11 min-w-11 grid place-items-center rounded-full border border-line bg-surface text-sm font-black">−</button>
        <span aria-hidden className="text-xs font-black tabular-nums w-6 text-center">{rirSuggest.value}</span>
        <button onClick={()=> confirmRirSuggestion(stepRir(rirSuggest.value,1))} aria-label={`Increase suggested RIR for set ${si+1}`} className="min-h-11 min-w-11 grid place-items-center rounded-full border border-line bg-surface text-sm font-black">+</button>
      </div>
    )}
    </Fragment>
  );
}
