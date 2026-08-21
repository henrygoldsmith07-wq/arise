import { useMemo, useState } from 'react';
import { deriveAttributes, levelFromAttributes } from '../lib/attributes.js';
import { totalVolumeKg, streakDays } from '../lib/store.js';
import { EXERCISE_BY_ID } from '../lib/data.js';
import { weeklyVolume, frequencyByMuscleSync, volumeLandmarks, volumeDistribution, strengthSeriesWithConfidence, extractNoteRecommendations, plannedVsCompletedStats } from '../lib/analytics.js';
import { strengthTrendWithConfidence, classifyPR } from '../lib/progression.js';
import { exerciseHistorySummary, plateauDetection, programAdherence, recommendationCalibration, validateDeloadLogic } from '../lib/programming.js';
import { badSessionAttribution, plateauAttribution } from '../lib/sessionQuality.js';
import { longitudinalSummary } from '../lib/longitudinal.js';

export default function ProgressView({ store }){
  const attrs = useMemo(()=> deriveAttributes(store.history), [store.history]);
  const lvl = useMemo(()=> levelFromAttributes(attrs), [attrs]);
  const history = store.history || [];
  const vol = totalVolumeKg(history);
  const streak = streakDays(history);
  const prs = useMemo(()=> computePRs(history), [history]);
  const wv = useMemo(()=> weeklyVolume(history), [history]);
  const freq = useMemo(()=> frequencyByMuscleSync(history, EXERCISE_BY_ID), [history]);
  const landmarks = useMemo(()=> volumeLandmarks(history, EXERCISE_BY_ID), [history]);
  const dist = useMemo(()=> volumeDistribution(history, EXERCISE_BY_ID), [history]);
  const noteRecs = useMemo(()=> extractNoteRecommendations(history), [history]);
  const adherence = useMemo(()=> plannedVsCompletedStats(store.activeSchedule, history), [store.activeSchedule, history]);
  const programmeAdherence = useMemo(()=> programAdherence(store.activeSchedule, history), [store.activeSchedule, history]);
  const exerciseOptions = useMemo(()=> {
    const ids = new Set();
    for(const session of history) for(const block of session.blocks || []) ids.add(block.exerciseId);
    return [...ids].sort((a, b)=> (EXERCISE_BY_ID[a]?.name || a).localeCompare(EXERCISE_BY_ID[b]?.name || b));
  }, [history]);
  const [selectedExerciseId, setSelectedExerciseId] = useState('');
  const exerciseId = exerciseOptions.includes(selectedExerciseId) ? selectedExerciseId : exerciseOptions[0];
  const exerciseSummary = useMemo(()=> exerciseId ? exerciseHistorySummary(history, exerciseId) : null, [history, exerciseId]);
  const plateau = useMemo(()=> exerciseId ? plateauDetection(history, exerciseId, { readinessLog: store.readinessLog || [] }) : null, [history, exerciseId, store.readinessLog]);
  const deloadValidation = useMemo(()=> validateDeloadLogic({ history, readinessLog: store.readinessLog || [] }), [history, store.readinessLog]);
  const calibration = useMemo(()=> recommendationCalibration(history, {
    readinessLog: store.readinessLog || [],
    schedule: store.activeSchedule || null,
    profile: { availableEquipment: store.onboarding?.equipment || [] },
  }), [history, store.readinessLog, store.activeSchedule, store.onboarding?.equipment]);
  const badAttribution = useMemo(()=> badSessionAttribution(history, { readinessLog: store.readinessLog || [] }), [history, store.readinessLog]);
  const longitudinal = useMemo(()=> longitudinalSummary({ preferences: store.preferences }), [store.preferences]);
  const evaluation = longitudinal?.evaluation || null;
  const formatSegment = segment=> {
    if(!segment || !segment.resolved) return '—';
    if(!segment.conclusive) return `${segment.resolved} pairs (need ${evaluation.minimumSegmentSamples}+ for conclusions)`;
    return `${Math.round((segment.progressionSuccessRate ?? 0) * 100)}% progression success • ${Math.round((segment.adherenceRate ?? 0) * 100)}% adherence • n=${segment.resolved}`;
  };
  const plateauRows = useMemo(()=>{
    const ids=[...new Set(history.flatMap(h=> (h.blocks||[]).map(b=> b.exerciseId)))];
    return ids.map(exerciseId=> ({ exerciseId, result: plateauAttribution(history, exerciseId, { readinessLog: store.readinessLog || [] }) }))
      .filter(row=> row.result.kind !== 'insufficient')
      .sort((a,b)=> (a.result.kind==='genuine'?0:1) - (b.result.kind==='genuine'?0:1))
      .slice(0,5);
  }, [history, store.readinessLog]);

  return (
    <div className="px-4 py-5 space-y-4">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight">Progress</h2>
        <p className="text-xs text-ink3">Derived from logged history — not from what you <em>planned</em> to do. Volume landmarks are rough context, not targets.</p>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-ink text-bg grid place-items-center font-black text-lg">{lvl.level}</div>
        <div>
          <p className="text-sm font-bold">Level {lvl.level} — {lvl.title}</p>
          <p className="text-xs text-ink3">Avg {lvl.avg}/100 • {history.length} sessions {adherence.total ? `• ${adherence.done}/${adherence.total} planned done` : ''}</p>
          <div className="mt-2 h-1.5 rounded-full bg-surface2 w-40 overflow-hidden"><div className="h-full bg-ink" style={{width:`${lvl.avg}%`}} /></div>
        </div>
        <div className="ml-auto text-right text-xs">
          <p className="font-bold tabular-nums">{vol.toLocaleString()} kg</p><p className="text-ink3">total volume</p>
          <p className="font-bold tabular-nums mt-1">{streak} days</p><p className="text-ink3">streak</p>
        </div>
      </div>

      {store.activeSchedule && (
        <section className="rounded-2xl border border-line bg-surface p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold">Programme adherence</h3>
            <span className="text-xs font-black tabular-nums">{programmeAdherence.toDateRate == null ? '—' : `${Math.round(programmeAdherence.toDateRate * 100)}%`}</span>
          </div>
          <p className="text-xs text-ink3">{programmeAdherence.completed} completed • {programmeAdherence.missed} missed • {programmeAdherence.upcoming} upcoming. Future sessions do not lower the rate yet.</p>
          {programmeAdherence.missed > 0 && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">Missed sessions are recoverable in order. Open Today to re-plan the schedule rather than doubling the next workout.</p>}
        </section>
      )}

      <div className="grid grid-cols-2 gap-2">
        {attrs.map(a=> (
          <div key={a.id} className="rounded-2xl border border-line bg-surface p-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">{a.label}</p>
            <p className="text-lg font-black tabular-nums">{a.value}<span className="text-xs text-ink3">/100</span></p>
            <div className="mt-1 h-1 rounded-full bg-surface2 overflow-hidden"><div className="h-full bg-ink" style={{width:`${a.value}%`}} /></div>
            <p className="text-[11px] text-ink3 mt-1.5">{a.blurb}</p>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">Weekly volume</h3>
        {!wv.length ? <p className="text-xs text-ink3 mt-2">Log a couple sessions — then trends appear.</p> : (
          <div className="mt-2 flex items-end gap-1 h-14">
            {wv.slice(-8).map(w=>{ const max=Math.max(...wv.map(x=>x.vol),1); const h=Math.max(4, Math.round(w.vol/max*48)); return <div key={w.week} title={`${w.week}: ${w.vol} kg`} className="flex-1 rounded bg-ink" style={{height:`${h}px`}} />; })}
          </div>
        )}
        {!!wv.length && <p className="text-xs text-ink3 mt-2">{wv[wv.length-1]?.vol> (wv[wv.length-2]?.vol||0)*1.2 ? `Volume up ${Math.round((wv[wv.length-1].vol/(wv[wv.length-2]?.vol||1)-1)*100)}% vs last week — hold steady or deload if RPE was high.` : wv[wv.length-1]?.vol < (wv[wv.length-2]?.vol||0)*0.8 ? 'Volume dipped — good if planned deload, otherwise add a session.' : 'Trends look steady — keep progressing where RIR ≥2.'}</p>}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <div>
          <h3 className="text-sm font-bold">Training feedback</h3>
          <p className="text-xs text-ink3">Separates a genuine plateau from fatigue or an isolated bad session.</p>
        </div>
        <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5">
          <p className="text-xs font-bold">Recent session attribution <span className="font-normal text-ink3">({badAttribution.confidence} confidence)</span></p>
          <p className="text-xs mt-1">{badAttribution.reason}</p>
          {!!badAttribution.evidence?.length && <p className="text-[11px] text-ink3 mt-1">Evidence: {badAttribution.evidence.join(' · ')}</p>}
          <p className="text-[11px] text-ink3 mt-1">Next: {badAttribution.action}</p>
        </div>
        {!!plateauRows.length && <div className="space-y-2">
          {plateauRows.map(row=> {
            const ex=EXERCISE_BY_ID[row.exerciseId];
            const kind=row.result.kind==='bad-sessions' ? 'fatigue-driven' : row.result.kind;
            return <div key={row.exerciseId} className="rounded-xl border border-line bg-surface2 px-3 py-2.5">
              <div className="flex items-center gap-2"><p className="text-xs font-bold truncate">{ex?.name || row.exerciseId}</p><span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-ink3">{kind}</span></div>
              <p className="text-[11px] mt-1">{row.result.reason}</p>
              <p className="text-[11px] text-ink3 mt-1">Next: {row.result.action}</p>
            </div>;
          })}
        </div>}
      </section>

      {!!Object.keys(landmarks).length && (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-sm font-bold">Volume landmarks (sets/week)</h3>
          <p className="text-xs text-ink3">Cautious, rough context — individual needs vary. Not a prescription.</p>
          <ul className="mt-2 space-y-1.5">
            {Object.entries(landmarks).map(([muscle, v])=> (
              <li key={muscle} className="flex items-center gap-2 text-xs">
                <span className="font-bold w-20">{muscle}</span>
                <span className="tabular-nums">{v.avgWeeklySets} sets • {v.band}</span>
                <span className="ml-auto text-ink3">{v.weeks} wks</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dist.totalSets>0 && (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-sm font-bold">Volume distribution</h3>
          <ul className="mt-2 space-y-1">
            {dist.byMuscle.map(d=> (
              <li key={d.muscle} className="flex items-center gap-2 text-xs">
                <span className="w-20 font-semibold">{d.muscle}</span>
                <div className="flex-1 h-2 rounded-full bg-surface2 overflow-hidden"><div className="h-full bg-ink" style={{width:`${d.pct}%`}} /></div>
                <span className="tabular-nums w-12 text-right">{d.pct}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">Personal records — best estimated 1RM (Epley)</h3>
        <p className="text-xs text-ink3">Weight × (1 + reps/30). PRs with ROM/technique changes are not counted as like-for-like.</p>
        {!prs.length ? (
          <p className="text-sm text-ink3 mt-3 border border-dashed border-line rounded-xl p-4 text-center">No loaded sets yet. Log weight to track progressive overload.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {prs.slice(0,8).map(r=> {
              const conf = strengthSeriesWithConfidence(history, r.exerciseId);
              return (
                <li key={r.exerciseId} className="flex items-center gap-3 text-sm border border-line rounded-xl px-3 py-2 bg-surface2">
                  <span className="font-bold truncate">{EXERCISE_BY_ID[r.exerciseId]?.name || r.exerciseId}</span>
                  <span className="ml-auto tabular-nums font-black">{Math.round(r.e1rm)} kg</span>
                  <span className="text-xs text-ink3 tabular-nums">{r.weight}×{r.reps} on {r.dateISO}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${conf.confidence==='high'?'bg-emerald-50 border-emerald-200 text-emerald-800':conf.confidence==='medium'?'bg-amber-50 border-amber-200 text-amber-800':'bg-surface border-line text-ink3'}`}>{conf.confidence} trend</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold">Exercise history</h3>
          {!!exerciseOptions.length && (
            <select value={exerciseId || ''} onChange={e=> setSelectedExerciseId(e.target.value)} className="max-w-[58%] rounded-xl border border-line bg-surface2 px-2 py-2 text-xs font-semibold">
              {exerciseOptions.map(id=> <option key={id} value={id}>{EXERCISE_BY_ID[id]?.name || id}</option>)}
            </select>
          )}
        </div>
        {!exerciseSummary ? (
          <p className="text-xs text-ink3">Log an exercise to see its session-by-session history, plateau status and next-step rule.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink3">
              <span><strong className="text-ink">{exerciseSummary.sessions}</strong> exposures</span>
              <span><strong className="text-ink">{exerciseSummary.best?.e1rm ? `${exerciseSummary.best.e1rm}kg` : '—'}</strong> best e1RM</span>
              <span><strong className="text-ink">{exerciseSummary.trend.confidence}</strong> trend confidence</span>
              <span className={plateau?.detected ? 'font-bold text-amber-800' : ''}>{plateau?.detected ? 'Plateau detected' : plateau?.status === 'fatigue' ? 'Fatigue signal' : 'No plateau'}</span>
            </div>
            <p className="text-xs text-ink3">{plateau?.reason || 'Keep logging consistent sets before judging a plateau.'}</p>
            <div className="rounded-xl border border-line bg-surface2 px-3 py-2">
              <p className="text-xs font-bold">Next step: {exerciseSummary.recommendation.reason}</p>
              <details className="mt-1">
                <summary className="text-[11px] font-semibold cursor-pointer">Show the rule and evidence</summary>
                <p className="text-[11px] text-ink3 mt-1">{exerciseSummary.recommendation.rule}</p>
                <ul className="mt-1 space-y-0.5 text-[11px] text-ink3">
                  {exerciseSummary.recommendation.evidence.map((item, index)=> <li key={index}>• {item}</li>)}
                </ul>
              </details>
            </div>
            <ul className="space-y-1.5">
              {exerciseSummary.rows.slice(-5).reverse().map(row=> (
                <li key={row.sessionId || `${row.dateISO}-${row.title}`} className="flex items-center gap-2 text-xs border border-line rounded-xl px-3 py-2 bg-surface2">
                  <span className="font-bold tabular-nums w-20">{row.dateISO}</span>
                  <span>{row.sets} sets • {row.volumeKg}kg</span>
                  <span className="ml-auto text-ink3">{row.best ? `${row.best.weightKg ? `${row.best.weightKg}kg × ` : ''}${row.best.reps}` : 'no loaded best'}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {noteRecs.length>0 && (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-sm font-bold">Notes → next recommendations</h3>
          <p className="text-xs text-ink3">Extracted from your session notes — review and apply next time you train that movement.</p>
          <ul className="mt-2 space-y-1.5">
            {noteRecs.slice(-5).map((r,i)=> (
              <li key={i} className="text-xs border border-line rounded-xl px-3 py-2 bg-surface2">
                <span className="font-bold">{r.dateISO}</span> — {r.hints.join(', ')} <span className="text-ink3">“{r.note.slice(0,80)}”</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold">Deload logic check</h3>
          <span className={`text-[11px] font-bold px-2 py-1 rounded-full border ${deloadValidation.decision.yes ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-surface2 border-line text-ink3'}`}>{deloadValidation.decision.yes ? 'consider deload' : 'hold'} </span>
        </div>
        <p className="text-xs text-ink3">{deloadValidation.decision.reason}</p>
        <p className="text-[11px] text-ink3">Signals: {deloadValidation.decision.signals.length ? deloadValidation.decision.signals.join(' • ') : 'none'} • {deloadValidation.note}</p>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold">Historical recommendation backtest</h3>
          <span className="text-[11px] font-bold px-2 py-1 rounded-full border border-line bg-surface2">{calibration.status}</span>
        </div>
        <p className="text-xs text-ink3">{calibration.backtest?.comparisons || 0} point-in-time comparisons. Future sessions are hidden while each recommendation is reconstructed; observed outcomes are scored afterward.</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span>{calibration.backtest?.metrics?.loadRecommendationError?.meanAbsKg == null ? '—' : `${calibration.backtest.metrics.loadRecommendationError.meanAbsKg}kg load MAE`}</span>
          <span>{calibration.backtest?.metrics?.repRecommendationError?.meanAbsReps == null ? '—' : `${calibration.backtest.metrics.repRecommendationError.meanAbsReps} rep MAE`}</span>
          <span>{calibration.backtest?.metrics?.completionProbability?.brier == null ? '—' : `completion Brier ${calibration.backtest.metrics.completionProbability.brier}`}</span>
          <span>{calibration.backtest?.metrics?.progressionTiming?.actionAgreement == null ? '—' : `${Math.round(calibration.backtest.metrics.progressionTiming.actionAgreement * 100)}% timing agreement`}</span>
          <span className="text-ink3">{calibration.backtest?.calibration?.empiricalReplacementCount || 0} empirical replacements</span>
        </div>
        <div className="text-[11px] text-ink3 space-y-1">
          <p>Plateau accuracy: {calibration.backtest?.metrics?.plateauClassification?.accuracy == null ? '—' : `${Math.round(calibration.backtest.metrics.plateauClassification.accuracy * 100)}%`} • bad-session Brier: {calibration.backtest?.metrics?.fatigueClassification?.brier == null ? '—' : calibration.backtest.metrics.fatigueClassification.brier}</p>
          <p>Deload evidence: {calibration.backtest?.metrics?.deloadRecommendation?.evaluable || 0} observed volume cuts • missed-session recovery: {calibration.backtest?.metrics?.missedSessionRecovery?.available ? `${Math.round((calibration.backtest.metrics.missedSessionRecovery.sequenceAdherence || 0) * 100)}% sequence adherence` : 'schedule not supplied'}</p>
          <p>{calibration.backtest?.calibration?.note || calibration.note}</p>
        </div>
      </section>

      {evaluation && evaluation.totalRecords > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold">Real-world validation (longitudinal)</h3>
            <span className="text-[11px] font-bold px-2 py-1 rounded-full border border-line bg-surface2">{evaluation.resolvedCount ?? `${evaluation.overall.resolved}/${evaluation.totalRecords}`}</span>
          </div>
          <p className="text-xs text-ink3">{evaluation.overall.resolved} resolved recommendation→outcome pair{evaluation.overall.resolved === 1 ? '' : 's'} recorded before each workout. Stored separately from training history; recommendations are never calibrated on future sessions.</p>
          <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5">
            <p className="text-xs font-bold">Overall</p>
            <p className="text-[11px] text-ink3 mt-1">{formatSegment(evaluation.overall)}</p>
          </div>
          <details>
            <summary className="cursor-pointer text-[11px] font-semibold">Segments — training age, movement, equipment, exercise</summary>
            <div className="mt-2 space-y-2 text-[11px] text-ink3">
              {[['By training age', evaluation.byTrainingAge], ['By movement pattern', evaluation.byMovementPattern], ['By equipment', evaluation.byEquipmentClass]].map(([label, groups])=> (
                <div key={label}>
                  <p className="font-bold text-ink">{label}</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {Object.values(groups || {}).map(segment=> (
                      <li key={segment.key}>{segment.key}: {formatSegment(segment)}</li>
                    ))}
                  </ul>
                </div>
              ))}
              {!!Object.keys(evaluation.byExercise || {}).length && (
                <div>
                  <p className="font-bold text-ink">By exercise</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {Object.values(evaluation.byExercise).slice(0, 6).map(segment=> (
                      <li key={segment.key}>{EXERCISE_BY_ID[segment.key]?.name || segment.key}: {formatSegment(segment)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
          <p className="text-[11px] text-ink3">{evaluation.note}</p>
        </section>
      )}

      {history.length ? (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-sm font-bold">Last session summary</h3>
          {(() => {
            const last = [...history].slice().reverse()[0];
            const vol = (last.blocks || []).reduce((acc,b)=> acc + b.sets.reduce((a,s)=> a + (Number(s.reps)||0) * Math.max(0,(Number(s.weightKg)||0)-(Number(s.assistedKg)||0)), 0), 0);
            const sets = (last.blocks || []).reduce((a,b)=> a + b.sets.length, 0);
            return (
              <div className="mt-2 rounded-xl border border-line bg-surface2 px-3 py-3">
                <p className="text-sm font-bold">{last.title} <span className="text-xs text-ink3">• {last.dateISO}</span></p>
                <p className="text-xs text-ink3 mt-1">{sets} sets • {Math.round(vol).toLocaleString()} kg volume • {last.blocks.length} exercises</p>
                <p className="text-xs text-ink3 mt-1">{last.blocks.map(b=> `${EXERCISE_BY_ID[b.exerciseId]?.name || b.exerciseId}: ${b.sets.map(s=> `${s.reps}${s.weightKg?`@${s.weightKg}kg`:''}${s.side?` ${s.side}`:''}`).join(', ')}`).join(' • ')}</p>
                {last.note && <p className="text-xs mt-2 italic">“{last.note}”</p>}
              </div>
            );
          })()}
        </section>
      ) : null}

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">History</h3>
        {!history.length ? <p className="text-sm text-ink3 mt-2">No sessions yet — schedule a program and run it from Today.</p> : (
          <ul className="mt-2 space-y-2 max-h-80 overflow-auto pr-1">
            {[...history].slice().reverse().map(h=> (
              <li key={h.id} className="rounded-xl border border-line bg-surface2 px-3 py-2">
                <p className="text-sm font-bold">{h.title} <span className="text-xs text-ink3">• {h.dateISO} • W{h.week} D{h.day}</span></p>
                <p className="text-xs text-ink3">{h.blocks.map(b=> `${EXERCISE_BY_ID[b.exerciseId]?.name || b.exerciseId}: ${b.sets.map(s=> `${s.reps}${s.weightKg?`@${s.weightKg}kg`:''}${s.side?` ${s.side}`:''}${s.rom?` ${s.rom}`:''}`).join(', ')}`).join(' • ')}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function computePRs(history){
  const best = new Map();
  for(const h of history) for(const b of h.blocks||[]) for(const s of b.sets||[]){
    const w = Number(s.weightKg), r = Number(String(s.reps).match(/\d+/)?.[0] || s.reps);
    if(!(w>0 && r>0)) continue;
    const e1rm = w * (1 + r/30);
    const prev = best.get(b.exerciseId);
    if(!prev || e1rm > prev.e1rm) best.set(b.exerciseId, { exerciseId: b.exerciseId, e1rm, weight: w, reps: r, dateISO: h.dateISO, note: h.note||'' });
  }
  // filter like-for-like only
  const out=[];
  for(const v of best.values()){
    const cls = classifyPR({ priorBestE1rm: 0, newE1rm: v.e1rm, note: v.note, priorNote: '' });
    // keep if not techniqueChange; but for overall PR list we don't have prior to compare, so just check current note
    if(!/rom|depth|technique|assisted|partial/.test((v.note||'').toLowerCase())) out.push(v);
  }
  return out.sort((a,b)=> b.e1rm - a.e1rm);
}
