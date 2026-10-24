import { useState } from 'react';
import { filterExercises, groupByMuscle, musclesIn } from '../lib/exercisePicker.js';

// Grouped, searchable Like/Avoid picker for exercise preferences.
// Replaces onboarding's flat ~60-row list with tiny (~24px) buttons: search
// (with gym shorthand), muscle chips, a "Show my picks" toggle and
// collapsible muscle groups, every control a 44px touch target.
//
// State ownership: the parent keeps the liked/avoided id lists (they persist
// via the onboarding draft) and owns toggle semantics through `onToggle`;
// this component only holds view state (query, filters, open groups).
// Rendered once (onboarding's last step), so the ids below are unique.
const CHIP = 'min-h-11 min-w-11 shrink-0 rounded-xl border px-3 text-xs font-bold ';
const OFF = 'bg-surface border-line text-ink3';

export default function ExercisePreferencePicker({ exercises, preferredIds = [], dislikedIds = [], onToggle }){
  const [query, setQueryRaw] = useState('');
  const [muscle, setMuscle] = useState('all');
  const [onlyChosen, setOnlyChosen] = useState(false);
  // Explicit open/closed choices per group; reset whenever the search changes
  // so a group collapsed earlier never hides fresh search results.
  const [openState, setOpenState] = useState({});
  const setQuery = (value)=> { setQueryRaw(value); setOpenState({}); };
  const sets = { preferred: preferredIds, disliked: dislikedIds };
  const visible = filterExercises(exercises, { query, muscle, onlyChosen, ...sets });
  const filtering = Boolean(query.trim()) || muscle !== 'all' || onlyChosen;
  const isOpen = (name)=> openState[name] ?? filtering;
  const chip = (label, active, on)=> (
    <button key={label} type="button" onClick={on} aria-pressed={active} className={CHIP + (active ? 'bg-ink text-bg border-ink' : OFF)}>{label}</button>
  );
  const clear = (
    <button type="button" onClick={()=> setQuery('')} aria-label="Clear search" className={CHIP + OFF}>Clear</button>
  );

  return (
    <div className="space-y-2" data-testid="exercise-preference-picker">
      <div className="flex gap-2">
        <label htmlFor="exercise-picker-search" className="sr-only">Search exercises</label>
        <input id="exercise-picker-search" type="search" value={query} onChange={(e)=> setQuery(e.target.value)}
          placeholder="Search (e.g. pulldown, db, rdl)" autoComplete="off"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm" />
        {query && clear}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by muscle">
        {chip('All', muscle === 'all', ()=> setMuscle('all'))}
        {musclesIn(exercises).map((name)=> chip(name, muscle === name, ()=> setMuscle(muscle === name ? 'all' : name)))}
        {chip('Show my picks', onlyChosen, ()=> setOnlyChosen((v)=> !v))}
      </div>
      <p className="text-[11px] text-ink3" aria-live="polite" data-testid="exercise-picker-count">
        Showing {visible.length} of {exercises.length} · {preferredIds.length} liked · {dislikedIds.length} avoided
      </p>
      <div className="max-h-80 overflow-auto space-y-1.5 pr-1">
        {!visible.length && (
          <p className="rounded-xl border border-line bg-surface2 p-3 text-center text-xs text-ink3">
            {query.trim() ? <>No exercises match “{query.trim()}”. {clear}</> : 'Nothing here yet.'}
          </p>
        )}
        {groupByMuscle(visible, sets).map((group)=> {
          const open = isOpen(group.muscle);
          return (
            <section key={group.muscle} className="rounded-xl border border-line bg-surface2">
              <button type="button" onClick={()=> setOpenState((prev)=> ({ ...prev, [group.muscle]: !open }))} aria-expanded={open}
                className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm font-bold">
                <span className="flex-1">{group.muscle} ({group.count})</span>
                <span className="text-[11px] font-normal text-ink3">{group.liked} liked · {group.avoided} avoided</span>
              </button>
              {open && group.exercises.map((ex)=> {
                const liked = preferredIds.includes(ex.id);
                const avoided = dislikedIds.includes(ex.id);
                return (
                  <div key={ex.id} className="flex items-center gap-2 border-t border-line px-3 py-1">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{ex.name}</span>
                    <button type="button" onClick={()=> onToggle(ex.id, 'preferred')} aria-pressed={liked} className={CHIP + (liked ? 'bg-success text-bg border-success' : OFF)}>
                      Like<span className="sr-only"> {ex.name}</span>
                    </button>
                    <button type="button" onClick={()=> onToggle(ex.id, 'disliked')} aria-pressed={avoided} className={CHIP + (avoided ? 'bg-review text-bg border-review' : OFF)}>
                      Avoid<span className="sr-only"> {ex.name}</span>
                    </button>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
