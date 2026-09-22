import { useEffect, useMemo, useState } from 'react';
import { deriveAttributes, levelFromAttributes } from '../lib/attributes.js';
import { totalVolumeKg } from '../lib/store.js';
import { fmtWeight } from '../lib/units.ts';
import { EXERCISE_BY_ID } from '../lib/data.js';
import { weeklyVolume, frequencyByMuscleSync, volumeLandmarks, volumeDistribution, strengthSeriesWithConfidence, extractNoteRecommendations, plannedVsCompletedStats } from '../lib/analytics.js';
import { strengthTrendWithConfidence, classifyPR } from '../lib/progression.js';
import { exerciseHistorySummary, plateauDetection, programAdherence, recommendationCalibration, validateDeloadLogic } from '../lib/programming.js';
import { badSessionAttribution, plateauAttribution } from '../lib/sessionQuality.js';
import { longitudinalSummaryAsync } from '../lib/analyticsWorker.js';
import { isSimpleView, isExpertView } from '../lib/experienceMode.js';
import { milestoneState, trainingAgeDisplay, consistencyInsights, healthyStreak, monthlyDigest, nextBestAction, progressAssessment, whatChangedSummary, coachingCalibration, coachingEvidence, shadowAgreement } from '../lib/product.js';
import { todayISO, sessionForToday, nextSession } from '../lib/schedule.js';
import { missedWorkoutRecovery } from '../lib/programming.js';

