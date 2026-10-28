import { useMemo, useState } from 'react';
import { useDialogA11y } from '../lib/a11y.js';
import { EXERCISE_BY_ID } from '../lib/data.js';
import { editSet, deleteSet, deleteSession, describeSet } from '../lib/historyEditor.js';

// Fix a typo in a past workout, or remove a session that should never have
// been logged. Everything stays on this device; deleting leaves a tombstone so
// a restore or sync cannot bring the session back.
export default function HistoryEditSheet({ store, setStore, onClose }){
  const a11y = useDialogA11y({ active: true, onClose });
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState(null); // { sessionId, bi, si, weightKg, reps, rpe }
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // sessionId awaiting delete confirm
  const [note, setNote] = useState('');
  const sessions = useMemo(()=> [...(store.history || [])].sort((a, b)=> String(b.dateISO).localeCompare(String(a.dateISO))).slice(0, 30), [store.history]);

  function apply(result, msg){
    if(result.error){ setError(result.error); return; }
    setError(''); setDraft(null); setConfirm(null); setNote(msg);
    setStore(result.store);
  }
  function saveDraft(){
    const { sessionId, bi, si, weightKg, reps, rpe } = draft;
    apply(editSet(store, { sessionId, blockIndex: bi, setIndex: si, patch: { weightKg, reps, rpe } }), 'Set updated. Future suggestions use the corrected numbers.');
  }
  const field = 'min-h-11 w-full rounded-lg border border-line bg-surface px-2 text-sm tabular-nums';
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div ref={a11y.rootRef} onKeyDown={a11y.trapTab} role="dialog" aria-modal="true" aria-label="Edit workout history"
        onClick={e=> e.stopPropagation()} className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-ink">Edit logged workouts</h2>
          <button ref={a11y.closeRef} type="button" onClick={onClose} className="min-h-11 min-w-11 text-xs font-bold px-3 rounded-full border border-line">Done</button>
        </div>
        <p className="text-[11px] text-ink3">Fix a wrong weight or rep count, or remove a set or session. Changes stay on this device.</p>
        {note && <p role="status" className="text-xs text-ink2">{note}</p>}
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        {sessions.length === 0 && <p className="text-xs text-ink3">No workouts logged yet.</p>}
        <ul className="space-y-2">
          {sessions.map((s)=> {
            const open = openId === s.id;
            return (
              <li key={s.id} className="rounded-xl border border-line bg-surface2 p-2.5 text-xs">
                <button type="button" aria-expanded={open} onClick={()=> { setOpenId(open ? null : s.id); setDraft(null); setConfirm(null); }} className="min-h-11 w-full text-left font-bold text-ink">
                  {s.dateISO} · {(s.blocks || []).length} exercises
                </button>
                {open && (
                  <div className="space-y-2">
                    {(s.blocks || []).map((b, bi)=> (
                      <div key={bi}>
                        <p className="font-bold text-ink2">{EXERCISE_BY_ID[b.exerciseId]?.name || b.exerciseId}</p>
                        {(b.sets || []).map((set, si)=> {
                          const editing = draft && draft.sessionId === s.id && draft.bi === bi && draft.si === si;
                          return editing ? (
                            <div key={si} className="grid grid-cols-3 gap-2 py-1">
                              <label className="text-[11px] text-ink3">kg<input inputMode="decimal" aria-label="Load in kg" className={field} value={draft.weightKg} onChange={e=> setDraft({ ...draft, weightKg: e.target.value })} /></label>
                              <label className="text-[11px] text-ink3">reps<input inputMode="numeric" aria-label="Reps" className={field} value={draft.reps} onChange={e=> setDraft({ ...draft, reps: e.target.value })} /></label>
                              <label className="text-[11px] text-ink3">RPE<input inputMode="decimal" aria-label="RPE" className={field} value={draft.rpe} onChange={e=> setDraft({ ...draft, rpe: e.target.value })} /></label>
                              <button type="button" onClick={saveDraft} className="min-h-11 rounded-full bg-ink text-surface font-bold col-span-2">Save set</button>
                              <button type="button" onClick={()=> { setDraft(null); setError(''); }} className="min-h-11 rounded-full border border-line font-bold">Cancel</button>
                            </div>
                          ) : (
                            <div key={si} className="flex items-center justify-between gap-2">
                              <span className="tabular-nums text-ink2">Set {si + 1}: {describeSet(set)}{set.edited ? ' (edited)' : ''}</span>
                              <span className="flex gap-1">
                                <button type="button" onClick={()=> { setError(''); setDraft({ sessionId: s.id, bi, si, weightKg: set.weightKg ?? '', reps: set.reps ?? '', rpe: set.rpe ?? '' }); }} className="min-h-11 min-w-11 px-2 rounded-full border border-line font-bold">Edit</button>
                                <button type="button" aria-label={`Delete set ${si + 1}`} onClick={()=> apply(deleteSet(store, { sessionId: s.id, blockIndex: bi, setIndex: si }), 'Set removed.')} className="min-h-11 min-w-11 px-2 rounded-full border border-line font-bold">Delete</button>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    {confirm === s.id ? (
                      <div className="flex gap-2">
                        <button type="button" onClick={()=> apply(deleteSession(store, { sessionId: s.id }), 'Session deleted. Its slot in your programme is open again.')} className="min-h-11 flex-1 rounded-full bg-red-600 text-white font-bold">Yes, delete session</button>
                        <button type="button" onClick={()=> setConfirm(null)} className="min-h-11 flex-1 rounded-full border border-line font-bold">Keep it</button>
                      </div>
                    ) : (
                      <button type="button" onClick={()=> setConfirm(s.id)} className="min-h-11 w-full rounded-full border border-line font-bold">Delete whole session</button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
