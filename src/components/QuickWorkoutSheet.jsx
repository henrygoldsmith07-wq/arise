// QuickWorkoutSheet — Today → "Quick workout": pick lifts (or a shortcut),
// then run them in the normal runner. The session is not part of the
// programme, so it never marks, skips or moves a scheduled session.
import { useMemo, useState } from 'react';
import { useDialogA11y } from '../lib/a11y.js';
import { EXERCISE_BY_ID } from '../lib/data.js';
import { MUSCLE_ORDER } from '../lib/exercisePicker.js';
import { QUICK_MAX, buildQuickSession, moveId, quickCandidates, restedMuscleLifts, sameAsLastTime, upperBodyLifts } from '../lib/quickWorkout.js';

const chip = 'min-h-11 rounded-full border px-3 text-xs font-bold';

export default function QuickWorkoutSheet({ store, onStart, onClose }) {
  const a11y = useDialogA11y({ active: true, onClose });
  const history = store.history || [];
  const ob = store.onboarding || {};
  const opts = { history, equipment: ob.equipment, preferred: ob.preferredExerciseIds || [], disliked: ob.dislikedExerciseIds || [] };
  const [ids, setIds] = useState([]);
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState(null);
  const [note, setNote] = useState('');
  const last = useMemo(() => sameAsLastTime(history), [history]);
  const results = useMemo(
    () => quickCandidates({ query, muscle, equipment: ob.equipment, preferred: opts.preferred, disliked: opts.disliked, exclude: ids, limit: 30 }),
    [query, muscle, ob.equipment, ids], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const add = (id) => setIds((cur) => (cur.includes(id) || cur.length >= QUICK_MAX ? cur : [...cur, id]));
  const preset = (found, label) => {
    if (!found.ids.length) { setNote('Nothing to suggest yet — pick lifts below.'); return; }
    setIds(found.ids);
    setNote(label);
  };
  const start = () => {
    const session = buildQuickSession({ exerciseIds: ids, history });
    if (session) onStart(session);
  };
  const full = ids.length >= QUICK_MAX;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div ref={a11y.rootRef} onKeyDown={a11y.trapTab} role="dialog" aria-modal="true" aria-label="Quick workout" data-testid="quick-sheet"
        onClick={(e) => e.stopPropagation()} className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-ink">Quick workout</h2>
          <button ref={a11y.closeRef} type="button" onClick={onClose} className="min-h-11 min-w-11 text-xs font-bold px-3 rounded-full border border-line">Close</button>
        </div>
        <p className="text-[11px] text-ink3">An extra or unplanned session. It counts toward your progress, and your programme stays exactly as it is.</p>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Shortcuts">
          {last && <button type="button" data-testid="quick-last" className={`${chip} border-line`} onClick={() => preset(last, `Same lifts as ${last.title} (${last.dateISO}).`)}>Same as last time</button>}
          <button type="button" data-testid="quick-rested" className={`${chip} border-line`}
            onClick={() => { const f = restedMuscleLifts(opts); preset(f, `Rested longest: ${f.muscles.map((m) => `${m} (${f.reasons[m]})`).join(', ')}.`); }}>Rested muscles</button>
          <button type="button" data-testid="quick-upper" className={`${chip} border-line`}
            onClick={() => { const f = upperBodyLifts(opts); preset(f, `Upper body, ${f.muscles.join(' and ')} first.`); }}>Upper body only</button>
        </div>
        {note && <p role="status" className="text-[11px] text-ink2" data-testid="quick-note">{note}</p>}

        <ol className="space-y-1.5" aria-label="Your lifts" data-testid="quick-picked">
          {ids.map((id, i) => (
            <li key={id} className="flex items-center gap-1.5 rounded-xl border border-line px-2 py-1">
              <span className="min-w-0 flex-1 truncate text-xs font-bold">{EXERCISE_BY_ID[id]?.name || id}</span>
              <button type="button" aria-label={`Move ${EXERCISE_BY_ID[id]?.name} up`} disabled={i === 0} className="min-h-11 min-w-11 text-xs disabled:opacity-30" onClick={() => setIds((c) => moveId(c, i, i - 1))}>↑</button>
              <button type="button" aria-label={`Move ${EXERCISE_BY_ID[id]?.name} down`} disabled={i === ids.length - 1} className="min-h-11 min-w-11 text-xs disabled:opacity-30" onClick={() => setIds((c) => moveId(c, i, i + 1))}>↓</button>
              <button type="button" aria-label={`Remove ${EXERCISE_BY_ID[id]?.name}`} className="min-h-11 min-w-11 text-xs font-bold" onClick={() => setIds((c) => c.filter((x) => x !== id))}>✕</button>
            </li>
          ))}
        </ol>

        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search lifts (lat, press, curl…)" aria-label="Search lifts"
          data-testid="quick-search" className="w-full min-h-11 rounded-xl border border-line bg-surface2 px-3 text-sm" />
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Muscle">
          {[null, ...MUSCLE_ORDER.filter((m) => m !== 'Cardio' && m !== 'Full body')].map((m) => (
            <button key={m || 'all'} type="button" aria-pressed={muscle === m} onClick={() => setMuscle(m)}
              className={`${chip} shrink-0 ${muscle === m ? 'border-accent bg-accent/10' : 'border-line'}`}>{m || 'All'}</button>
          ))}
        </div>
        <ul className="space-y-1" aria-label="Lifts to add" data-testid="quick-results">
          {results.map((ex) => (
            <li key={ex.id}>
              <button type="button" disabled={full} onClick={() => add(ex.id)} data-testid={`quick-add-${ex.id}`}
                className="flex w-full min-h-11 items-center justify-between gap-2 rounded-xl px-2 text-left text-xs disabled:opacity-40 hover:bg-surface2">
                <span className="truncate font-bold">{ex.name}</span><span className="shrink-0 text-ink3">{ex.muscle} · Add</span>
              </button>
            </li>
          ))}
          {!results.length && <li className="text-xs text-ink3">No lift matches. Try fewer letters.</li>}
        </ul>
        {full && <p className="text-[11px] text-ink3">That is {QUICK_MAX} lifts — plenty for one session.</p>}

        <button type="button" disabled={!ids.length} onClick={start} data-testid="quick-start" className="btn btn-primary w-full min-h-12 rounded-xl disabled:opacity-40">
          {ids.length ? `Start ${ids.length} lift${ids.length === 1 ? '' : 's'}` : 'Pick at least one lift'}
        </button>
      </div>
    </div>
  );
}
