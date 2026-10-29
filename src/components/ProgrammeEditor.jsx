import { useMemo, useState } from 'react';
import { useDialogA11y } from '../lib/a11y.js';
import { useDialogs } from './Dialog.jsx';
import { saveEditsAsTemplate } from '../services/programmeService.js';
import { encodeShareCode } from '../lib/shareCodes.js';
import {
  editableDays, editSummary, swapCandidates, addCandidates,
  swapExercise, addExercise, removeExercise, moveExercise,
  setExerciseSets, setExerciseRepRange, setExerciseRest, pairWithNext, unpairExercise, supersetPartner, formatRestShort, REST_BOUNDS, renameDay, resetDay, resetAllEdits, undoLastEdit,
  parseRepRange, REP_BOUNDS, MIN_SETS, MAX_SETS, MAX_DAY_TITLE,
} from '../lib/programmeEditor.js';

// "My Programme" editor — lazy-loaded from Train so the boot and Train chunks
// never pay for it. Every change goes through the pure programmeEditor.js
// operations and lands on activeSchedule, which already persists to
// IndexedDB, exports, syncs and refreshes across tabs.
//
// One modal, three views (days → swap / add) rather than stacked modals, so
// there is exactly one focus trap and Escape always steps back one level.

const ICON = 'min-h-11 min-w-11 grid place-items-center rounded-xl border border-line bg-surface text-sm font-bold disabled:opacity-30';
const PILL = 'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border';
const EDITED = `${PILL} bg-successsoft text-success border-success/30`;

function Stepper({ label, value, onDown, onUp, downDisabled, upDisabled }){
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" onClick={onDown} disabled={downDisabled} aria-label={`Decrease ${label}`} className={ICON}>−</button>
      <span className="min-w-10 text-center text-sm font-black tabular-nums" aria-live="polite">{value}</span>
      <button type="button" onClick={onUp} disabled={upDisabled} aria-label={`Increase ${label}`} className={ICON}>+</button>
    </div>
  );
}

