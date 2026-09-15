import { useMemo, useState } from 'react';
import { MUSCLES, LEVELS, EQUIPMENT, EXERCISE_TAGS, searchExercises, EXERCISE_BY_ID } from '../lib/data.js';
import { hasExerciseImage, getExerciseMeta } from '../lib/exerciseImages.js';
import { teachingFor } from '../lib/exerciseTeaching.js';
import { ALTERNATIVE_KINDS, alternativesFor, classifyExercise, isDeprecated } from '../lib/exerciseTaxonomy.js';
import ExerciseIllustration from './ExerciseIllustration.jsx';

// Derived training-science chips: pattern, stability demand, fatigue cost,
// joint stress. Small, factual, and color-safe (text labels, not color).
function ClassificationChips({ exercise }){
  const c = classifyExercise(exercise);
  if(!c) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-line text-ink3 bg-surface">{c.pattern || 'unclassified'}</span>
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-line text-ink3 bg-surface">stability {c.stability}</span>
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-line text-ink3 bg-surface">fatigue {c.fatigue}</span>
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-line text-ink3 bg-surface">joints {c.jointStress}</span>
    </div>
  );
}

// Grouped alternatives over the substitution graph — only non-empty groups
// render, so the section never shows empty promises.
function AlternativeGroups({ exercise }){
  const groups = ALTERNATIVE_KINDS
    .map(k => ({ ...k, items: alternativesFor(exercise, k.id) }))
    .filter(g => g.items.length > 0);
  if(!groups.length) return null;
  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs font-semibold">Alternatives by need</p>
      {groups.map(g => (
        <p key={g.id} className="text-[11px] text-ink3">
          <span className="font-bold text-ink2">{g.label}:</span> {g.items.map(e => e.name).join(', ')}
        </p>
      ))}
    </div>
  );
}

export default function ExerciseBrowser({ availableEquipment }){
  const [q,setQ]=useState('');
  const [muscle,setMuscle]=useState('');
  const [level,setLevel]=useState('');
  const [equip,setEquip]=useState('');
  const [tags,setTags]=useState([]);
  const [onlyAvailable,setOnlyAvailable]=useState(!!availableEquipment?.length);
  const [openId,setOpenId]=useState(null);

  const toggleTag = (id)=> setTags(prev=> prev.includes(id) ? prev.filter(t=> t!==id) : [...prev, id]);

  const results = useMemo(()=> searchExercises({
    q, muscle, level, tag: tags, equipment: equip || undefined,
    availableEquipment: onlyAvailable ? availableEquipment : null
  }).filter(e => !isDeprecated(e)), [q,muscle,level,tags,equip,onlyAvailable,availableEquipment]);

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
      </div>

      <p className="text-xs text-ink3 px-1" role="status" aria-live="polite">{results.length} exercise{results.length===1?'':'s'} • sorted by relevance</p>

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
              <div className="px-4 pb-4 pt-3 space-y-2 border-t border-line bg-surface2">
                <div className="flex items-start gap-3">
                  {hasExerciseImage(ex.id) && <ExerciseIllustration exerciseId={ex.id} size="lg" />}
                <div className="min-w-0">
                  {(() => {
                    const t = teachingFor(ex.id);
                    return (
                      <>
                        <p className="text-xs font-semibold">Set-up</p>
                        <p className="text-xs text-ink2">{t.setup}</p>
                        <p className="text-xs font-semibold mt-2">Execution</p>
                        <ul className="list-disc pl-5 text-xs text-ink2 space-y-1">{t.execution.map((line, i)=> <li key={i}>{line}</li>)}</ul>
                        <p className="text-xs font-semibold mt-2">Breathing &amp; bracing</p>
                        <p className="text-xs text-ink2">{t.breathing}</p>
                        <p className="text-xs font-semibold mt-2">Stay in control</p>
                        <p className="text-xs text-ink2">{t.safety}</p>
                        <p className="text-xs font-semibold mt-2">Coaching cues</p>
                        <ul className="list-disc pl-5 text-xs text-ink2 space-y-1">{ex.cues.map((c,i)=> <li key={i}>{c}</li>)}</ul>
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
                      </>
                    );
                  })()}
                  {(() => {
                    const meta = getExerciseMeta(ex.id);
                    if(!meta) return null;
                    return (
                      <div className="mt-2 text-[11px] text-ink3 space-y-0.5">
                        <p>Type: {meta.exerciseType} · Equipment: {meta.equipment} · {meta.frames} frames</p>
                        <p>Muscles: {meta.primaryMuscle}{meta.secondaryMuscles?.length ? ` (secondary: ${meta.secondaryMuscles.join(', ')})` : ''}{meta.isStretch ? ' · stretch' : ''}</p>
                      </div>
                    );
                  })()}
                  <ClassificationChips exercise={ex} />
                  <p className="text-xs font-semibold mt-2">If you don’t have the kit</p>
                  <p className="text-xs text-ink3">{ex.substitution.map(id=> EXERCISE_BY_ID[id]?.name || id).join(' • ')}</p>
                  <AlternativeGroups exercise={ex} />
                </div>
                </div>
              </div>
            )}
          </li>
        ))}
        {!results.length && <li className="text-sm text-ink3 border border-dashed border-line rounded-2xl p-6 text-center">No matches — loosen filters or add equipment in onboarding.</li>}
      </ul>
    </div>
  );
}
