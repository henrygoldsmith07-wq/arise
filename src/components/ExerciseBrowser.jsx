import { useEffect, useMemo, useState } from 'react';
import { MUSCLES, LEVELS, EQUIPMENT, EXERCISE_TAGS, searchExercises, recommendExercises } from '../lib/data.js';
import { hasExerciseImage, getExerciseMeta } from '../lib/exerciseImages.js';
import { teachingFor } from '../lib/exerciseTeaching.js';
import { classifyExercise, isDeprecated } from '../lib/exerciseTaxonomy.js';
import { substitutionOptions } from '../lib/substitutions.js';
import { loadStore } from '../lib/store.js';
import { programmeExerciseIds, programmeUsageFor, recentExerciseSessions } from '../lib/trainSurface.js';
import ExerciseIllustration from './ExerciseIllustration.jsx';

// Derived training-science chips: pattern, stability demand, fatigue cost,
// joint stress. Small, factual, and color-safe (text labels, not color).
function ClassificationChips({ exercise }){
  const c = classifyExercise(exercise);
  if(!c) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-line text-ink3 bg-surface">{c.pattern || 'unclassified'}</span>
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-line text-ink3 bg-surface">stability {c.stability}</span>
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-line text-ink3 bg-surface">fatigue {c.fatigue}</span>
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-line text-ink3 bg-surface">joints {c.jointStress}</span>
    </div>
  );
}