export default function ProgrammeEditor({ store, setStore, availableEquipment = [], onClose }){
  const schedule = store.activeSchedule;
  const dialogs = useDialogs();
  const [view, setView] = useState({ kind: 'days' });
  const [openKey, setOpenKey] = useState(null);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const back = ()=> { setView({ kind: 'days' }); setQuery(''); };
  const a11y = useDialogA11y({ active: true, onClose: view.kind === 'days' ? onClose : back });

  const days = useMemo(()=> editableDays(schedule), [schedule]);
  const summary = useMemo(()=> editSummary(schedule), [schedule]);
  const prefs = {
    availableEquipment,
    history: store.history || [],
    preferredExerciseIds: store.onboarding?.preferredExerciseIds || [],
    dislikedExerciseIds: store.onboarding?.dislikedExerciseIds || [],
  };
  const activeKey = openKey ?? days[0]?.key ?? null;

  // Status line reads the engine's own undo label ("Swap A → B"), so the
  // announcement and the Undo button can never disagree.
  const run = (result, msg)=> {
    if(result.error){ setStatus(result.error); return false; }
    setStore({ ...store, activeSchedule: result.schedule });
    setStatus(msg || `Saved: ${result.schedule.programmeEdits?.undo?.label}.`);
    return true;
  };

  // "Save as my template": every day as it stands now (edits included), for
  // every week of this block, lands in My templates in Train. A share code is
  // offered afterwards, never forced.
  const [saved, setSaved] = useState(null);
  const saveAsTemplate = async ()=> {
    const name = await dialogs.prompt({ title: 'Save as my template', fieldLabel: 'Template name', placeholder: 'My programme', confirmLabel: 'Save' });
    if(name === null || name === undefined) return;
    try{
      const result = saveEditsAsTemplate({ store, name });
      setStore(result.store);
      setSaved(result.template);
      setStatus(`Saved “${result.template.name}” to My templates in Train.`);
    }catch(e){ setStatus(e.message); }
  };
  const copyShareCode = ()=> {
    if(!saved) return;
    try{
      const code = encodeShareCode(saved);
      const done = ()=> setStatus(`Share code for “${saved.name}” copied.`);
      if(navigator.clipboard?.writeText) navigator.clipboard.writeText(code).then(done, ()=> setStatus(code));
      else setStatus(code);
    }catch(e){ setStatus(e.message || 'Could not build a share code.'); }
  };

  const rename = async (day)=> {
    const title = await dialogs.prompt({
      title: `Rename ${day.title}`,
      fieldLabel: 'Day name',
      placeholder: day.title,
      confirmLabel: 'Rename',
      validate: (v)=> !v.trim() ? 'Give the day a name.' : v.trim().length > MAX_DAY_TITLE ? `Keep it under ${MAX_DAY_TITLE} characters.` : null,
    });
    if(title) run(renameDay(schedule, day.key, title));
  };

  const confirmResetDay = async (day)=> {
    const ok = await dialogs.confirm({
      title: `Reset ${day.title}?`,
      description: 'Back to the programme’s version. History is kept; you can undo.',
      confirmLabel: 'Reset day',
      destructive: true,
    });
    if(ok) run(resetDay(schedule, day.key));
  };

  const confirmResetAll = async ()=> {
    const ok = await dialogs.confirm({
      title: 'Reset all edits?',
      description: 'Every day goes back to the programme’s version. History is kept; you can undo.',
      confirmLabel: 'Reset all',
      destructive: true,
    });
    if(ok) run(resetAllEdits(schedule));
  };

  if(!schedule?.sessions?.length){
    return null;
  }

  let body;
  if(view.kind === 'swap'){
    const day = days.find(d=> d.key === view.key);
    const block = day?.blocks?.[view.index];
    const options = block ? swapCandidates(schedule, view.key, view.index, prefs) : [];
    body = (
      <section aria-label="Swap exercise" className="space-y-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">Swap in {day?.title}</p>
          <h4 className="text-base font-black">Replace {block?.name}</h4>
          <p className="text-[11px] text-ink3">Closest matches that fit your kit. Avoided lifts are hidden; history stays with each lift.</p>
        </div>
        {options.length === 0 && <p className="text-sm text-ink3">No alternative fits your kit right now.</p>}
        <ul className="space-y-2">
          {options.map(opt=> (
            <li key={opt.id}>
              <button
                type="button"
                onClick={()=> { if(run(swapExercise(schedule, view.key, view.index, opt.id))) back(); }}
                className="w-full min-h-11 text-left rounded-xl border border-line bg-surface2 px-3 py-2"
                aria-label={`Swap to ${opt.name}`}
              >
                <span className="flex items-center gap-2">
                  <span className="font-bold text-sm">{opt.name}</span>
                  {opt.original && <span className={EDITED}>Original</span>}
                  {opt.liked && <span className={`${PILL} border-line text-ink3`}>Liked</span>}
                </span>
                <span className="block text-[11px] text-ink3">{opt.muscle} · {opt.equipment.join(', ')}{opt.reason ? ` · ${opt.reason}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={back} className="btn btn-secondary w-full min-h-11 rounded-xl">Back to programme</button>
      </section>
    );
  } else if(view.kind === 'add'){
    const day = days.find(d=> d.key === view.key);
    const results = addCandidates(schedule, view.key, { ...prefs, query });
    body = (
      <section aria-label="Add exercise" className="space-y-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">Add to {day?.title}</p>
          <h4 className="text-base font-black">Add an exercise</h4>

        </div>
        <label htmlFor="programme-add-search" className="sr-only">Search exercises</label>
        <input id="programme-add-search" type="search" value={query} onChange={(e)=> setQuery(e.target.value)}
          placeholder="Search exercises" autoComplete="off"
          className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm" />
        <ul className="space-y-2" aria-live="polite">
          {results.length === 0 && <li className="text-sm text-ink3">No match. Try another word or muscle.</li>}
          {results.map(opt=> (
            <li key={opt.id}>
              <button type="button" aria-label={`Add ${opt.name}`}
                onClick={()=> { if(run(addExercise(schedule, view.key, opt.id))) back(); }}
                className="w-full min-h-11 text-left rounded-xl border border-line bg-surface2 px-3 py-2">
                <span className="flex items-center gap-2"><span className="font-bold text-sm">{opt.name}</span>{opt.liked && <span className={`${PILL} border-line text-ink3`}>Liked</span>}</span>
                <span className="block text-[11px] text-ink3">{opt.muscle} · {opt.equipment.join(', ')}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={back} className="btn btn-secondary w-full min-h-11 rounded-xl">Back to programme</button>
      </section>
    );
  } else {
    body = (
      <>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Programme days">
          {days.map(day=> (
            <button key={day.key} type="button" role="tab" aria-selected={day.key === activeKey} onClick={()=> setOpenKey(day.key)}
              className={`min-h-11 rounded-xl border px-3 text-xs font-bold ${day.key === activeKey ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink3'}`}>
              {day.title}{day.edited ? ' •' : ''}
            </button>
          ))}
        </div>
        {days.filter(d=> d.key === activeKey).map(day=> (
          <section key={day.key} role="tabpanel" aria-label={day.title} data-testid={`programme-day-${day.key}`} className="rounded-2xl border border-line bg-surface2 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="min-w-0">
                <h4 className="text-base font-black truncate">{day.title}</h4>
                <p className="text-[11px] text-ink3">{day.upcoming} upcoming session{day.upcoming === 1 ? '' : 's'}{day.renamed ? ` · was ${day.templateTitle}` : ''}</p>
              </div>
              {day.edited && <span className={`${EDITED} ml-auto`}>Edited</span>}
            </div>
            <ol className="space-y-2">
              {day.blocks.map((block, i)=> {
                const range = parseRepRange(block.reps);
                const bounds = REP_BOUNDS[range?.unit] || REP_BOUNDS.reps;
                const setRange = (min, max)=> run(setExerciseRepRange(schedule, day.key, i, { min, max }));
                const partner = supersetPartner(day.blocks, i);
                const nextFree = i < day.blocks.length - 1 && supersetPartner(day.blocks, i + 1) == null;
                const rest = Number(block.restSec) || 0;
                return (
                  <li key={block.exerciseId} className={`rounded-xl border bg-surface p-2.5 space-y-2 ${partner != null ? 'border-ink border-l-4' : 'border-line'}`} data-testid="programme-exercise">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-sm">{block.name}</p>
                        <p className="text-[11px] text-ink3 tabular-nums">{block.sets} × {block.reps} · rest {formatRestShort(rest)} · {block.muscle}</p>
                        {partner != null && <p className="text-[11px] font-bold text-ink2" data-testid="programme-superset">Superset {i < partner ? 'A' : 'B'} · with {day.blocks[partner].name}</p>}
                      </div>
                      {block.edited && <span className={EDITED}>Edited</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <Stepper label={`sets for ${block.name}`} value={`${block.sets} sets`}
                        onDown={()=> run(setExerciseSets(schedule, day.key, i, block.sets - 1))}
                        onUp={()=> run(setExerciseSets(schedule, day.key, i, block.sets + 1))}
                        downDisabled={block.sets <= MIN_SETS} upDisabled={block.sets >= MAX_SETS} />
                      {range && (
                        <>
                          <Stepper label={`bottom of range for ${block.name}`} value={`min ${range.min}`}
                            onDown={()=> setRange(range.min - bounds.step, range.max)}
                            onUp={()=> setRange(range.min + bounds.step, range.max)}
                            downDisabled={range.min - bounds.step < bounds.min} upDisabled={range.min + bounds.step > range.max} />
                          <Stepper label={`top of range for ${block.name}`} value={`max ${range.max}`}
                            onDown={()=> setRange(range.min, range.max - bounds.step)}
                            onUp={()=> setRange(range.min, range.max + bounds.step)}
                            downDisabled={range.max - bounds.step < range.min} upDisabled={range.max + bounds.step > bounds.max} />
                        </>
                      )}
                      <Stepper label={`rest for ${block.name}`} value={formatRestShort(rest)}
                        onDown={()=> run(setExerciseRest(schedule, day.key, i, rest - REST_BOUNDS.step))}
                        onUp={()=> run(setExerciseRest(schedule, day.key, i, Math.max(REST_BOUNDS.min, rest + REST_BOUNDS.step)))}
                        downDisabled={rest - REST_BOUNDS.step < REST_BOUNDS.min} upDisabled={rest + REST_BOUNDS.step > REST_BOUNDS.max} />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {partner != null
                        ? <button type="button" onClick={()=> run(unpairExercise(schedule, day.key, i))} aria-label={`Unpair ${block.name}`} className="btn btn-secondary min-h-11 rounded-xl px-3 text-xs">Unpair</button>
                        : nextFree && <button type="button" onClick={()=> run(pairWithNext(schedule, day.key, i))} aria-label={`Pair ${block.name} with next`} className="btn btn-secondary min-h-11 rounded-xl px-3 text-xs">Pair with next</button>}
                      <button type="button" onClick={()=> setView({ kind: 'swap', key: day.key, index: i })} aria-label={`Swap ${block.name}`} className="btn btn-secondary min-h-11 rounded-xl px-3 text-xs">Swap</button>
                      <button type="button" onClick={()=> run(moveExercise(schedule, day.key, i, -1))} disabled={i === 0} aria-label={`Move ${block.name} up`} className={ICON}>↑</button>
                      <button type="button" onClick={()=> run(moveExercise(schedule, day.key, i, 1))} disabled={i === day.blocks.length - 1} aria-label={`Move ${block.name} down`} className={ICON}>↓</button>
                      <button type="button" onClick={()=> run(removeExercise(schedule, day.key, i))} disabled={day.blocks.length <= 1} aria-label={`Remove ${block.name}`} className={`${ICON} text-danger`}>✕</button>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={()=> setView({ kind: 'add', key: day.key })} className="btn btn-primary min-h-11 rounded-xl text-xs">+ Add exercise</button>
              <button type="button" onClick={()=> rename(day)} className="btn btn-secondary min-h-11 rounded-xl text-xs">Rename day</button>
            </div>
            {day.edited && <button type="button" onClick={()=> confirmResetDay(day)} className="btn btn-secondary w-full min-h-11 rounded-xl text-xs">Reset this day</button>}
          </section>
        ))}
        {days.length > 0 && (
          <div className="grid grid-cols-1 gap-2">
            <button type="button" onClick={saveAsTemplate} className="btn btn-secondary w-full min-h-11 rounded-xl text-xs">Save as my template</button>
            {saved && <button type="button" onClick={copyShareCode} className="btn btn-secondary w-full min-h-11 rounded-xl text-xs">Copy share code</button>}
          </div>
        )}
        {summary.days > 0 && (
          <button type="button" onClick={confirmResetAll} className="btn btn-secondary w-full min-h-11 rounded-xl text-xs text-danger">Reset all to template</button>
        )}
      </>
    );
  }

  return (
    <div ref={a11y.rootRef} onKeyDown={a11y.trapTab} className="fixed inset-0 z-40 bg-black/40 p-3 sm:p-4 overflow-auto" role="dialog" aria-modal="true" aria-label="My programme">
      {dialogs.node}
      <div className="max-w-xl mx-auto my-4 rounded-3xl bg-surface border border-line p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <h3 className="text-lg font-black tracking-tight">My programme</h3>
            <p className="text-[11px] text-ink3">
              {summary.days ? `${summary.days} day${summary.days === 1 ? '' : 's'} customised` : 'Matches the template'} · changes apply to every upcoming session of that day
            </p>
          </div>
          <button ref={a11y.closeRef} type="button" onClick={view.kind === 'days' ? onClose : back} aria-label={view.kind === 'days' ? 'Close programme editor' : 'Back to programme'} className="ml-auto min-h-11 min-w-11 grid place-items-center rounded-full border border-line">✕</button>
        </div>
        {summary.canUndo && view.kind === 'days' && (
          <button type="button" onClick={()=> run(undoLastEdit(schedule), 'Undone.')} className="btn btn-secondary w-full min-h-11 rounded-xl text-xs" aria-label={`Undo ${summary.undoLabel}`}>
            ↶ Undo: {summary.undoLabel}
          </button>
        )}
        <p role="status" aria-live="polite" className="text-xs text-ink3 min-h-4" data-testid="programme-editor-status">{status}</p>
        {body}
      </div>
    </div>
  );
}