export default function ProgressView({ store }){
  const attrs = useMemo(()=> deriveAttributes(store.history), [store.history]);
  const lvl = useMemo(()=> levelFromAttributes(attrs), [attrs]);
  const history = store.history || [];
  // Display-unit preference (kg|lb). Storage/engine stay kg — see units.js.
  const unitsPref = store.preferences?.units === 'lb' ? 'lb' : 'kg';
  const vol = totalVolumeKg(history);
  // Experience gate: display-only — simple hides advanced analytics, expert
  // reveals them; the data underneath is identical and always exportable.
  const simple = isSimpleView(store.preferences);
  const expert = isExpertView(store.preferences);
  const today = todayISO();
  const milestones = useMemo(()=> milestoneState(history), [history]);
  const age = useMemo(()=> trainingAgeDisplay(history, { today }), [history, today]);
  const consistency = useMemo(()=> consistencyInsights(history, { today }), [history, today]);
  const hs = useMemo(()=> healthyStreak(history, { today }), [history, today]);
  const digest = useMemo(()=> monthlyDigest(history, { today, byId: EXERCISE_BY_ID }), [history, today]);
  const todaySess = useMemo(()=> sessionForToday(store.activeSchedule), [store.activeSchedule]);
  const nextSess = useMemo(()=> nextSession(store.activeSchedule), [store.activeSchedule]);
  const recoveryState = useMemo(()=> missedWorkoutRecovery(store.activeSchedule, history, { today }), [store.activeSchedule, history, today]);
  const nba = useMemo(()=> nextBestAction({ store, today, todaySession: todaySess, nextSess, recovery: recoveryState }), [store, today, todaySess, nextSess, recoveryState]);
  const changes = useMemo(()=> whatChangedSummary({ schedule: store.activeSchedule, history }), [store.activeSchedule, history]);
  const prs = useMemo(()=> computePRs(history), [history]);
  const wv = useMemo(()=> weeklyVolume(history), [history]);
  // Evidence-gated “Am I improving?” assessment. Volume is only supporting
  // context inside the assessment; the verdict needs repeated-exercise
  // performance plus prescription follow-through.
  const assessment = useMemo(()=> progressAssessment({ history, schedule: store.activeSchedule, today }), [history, store.activeSchedule, today]);
  const standardSignals = useMemo(()=> (assessment?.signals || []).slice(0, 4), [assessment]);
  const remainingSignals = (assessment?.signals || []).length - standardSignals.length;
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
  // Trend chart with a 95% prediction band: the shaded region is the honest
  // read of the series — a tight band says the trend is real, a wide one says
  // "don't over-read three sessions".
  const trendBand = useMemo(()=> {
    if(!exerciseId) return null;
    const series = strengthSeriesWithConfidence(history, exerciseId);
    const pts = series.pts || [];
    if(pts.length < 2) return null;
    const ys = pts.map(p=> p.e1rm);
    const n = ys.length;
    const mean = ys.reduce((a,b)=> a + b, 0) / n;
    const sd = n > 1 ? Math.sqrt(ys.reduce((a,y)=> a + (y - mean) ** 2, 0) / (n - 1)) : 0;
    const half = 1.96 * sd / Math.sqrt(Math.max(1, n));
    const W = 320, H = 84, pad = 4;
    const min = Math.min(...ys) - 1, max = Math.max(...ys) + 1;
    const xAt = i=> pad + (i / Math.max(1, n - 1)) * (W - 2 * pad);
    const yAt = v=> pad + (1 - (v - min) / Math.max(0.001, max - min)) * (H - 2 * pad);
    const line = pts.map((p,i)=> `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(p.e1rm).toFixed(1)}`).join(' ');
    const band = `M${xAt(0).toFixed(1)},${yAt(mean + half).toFixed(1)} L${xAt(n - 1).toFixed(1)},${yAt(mean + half).toFixed(1)} L${xAt(n - 1).toFixed(1)},${yAt(Math.max(min, mean - half)).toFixed(1)} L${xAt(0).toFixed(1)},${yAt(Math.max(min, mean - half)).toFixed(1)} Z`;
    const r1 = Math.round(ys[0] * 10) / 10, rN = Math.round(ys[n - 1] * 10) / 10;
    const direction = rN - r1 > 0.5 ? 'upward' : rN - r1 < -0.5 ? 'downward' : 'roughly flat';
    return {
      line, band, last: ys[ys.length - 1], mean, half, n,
      // Text alternative for the chart: a one-line read plus a real data
      // table (rendered sr-only) so screen readers get the numbers the SVG
      // shows sighted users.
      first: r1,
      direction,
      summary: `Estimated 1RM moved ${direction} from ${fmtWeight(r1, unitsPref)} to ${fmtWeight(rN, unitsPref)} over ${n} sessions. Mean ${fmtWeight(mean, unitsPref)}, 95% band ±${fmtWeight(half, unitsPref)} — ${half < 1.5 ? 'tight' : 'wide'}.`,
      rows: pts.map((p,i)=> ({ session: i + 1, date: p.dateISO || '', e1rm: Math.round(p.e1rm * 10) / 10 })),
    };
  }, [history, exerciseId, unitsPref]);
  const plateau = useMemo(()=> exerciseId ? plateauDetection(history, exerciseId, { readinessLog: store.readinessLog || [] }) : null, [history, exerciseId, store.readinessLog]);
  const deloadValidation = useMemo(()=> validateDeloadLogic({ history, readinessLog: store.readinessLog || [] }), [history, store.readinessLog]);
  const calibration = useMemo(()=> recommendationCalibration(history, {
    readinessLog: store.readinessLog || [],
    schedule: store.activeSchedule || null,
    profile: { availableEquipment: store.onboarding?.equipment || [] },
  }), [history, store.readinessLog, store.activeSchedule, store.onboarding?.equipment]);
  const badAttribution = useMemo(()=> badSessionAttribution(history, { readinessLog: store.readinessLog || [] }), [history, store.readinessLog]);
  // Longitudinal evaluation runs off the main thread (analyticsWorker): it is
  // the heaviest computation on this screen and previously blocked the first
  // paint of Progress on a long history. The async wrapper resolves to the
  // same shape; until it lands we render '—' (one frame on inline fallback).
  const [longitudinal, setLongitudinal] = useState(null);
  const prefsKey = store.preferences?.telemetryEnabled === true ? 'on' : 'off';
  useEffect(()=> {
    let live = true;
    longitudinalSummaryAsync({ preferences: store.preferences }).then((result)=> { if(live) setLongitudinal(result); });
    return ()=> { live = false; };
  }, [prefsKey]);
  const evaluation = longitudinal?.evaluation || null;
  const coaching = coachingCalibration(longitudinal?.calibration || null);
  const evidence = coachingEvidence(longitudinal?.evaluation?.primaryComparison || null);
  const shadow = shadowAgreement(longitudinal?.fieldComparison || null);
  const fmtPct = v=> v == null ? '—' : `${Math.round(v * 100)}%`;
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
        <p className="text-xs text-ink3">
          {age.months != null
            ? <>Training age <strong className="text-ink">{age.months} months</strong> ({age.phase}) — training since {age.started}. </>
            : 'Your training age starts at the first logged session. '}
          Derived from logged history, not from what you <em>planned</em> to do.
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-ink text-bg grid place-items-center font-black text-lg shrink-0">{lvl.level}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold truncate">Level {lvl.level} — {lvl.title}</p>
          <p className="text-xs text-ink3">Avg {lvl.avg}/100 • {history.length} sessions {adherence.total ? `• ${adherence.done}/${adherence.total} planned done` : ''}</p>
          <div className="mt-2 h-1.5 rounded-full bg-surface2 max-w-48 overflow-hidden"><div className="h-full bg-ink transition-all" style={{width:`${lvl.avg}%`}} /></div>
        </div>
        <div className="ml-auto shrink-0 flex gap-4 text-xs">
          <div>
            <p className="font-bold tabular-nums">{fmtWeight(vol, unitsPref)}</p>
            <p className="text-ink3">volume</p>
          </div>
          <div className="pl-4 border-l border-line">
            <p className="font-bold">{hs.framing}</p>
            <p className="text-ink3">training run{hs.lapsed ? ' — fresh start' : ''}</p>
          </div>
        </div>
      </div>

      {/* ── Am I improving? Evidence-gated verdict, not volume alone ── */}
      {assessment && (
        <section className="rounded-2xl border border-line bg-surface p-4 space-y-2" aria-label="Am I improving">
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">Am I improving?</p>
          <p className="text-sm font-bold">{assessment.title}</p>
          <p className="text-xs text-ink3">{assessment.primaryReason}</p>
          {!simple && assessment.phaseContext && (
            <p className="text-xs text-ink3">{assessment.phaseContext}</p>
          )}
          {!simple && !!standardSignals.length && (
            <ul className="space-y-1">
              {standardSignals.map((signal) => (
                <li key={signal.id} className="text-xs text-ink3">• <span className="font-bold text-ink">{signal.label}</span>{signal.kind === 'volume' ? ' — context only' : ''}<span className="block text-[11px]">{signal.detail}</span></li>
              ))}
            </ul>
          )}
          {!simple && remainingSignals > 0 && !expert && (
            <p className="text-[11px] text-ink3">+{remainingSignals} more signal{remainingSignals === 1 ? '' : 's'} in Expert view.</p>
          )}
          {!simple && (
            <p className="text-[11px] text-ink3">Data coverage: {assessment.coverage} · {assessment.basis}</p>
          )}
          {expert && (
            <details className="rounded-xl border border-line bg-surface2 px-3 py-2">
              <summary className="text-xs font-bold cursor-pointer">Evidence and calculations</summary>
              <ul className="mt-2 space-y-1">
                {(assessment.signals || []).map((signal) => (
                  <li key={`expert-${signal.id}`} className="text-[11px] text-ink3">• <span className="font-bold text-ink">{signal.label}</span> — {signal.detail}</li>
                ))}
                <li className="text-[11px] text-ink3">• Sample: {assessment.sample.sessions} sessions · {assessment.sample.exposures} exposures · {assessment.sample.exercises} repeated exercises · {assessment.sample.targetChecks} prescription checks</li>
                <li className="text-[11px] text-ink3">• Programme phase: {assessment.phase ? `${assessment.phase.kind}${assessment.phase.week != null ? `, week ${assessment.phase.week}` : ''}` : 'no active schedule'}</li>
              </ul>
            </details>
          )}
        </section>
      )}

      {/* ── What changed? Programme adaptations, newest first ── */}
      {changes.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-4 space-y-2" aria-label="What changed">
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">What changed?</p>
          {changes.map((c) => (
            <details key={`${c.kind}-${c.when}`} className="rounded-xl border border-line bg-surface2 px-3 py-2">
              <summary className="text-xs font-bold cursor-pointer">{c.when} ({c.kind})</summary>
              <ul className="mt-2 space-y-1">
                {c.lines.map((line, i) => <li key={i} className="text-[11px] text-ink3">• {line}</li>)}
              </ul>
            </details>
          ))}
          <p className="text-[11px] text-ink3">Every change is a deterministic rule applied to your logged sessions — the reasons are verbatim from the decision that made it.</p>
        </section>
      )}

      {/* ── Next best action: one piece of guidance, never a nag ── */}
      <section className="rounded-2xl border border-line bg-surface p-4 flex items-center gap-3" aria-label="Suggested next step">
        <span aria-hidden className="text-base">🧭</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">Next best action</p>
          <p className="text-sm font-bold truncate">{nba.title}</p>
          <p className="text-xs text-ink3">{nba.detail}</p>
        </div>
      </section>

      {/* ── Milestones: session-count ladder — the number that never lies ── */}
      <section className="rounded-2xl border border-line bg-surface p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold">Milestones</h3>
          <span className="text-xs font-bold tabular-nums px-2 py-1 rounded-full bg-surface2 border border-line">{milestones.count} sessions</span>
        </div>
        {milestones.next ? (
          <>
            <div className="h-1.5 rounded-full bg-surface2 overflow-hidden"><div className="h-full bg-ink transition-all" style={{ width: `${milestones.pctToNext}%` }} /></div>
            <p className="text-xs text-ink3">{milestones.toNext} more to “{milestones.next.emoji} {milestones.next.label}”</p>
          </>
        ) : <p className="text-xs text-ink3">Every milestone on the ladder — remarkable consistency.</p>}
        {!!milestones.reached.length && (
          <ul className="flex flex-wrap gap-1.5 pt-1">
            {milestones.reached.slice(-4).map((m) => (
              <li key={m.id} className="text-[11px] font-semibold rounded-full border border-success/40 bg-success/10 px-2 py-1">{m.emoji} {m.label}</li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Consistency: weeks-with-training, never a guilt score ── */}
      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">Consistency</h3>
        {consistency.rate == null ? (
          <p className="text-xs text-ink3 mt-2">Log your first session and this fills in — weeks with any training, counted kindly.</p>
        ) : (
          <p className="text-xs text-ink3 mt-2">
            Trained in <strong className="text-ink">{consistency.weeksActive} of the last {consistency.weeksElapsed}</strong> week{consistency.weeksElapsed === 1 ? '' : 's'}
            {hs.lapsed ? ' — and any week is a fine week to begin again.' : '.'}
          </p>
        )}
      </section>

      {store.activeSchedule && (
        <section className="rounded-2xl border border-line bg-surface p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold">Programme adherence</h3>
            <span className="text-xs font-black tabular-nums">{programmeAdherence.toDateRate == null ? '—' : `${Math.round(programmeAdherence.toDateRate * 100)}%`}</span>
          </div>
          <p className="text-xs text-ink3">{programmeAdherence.completed} completed • {programmeAdherence.missed} missed • {programmeAdherence.upcoming} upcoming. Future sessions do not lower the rate yet.</p>
          {programmeAdherence.missed > 0 && <p className="text-xs text-ink2 bg-reviewsoft border border-review/30 rounded-xl px-3 py-2">Missed sessions are recoverable in order. Open Today to re-plan the schedule rather than doubling the next workout.</p>}
        </section>
      )}

      {/* ── Monthly digest: last month, facts only ── */}
      {digest && digest.sessions > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-4 space-y-1">
          <h3 className="text-sm font-bold">{digest.month} digest</h3>
          <p className="text-xs text-ink3">
            {digest.sessions} session{digest.sessions === 1 ? '' : 's'} · {digest.sets} sets · {fmtWeight(digest.volume, unitsPref)} volume
            {digest.minutes ? ` · ~${Math.round(digest.minutes / 60 * 10) / 10} h under the bar` : ''}
            {digest.topMuscle ? ` · most-trained: ${digest.topMuscle}` : ''}.
          </p>
          <p className="text-[11px] text-ink3">A month at a glance — no rankings, no streak pressure. Next month is unwritten.</p>
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
            {wv.slice(-8).map(w=>{ const max=Math.max(...wv.map(x=>x.vol),1); const h=Math.max(4, Math.round(w.vol/max*48)); return <div key={w.week} title={`${w.week}: ${fmtWeight(w.vol, unitsPref)} volume`} className="flex-1 rounded bg-ink" style={{height:`${h}px`}} />; })}
          </div>
        )}
        {!!wv.length && <p className="text-xs text-ink3 mt-2">{wv[wv.length-1]?.vol> (wv[wv.length-2]?.vol||0)*1.2 ? `Volume up ${Math.round((wv[wv.length-1].vol/(wv[wv.length-2]?.vol||1)-1)*100)}% vs last week — hold steady or deload if RPE was high.` : wv[wv.length-1]?.vol < (wv[wv.length-2]?.vol||0)*0.8 ? 'Volume dipped — good if planned deload, otherwise add a session.' : 'Trends look steady — keep progressing where RIR ≥2.'}</p>}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <div>
          <h3 className="text-sm font-bold">Training feedback</h3>
          <p className="text-xs text-ink3">Separates a genuine plateau from fatigue or an isolated bad session.</p>
        </div>
        {expert ? (
        <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5">
          <p className="text-xs font-bold">Recent session attribution <span className="font-normal text-ink3">({badAttribution.confidence} confidence)</span></p>
          <p className="text-xs mt-1">{badAttribution.reason}</p>
          {!!badAttribution.evidence?.length && <p className="text-[11px] text-ink3 mt-1">Evidence: {badAttribution.evidence.join(' · ')}</p>}
          <p className="text-[11px] text-ink3 mt-1">Next: {badAttribution.action}</p>
        </div>
        ) : (
          <p className="text-xs text-ink3">{badAttribution.reason} <span className="text-ink3">({badAttribution.confidence} confidence)</span></p>
        )}
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

      {expert && !!Object.keys(landmarks).length && (
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
                  <span className="ml-auto tabular-nums font-black">{fmtWeight(r.e1rm, unitsPref)}</span>
                  <span className="text-xs text-ink3 tabular-nums">{r.weight}×{r.reps} on {r.dateISO}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${conf.confidence==='high'?'bg-successsoft border-success/30 text-success':conf.confidence==='medium'?'bg-reviewsoft border-review/30 text-review':'bg-surface border-line text-ink3'}`}>{conf.confidence} trend</span>
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
              <span><strong className="text-ink">{exerciseSummary.best?.e1rm ? fmtWeight(exerciseSummary.best.e1rm, unitsPref) : '—'}</strong> best e1RM</span>
              <span><strong className="text-ink">{exerciseSummary.trend.confidence}</strong> trend confidence</span>
              <span className={plateau?.detected ? 'font-bold text-review' : ''}>{plateau?.detected ? 'Plateau detected' : plateau?.status === 'fatigue' ? 'Fatigue signal' : 'No plateau'}</span>
            </div>
            <p className="text-xs text-ink3">{plateau?.reason || 'Keep logging consistent sets before judging a plateau.'}</p>
            {trendBand && (
              <figure className="rounded-xl border border-line bg-surface2 px-3 py-2" aria-label="Estimated 1RM trend with 95% confidence band">
                <svg viewBox="0 0 320 84" className="w-full h-20" role="img" aria-hidden="true" focusable="false">
                  <path d={trendBand.band} fill="currentColor" className="text-ink3/20" />
                  <path d={trendBand.line} fill="none" stroke="currentColor" strokeWidth="2" className="text-ink" strokeLinejoin="round" strokeLinecap="round" />
                </svg>
                <details className="mt-1 text-[10px] text-ink3">
                  <summary className="cursor-pointer font-semibold text-ink2">Explore chart data</summary>
                  <p className="mt-1">{trendBand.summary}</p>
                  <div className="overflow-x-auto">
                    <table className="mt-1 w-full text-left">
                      <caption className="sr-only">Estimated 1RM per session</caption>
                      <thead><tr><th scope="col">Session</th><th scope="col">Date</th><th scope="col">e1RM ({unitsPref})</th></tr></thead>
                      <tbody>
                        {trendBand.rows.map(row=> (
                          <tr key={row.session}><th scope="row">{row.session}</th><td>{row.date}</td><td>{fmtWeight(row.e1rm, unitsPref)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
                <figcaption className="text-[10px] text-ink3 mt-1">
                  e1RM per session (last {trendBand.n}), shaded ±95% band around the mean — a wide band means the trend is not yet settled ({trendBand.half < 1.5 ? 'tight' : 'wide'} here).
                </figcaption>
              </figure>
            )}
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
                  <span>{row.sets} sets • {fmtWeight(row.volumeKg, unitsPref)} volume</span>
                  <span className="ml-auto text-ink3">{row.best ? `${row.best.weightKg ? `${fmtWeight(row.best.weightKg, unitsPref)} × ` : ''}${row.best.reps}` : 'no loaded best'}</span>
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

      {expert && (
      <section className="rounded-2xl border border-line bg-surface p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold">Deload logic check</h3>
          <span className={`text-[11px] font-bold px-2 py-1 rounded-full border ${deloadValidation.decision.yes ? 'bg-reviewsoft border-review/30 text-review' : 'bg-surface2 border-line text-ink3'}`}>{deloadValidation.decision.yes ? 'consider deload' : 'hold'} </span>
        </div>
        <p className="text-xs text-ink3">{deloadValidation.decision.reason}</p>
        <p className="text-[11px] text-ink3">Signals: {deloadValidation.decision.signals.length ? deloadValidation.decision.signals.join(' • ') : 'none'} • {deloadValidation.note}</p>
      </section>
      )}

      {expert && (
      <section className="rounded-2xl border border-line bg-surface p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold">Historical recommendation backtest</h3>
          <span className="text-[11px] font-bold px-2 py-1 rounded-full border border-line bg-surface2">{calibration.status}</span>
        </div>
        <p className="text-xs text-ink3">{calibration.backtest?.comparisons || 0} point-in-time comparisons, replayed against <strong className="text-ink">your own logged history</strong>. Future sessions are hidden while each recommendation is reconstructed; observed outcomes are scored afterward.</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span>{calibration.backtest?.metrics?.loadRecommendationError?.meanAbsKg == null ? '—' : `${fmtWeight(calibration.backtest.metrics.loadRecommendationError.meanAbsKg, unitsPref)} load MAE`}</span>
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
      )}

      {longitudinal?.calibration && (
        <section className="rounded-2xl border border-line bg-surface p-4 space-y-2" aria-label="Coaching calibration">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold">Coaching calibration</h3>
            <span className={`text-[11px] font-bold px-2 py-1 rounded-full border ${coaching.active ? 'bg-successsoft border-success/30 text-ink' : 'bg-surface2 border-line text-ink3'}`}>{coaching.active ? 'calibrated' : 'gathering'}</span>
          </div>
          <p className="text-xs text-ink3">{coaching.headline}</p>
          <p className="text-[11px] text-ink3">{coaching.detail}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
            <span>{coaching.observed} prospective</span>
            <span>{coaching.resolved} outcomes</span>
            <span>success {fmtPct(coaching.successRate)}</span>
            <span>{coaching.overRate != null ? `${Math.round(coaching.overRate * 100)}% too-fast` : 'tendency —'}</span>
            <span>{coaching.underRate != null ? `${Math.round(coaching.underRate * 100)}% too-safe` : ''}</span>
            <span className="text-ink3">confidence {coaching.confidenceQuality}</span>
          </div>
          {expert && (
          <details className="rounded-xl border border-line bg-surface2 px-3 py-2">
            <summary className="text-[11px] font-bold cursor-pointer">Segment calibration (prospective only)</summary>
            <div className="mt-2 space-y-2 text-[11px] text-ink3">
              <p><span className="font-bold text-ink">By confidence</span></p>
              {Object.values(longitudinal.calibration.byConfidenceBand || {}).filter(seg=> seg.conclusive).slice(0, 6).map(seg=> (
                <p key={seg.key}>{seg.key}: {Math.round((seg.successRate||0)*100)}% success • {Math.round((seg.overPrescriptionRate||0)*100)}% over • {Math.round((seg.underPrescriptionRate||0)*100)}% under • err {seg.calibrationError ?? '—'} • n={seg.sampleSize}</p>
              ))}
              <p><span className="font-bold text-ink">By experience</span></p>
              {Object.values(longitudinal.calibration.byExperience || {}).filter(seg=> seg.conclusive).slice(0, 6).map(seg=> (
                <p key={seg.key}>{seg.key}: {Math.round((seg.successRate||0)*100)}% success • n={seg.sampleSize}</p>
              ))}
              <p>Excluded reconstructed/imported recommendations: {longitudinal.calibration.excludedReconstructed || 0}. Rates below {longitudinal.calibration.minimumSamples} pairs are withheld and shrunk toward the default.</p>
            </div>
          </details>
          )}
          <p className="text-[11px] text-ink3">{coaching.note}</p>
        </section>
      )}

      {expert && longitudinal?.evaluation?.primaryComparison && (
        <section className="rounded-2xl border border-line bg-surface p-4 space-y-2" aria-label="Coaching evidence">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold">Coaching evidence</h3>
            <span className={`text-[11px] font-bold px-2 py-1 rounded-full border ${evidence.status === 'descriptive' ? 'bg-successsoft border-success/30 text-ink' : 'bg-surface2 border-line text-ink3'}`}>{evidence.status}</span>
          </div>
          <div className="space-y-1">
            {evidence.lines.map(line=> (
              <p key={line} className="text-xs text-ink3">{line}</p>
            ))}
          </div>
          <p className="text-[11px] text-ink3">Across {evidence.users} assigned user{evidence.users === 1 ? '' : 's'} · {evidence.observed} assigned transitions. Assigned-arm comparison, personal calibration, retrospective replay and shadow agreement are different sources — they are never mixed.</p>
          <details className="rounded-xl border border-line bg-surface2 px-3 py-2">
            <summary className="text-[11px] font-bold cursor-pointer">Evidence sources</summary>
            <div className="mt-2 space-y-1 text-[11px] text-ink3">
              <p><span className="font-bold text-ink">Assigned.</span> {evidence.evidenceKinds.assigned}</p>
              <p><span className="font-bold text-ink">Personal.</span> {evidence.evidenceKinds.personal}</p>
              <p><span className="font-bold text-ink">Replay.</span> {evidence.evidenceKinds.replay}</p>
              <p><span className="font-bold text-ink">Shadow.</span> {evidence.evidenceKinds.shadow}</p>
              <p><span className="font-bold text-ink">External.</span> {evidence.evidenceKinds.external}</p>
              {evidence.note && <p>{evidence.note}</p>}
            </div>
          </details>
          {longitudinal?.fieldComparison && (
          <details className="rounded-xl border border-line bg-surface2 px-3 py-2">
            <summary className="text-[11px] font-bold cursor-pointer">Prescription difficulty / decision agreement (secondary diagnostic)</summary>
            <div className="mt-2 space-y-1 text-[11px] text-ink3">
              <p>{shadow.label}</p>
              {shadow.lines.map(line=> (
                <p key={line}>{line}</p>
              ))}
              {shadow.realised && (
                <p>Realised difficulty on those transitions: failed-set rate {shadow.realised.failedSetRate == null ? '—' : `${Math.round(shadow.realised.failedSetRate * 100)}%`} · over-prescribed {shadow.realised.overPrescriptionShare == null ? '—' : `${Math.round(shadow.realised.overPrescriptionShare * 100)}%`} / under-prescribed {shadow.realised.underPrescriptionShare == null ? '—' : `${Math.round(shadow.realised.underPrescriptionShare * 100)}%`}.</p>
              )}
            </div>
          </details>
          )}
        </section>
      )}

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
                <p className="text-xs text-ink3 mt-1">{sets} sets • {fmtWeight(Math.round(vol), unitsPref)} volume • {last.blocks.length} exercises</p>
                <p className="text-xs text-ink3 mt-1">{last.blocks.map(b=> `${EXERCISE_BY_ID[b.exerciseId]?.name || b.exerciseId}: ${b.sets.map(s=> `${s.reps}${s.weightKg?`@${fmtWeight(s.weightKg, unitsPref)}`:''}${s.side?` ${s.side}`:''}`).join(', ')}`).join(' • ')}</p>
                {last.note && <p className="text-xs mt-2 italic">“{last.note}”</p>}
              </div>
            );
          })()}
        </section>
      ) : null}

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">History</h3>
        {!history.length ? <p className="text-sm text-ink3 mt-2">No sessions yet — schedule a program and run it from Today.</p> : (
          <SessionHistoryList history={history} />
        )}
      </section>
    </div>
  );
}

// History, newest first, paginated: render HISTORY_PAGE sessions at a time and
// append on demand. A year of training is 150+ sessions whose set summaries
// are expensive JSX; mounting all of them up front stalls the Progress tab
// exactly when it already runs its evaluation. (max-h-80 scroll kept.)
const HISTORY_PAGE = 15;

function SessionHistoryList({ history }){
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE);
  const visible = useMemo(()=> [...history].slice(-visibleCount).reverse(), [history, visibleCount]);
  const remaining = Math.max(0, history.length - visibleCount);
  return (
    <div>
      <p className="text-[11px] text-ink3 mt-1" role="status">Showing {visible.length} of {history.length} sessions</p>
      <ul className="mt-2 space-y-2 max-h-80 overflow-auto pr-1">
        {visible.map(h=> (
          <li key={h.id} className="rounded-xl border border-line bg-surface2 px-3 py-2">
            <p className="text-sm font-bold">{h.title} <span className="text-xs text-ink3">• {h.dateISO} • W{h.week} D{h.day}</span></p>
            <p className="text-xs text-ink3">{h.blocks.map(b=> `${EXERCISE_BY_ID[b.exerciseId]?.name || b.exerciseId}: ${b.sets.map(s=> `${s.reps}${s.weightKg?`@${fmtWeight(s.weightKg, unitsPref)}`:''}${s.side?` ${s.side}`:''}${s.rom?` ${s.rom}`:''}`).join(', ')}`).join(' • ')}</p>
          </li>
        ))}
      </ul>
      {remaining > 0 && (
        <button onClick={()=> setVisibleCount(c=> c + HISTORY_PAGE)} className="mt-2 w-full btn btn-secondary min-h-10 rounded-xl text-xs font-bold">
          Load {Math.min(HISTORY_PAGE, remaining)} older sessions ({remaining} hidden)
        </button>
      )}
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