// "What in my programme uses it": scheduled sessions and live templates.
function ProgramUsage({ rows, onFindSubstitutes }){
  if(!rows.length){
    return (
      <div>
        <p className="text-xs font-semibold">In my programme</p>
        <p className="text-[11px] text-ink3 mt-0.5">
          Not in your programme or templates yet. Add it from Train → Build my own & my templates.
        </p>
        <button onClick={onFindSubstitutes} className="text-[11px] font-bold underline underline-offset-2 mt-1 min-h-9">See suitable substitutions</button>
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs font-semibold">In my programme</p>
      <ul className="mt-1 space-y-1">
        {rows.map((row, i)=> (
          <li key={`${row.kind}-${row.name}-${i}`} className="text-[11px] text-ink2 flex gap-2">
            <span className="font-bold text-ink shrink-0">{row.kind === 'schedule' ? 'Scheduled' : 'Template'}</span>
            <span className="min-w-0">{row.name} <span className="text-ink3">• {row.detail}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Recent performance: the last logged sessions containing this exercise,
// with just the sets that were actually done.
function RecentPerformance({ rows, onLearnHow }){
  if(!rows.length){
    return (
      <div>
        <p className="text-xs font-semibold">Recent performance</p>
        <p className="text-[11px] text-ink3 mt-0.5">
          Nothing logged yet — run it in a session and your last three appearances show up here, sets included.
        </p>
        <button onClick={onLearnHow} className="text-[11px] font-bold underline underline-offset-2 mt-1 min-h-9">How to perform it</button>
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs font-semibold">Recent performance</p>
      <ul className="mt-1 space-y-1">
        {rows.map((row, i)=> (
          <li key={`${row.dateISO}-${i}`} className="text-[11px] text-ink2">
            <span className="font-mono tabular-nums text-ink3">{row.dateISO}</span>
            {row.title ? <span className="text-ink3"> · {row.title}</span> : null}
            {' — '}
            <span className="font-semibold">{row.sets.map(s=> `${s.reps || '?'}${s.weightKg ? `×${s.weightKg}kg` : ''}${s.failed ? ' (failed)' : ''}`).join(' · ')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SubstitutionList({ exercise, availableEquipment, history, onClearFilters }){
  const options = substitutionOptions(exercise.id, {
    availableEquipment: availableEquipment?.length ? availableEquipment : null,
    history,
    limit: 4,
  });
  if(!options.length){
    return (
      <div>
        <p className="text-xs font-semibold">Suitable substitutions</p>
        <p className="text-[11px] text-ink3 mt-0.5">No honest swap fits your kit right now — widen the kit you own to see more.</p>
        <button onClick={onClearFilters} className="text-[11px] font-bold underline underline-offset-2 mt-1 min-h-9">Clear filters</button>
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs font-semibold">Suitable substitutions</p>
      <ul className="mt-1 space-y-1">
        {options.map(ex=> (
          <li key={ex.id} className="text-[11px] text-ink2">
            <span className="font-bold text-ink">{ex.name}</span> <span className="text-ink3">• {ex.muscle} • {ex.equipment.join(', ')}</span>
            <span className="block text-ink3">{ex.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ExerciseBrowser({ availableEquipment, onboarding = null, store = null }){
  const [q,setQ]=useState('');
  const [muscle,setMuscle]=useState('');
  const [level,setLevel]=useState('');
  const [equip,setEquip]=useState('');
  const [tags,setTags]=useState([]);
  const [onlyAvailable,setOnlyAvailable]=useState(!!availableEquipment?.length);
  const [usedOnly,setUsedOnly]=useState(false);
  const [openId,setOpenId]=useState(null);
  const [howToOpen,setHowToOpen]=useState(false);
  const [subsOpen,setSubsOpen]=useState(false);

  // The browser answers "what in my programme uses it" and "how did I do on
  // it" from the canonical store — App owns the live copy and passes it down,
  // so this surface never reaches into storage itself (architecture rule).
  const storeSnapshot = store;

  const toggleTag = (id)=> setTags(prev=> prev.includes(id) ? prev.filter(t=> t!==id) : [...prev, id]);
  const clearFilters = ()=>{ setQ(''); setMuscle(''); setLevel(''); setEquip(''); setTags([]); setUsedOnly(false); };

  const programmeIds = useMemo(
    ()=> programmeExerciseIds({ activeSchedule: storeSnapshot.activeSchedule, customTemplates: storeSnapshot.customTemplates || [] }),
    [storeSnapshot.activeSchedule, storeSnapshot.customTemplates]
  );

  const results = useMemo(()=> searchExercises({
    q, muscle, level, tag: tags, equipment: equip || undefined,
    availableEquipment: onlyAvailable ? availableEquipment : null
  }).filter(e => !isDeprecated(e))
    .filter(e => !usedOnly || programmeIds.has(e.id)), [q,muscle,level,tags,equip,onlyAvailable,availableEquipment,usedOnly,programmeIds]);
  const recs = useMemo(()=> onboarding ? recommendExercises({
    goal:onboarding.goal,
    availableEquipment:onboarding.equipment,
    limit:4,
  }) : [], [onboarding]);

  return (
    <div className="px-4 py-5 space-y-4">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight">Exercises</h2>
        <p className="text-xs text-ink3">Search and filter the library. Toggle “Only my kit” to gate by onboarding equipment.</p>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-3 space-y-3">
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-widest text-ink3">Search</span>
          <input value={q} onChange={e=> setQ(e.target.value)} aria-label="Search exercises" placeholder="Push-up, squat, pull-up…" className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm focus:outline-none focus:border-ink" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[11px] font-semibold text-ink3">Muscle</span>
            <select value={muscle} onChange={e=> setMuscle(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm">
              <option value="">All</option>{MUSCLES.map(m=> <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-ink3">Level</span>
            <select value={level} onChange={e=> setLevel(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm">
              <option value="">All</option>{LEVELS.map(l=> <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="text-[11px] font-semibold text-ink3">Equipment</span>
          <select value={equip} onChange={e=> setEquip(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm">
            <option value="">Any</option>{EQUIPMENT.map(e=> <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </label>
        <div>
          <span className="text-[11px] font-semibold text-ink3">Tags</span>
          <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Filter by tag">
            {EXERCISE_TAGS.map(t=> {
              const active = tags.includes(t.id);
              return (
                <button key={t.id} onClick={()=> toggleTag(t.id)} aria-pressed={active} aria-label={`Filter tag ${t.label}`}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-bold min-h-8 transition-colors ${active ? 'bg-surface2 text-ink border-ink ring-1 ring-ink' : 'bg-surface border-line text-ink3 hover:border-ink3'}`}>
                  {t.label}
                </button>
              );
            })}
          </div>
          {!!tags.length && <button onClick={()=> setTags([])} className="text-[11px] text-ink3 underline underline-offset-2 mt-1.5">Clear tags</button>}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyAvailable} onChange={e=> setOnlyAvailable(e.target.checked)} />
          <span className="font-semibold">Only my kit</span>
          <span className="text-xs text-ink3">({availableEquipment?.join(', ') || 'no kit selected — set it in onboarding'})</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={usedOnly} onChange={e=> setUsedOnly(e.target.checked)} />
          <span className="font-semibold">Used in my programme</span>
          <span className="text-xs text-ink3">({programmeIds.size ? `${programmeIds.size} exercise${programmeIds.size === 1 ? '' : 's'} in your schedule and templates` : 'nothing scheduled yet'})</span>
        </label>
      </div>

      <p className="text-xs text-ink3 px-1" role="status" aria-live="polite">{results.length} exercise{results.length===1?'':'s'} • sorted by relevance</p>

      {!!recs.length && (
        <div className="rounded-2xl border border-line bg-surface p-3">
          <p className="text-xs font-bold">Recommended for you</p>
          <p className="text-[11px] text-ink3 mt-1">Based on onboarding: goal <span className="font-semibold text-ink">{onboarding.goal}</span> • location <span className="font-semibold text-ink">{onboarding.location}</span> • kit {(onboarding.equipment||[]).join(', ')}</p>
          <ul className="mt-2 grid gap-1.5">
            {recs.map(r=> <li key={r.id} className="text-sm flex gap-2"><span className="font-semibold">{r.name}</span><span className="text-xs text-ink3 ml-auto">{r.muscle} • {r.equipment.join(', ')}</span></li>)}
          </ul>
          <p className="text-[11px] text-ink3 mt-2">Change kit or location in More → Edit onboarding to see this update.</p>
        </div>
      )}

      <ul className="space-y-2">
        {results.map(ex=> (
          <li key={ex.id} className="rounded-2xl border border-line bg-surface overflow-hidden">
            <button onClick={()=> setOpenId(openId===ex.id?null:ex.id)} className="w-full text-left px-4 py-3 flex items-center gap-3">
              {hasExerciseImage(ex.id)
                ? <ExerciseIllustration exerciseId={ex.id} size="sm" />
                : <span className="w-9 h-9 grid place-items-center rounded-xl bg-surface2 border border-line text-sm">{EQUIPMENT.find(e=> e.id===ex.equipment[0])?.icon || '•'}</span>}
              <span className="min-w-0">
                <span className="block text-sm font-bold truncate">{ex.name}</span>
                <span className="block text-[11px] text-ink3">{ex.muscle} • {ex.level} • {ex.equipment.join(', ')}</span>
                {!!ex.tags?.length && (
                  <span className="flex flex-wrap gap-1 mt-1">
                    {ex.tags.map(t=> <span key={t} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-line text-ink3 bg-surface2">{EXERCISE_TAGS.find(x=> x.id===t)?.label || t}</span>)}
                  </span>
                )}
              </span>
              <span className="ml-auto text-ink3" aria-hidden>{openId===ex.id ? '−' : '+'}</span>
            </button>
            {openId===ex.id && (
              <div className="px-4 pb-4 pt-3 space-y-3 border-t border-line bg-surface2">
                <div className="flex items-start gap-3">
                  {hasExerciseImage(ex.id) && <ExerciseIllustration exerciseId={ex.id} size="lg" />}
                  <div className="min-w-0">
                    {(() => {
                      const meta = getExerciseMeta(ex.id);
                      return (
                        <div className="text-[11px] text-ink2">
                          <p><span className="font-bold text-ink">Trains:</span> {ex.muscle}{meta?.secondaryMuscles?.length ? ` (secondary: ${meta.secondaryMuscles.join(', ')})` : ''}</p>
                          <p><span className="font-bold text-ink">Equipment:</span> {ex.equipment.join(', ')}</p>
                        </div>
                      );
                    })()}
                    <ClassificationChips exercise={ex} />
                  </div>
                </div>
                <details open={howToOpen} onToggle={e=> setHowToOpen(e.currentTarget.open)} className="rounded-xl border border-line bg-surface px-3 py-2">
                  <summary className="text-xs font-bold cursor-pointer min-h-9 flex items-center">How to perform it</summary>
                  {(() => {
                    const t = teachingFor(ex.id);
                    return (
                      <div className="mt-1.5">
                        <p className="text-xs font-semibold">Set-up</p>
                        <p className="text-xs text-ink2">{t.setup}</p>
                        <p className="text-xs font-semibold mt-2">Execution</p>
                        <ul className="list-disc pl-5 text-xs text-ink2 space-y-1">{t.execution.map((line, i)=> <li key={i}>{line}</li>)}</ul>
                        <p className="text-xs font-semibold mt-2">Breathing & bracing</p>
                        <p className="text-xs text-ink2">{t.breathing}</p>
                        <p className="text-xs font-semibold mt-2">Stay in control</p>
                        <p className="text-xs text-ink2">{t.safety}</p>
                        {t.mistakes?.length > 0 && (
                          <>
                            <p className="text-xs font-semibold mt-2">Common mistakes</p>
                            <ul className="list-disc pl-5 text-xs text-ink2 space-y-1">{t.mistakes.map((m,i)=> <li key={i}>{m}</li>)}</ul>
                          </>
                        )}
                        {(t.regressions.length > 0 || t.progressions.length > 0 || t.equipmentVariations.length > 0) && (
                          <p className="text-xs text-ink2 mt-2">
                            {t.regressions.length > 0 && <>Easier: {t.regressions.slice(0, 3).map(r=> r.name).join(', ')}. </>}
                            {t.progressions.length > 0 && <>Harder: {t.progressions.slice(0, 3).map(r=> r.name).join(', ')}. </>}
                            {t.equipmentVariations.length > 0 && <>With other kit: {t.equipmentVariations.slice(0, 4).map(v=> v.name).join(', ')}.</>}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </details>
                <ProgramUsage
                  rows={programmeUsageFor(ex.id, { activeSchedule: storeSnapshot.activeSchedule, customTemplates: storeSnapshot.customTemplates || [] })}
                  onFindSubstitutes={()=> setSubsOpen(true)}
                />
                <RecentPerformance
                  rows={recentExerciseSessions(storeSnapshot.history, ex.id, 3)}
                  onLearnHow={()=> setHowToOpen(true)}
                />
                <details open={subsOpen} onToggle={e=> setSubsOpen(e.currentTarget.open)} className="rounded-xl border border-line bg-surface px-3 py-2">
                  <summary className="text-xs font-bold cursor-pointer min-h-9 flex items-center">Suitable substitutions</summary>
                  <div className="mt-1.5">
                    <SubstitutionList
                      exercise={ex}
                      availableEquipment={availableEquipment}
                      history={storeSnapshot.history}
                      onClearFilters={clearFilters}
                    />
                  </div>
                </details>
              </div>
            )}
          </li>
        ))}
        {!results.length && (
          <li className="text-sm text-ink3 border border-dashed border-line rounded-2xl p-6 text-center space-y-2">
            <p>No matches — loosen filters or add equipment in onboarding.</p>
            <button onClick={clearFilters} className="btn btn-secondary min-h-11 rounded-xl px-4 text-xs font-bold">Clear filters</button>
          </li>
        )}
      </ul>
    </div>
  );
}
