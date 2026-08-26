import { useMemo, useState } from 'react';
import { EXERCISE_BY_ID } from '../lib/data.js';
import { exposuresFor, runComparativeStudy } from '../lib/study.js';
import { enrollParticipant, enrollmentAudit } from '../lib/studyEnrollment.js';
import { recordEvent } from '../lib/telemetry.js';

const MIN_EXPOSURES = 6;

const ARM_META = {
  arise: {
    label: 'Arise adaptive',
    shortLabel: 'Adaptive',
    detail: 'Reads your RPE, plateaus, noise and recent response.',
    tone: 'bg-ink text-bg',
    bar: 'bg-ink',
  },
  'double-progression': {
    label: 'Double progression',
    shortLabel: 'Simple',
    detail: 'Adds reps through the range, then a small load step.',
    tone: 'bg-surface2 text-ink border-line',
    bar: 'bg-ink3',
  },
};

function percent(value){
  return value == null ? '—' : `${Math.round(Number(value) * 100)}%`;
}

function resultFor(summary, exposureCount, overrideArm){
  const adaptive = summary?.arise;
  const simple = summary?.['double-progression'];
  const conclusive = Boolean(adaptive?.conclusive && simple?.conclusive);
  const adaptiveRate = adaptive?.targetAchievementRate;
  const simpleRate = simple?.targetAchievementRate;
  const adaptiveSuccess = adaptive?.progressionSuccessRate;
  const simpleSuccess = simple?.progressionSuccessRate;
  const adaptiveScore = adaptiveRate ?? adaptiveSuccess;
  const simpleScore = simpleRate ?? simpleSuccess;
  const winner = conclusive && adaptiveScore != null && simpleScore != null
    ? adaptiveScore === simpleScore ? null : adaptiveScore > simpleScore ? 'arise' : 'double-progression'
    : null;
  return {
    adaptive,
    simple,
    conclusive,
    winner,
    exposureCount,
    overrideArm: overrideArm || null,
    metric: adaptiveRate != null && simpleRate != null ? 'target fit' : 'progression success',
    edge: adaptiveScore != null && simpleScore != null ? adaptiveScore - simpleScore : null,
  };
}

function winnerCopy(result){
  if(!result.conclusive) return `Collect ${Math.max(0, MIN_EXPOSURES - result.exposureCount)} more exposure${MIN_EXPOSURES - result.exposureCount === 1 ? '' : 's'} before Arise calls a winner.`;
  if(result.winner === 'arise') return `Adaptive is ahead by ${Math.abs(Math.round((result.edge || 0) * 100))} points on ${result.metric}. Keep it for this movement.`;
  if(result.winner === 'double-progression') return `Simple is ahead by ${Math.abs(Math.round((result.edge || 0) * 100))} points on ${result.metric}. Keep the rule, skip the extra complexity.`;
  return 'The two policies are level so far. Keep testing instead of forcing a winner.';
}

function MetricBar({ label, value, barClass, emphasized = false }){
  const width = value == null ? 0 : Math.max(4, Math.min(100, Math.round(Number(value) * 100)));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className={emphasized ? 'font-bold' : 'text-ink2'}>{label}</span>
        <span className="font-black tabular-nums">{percent(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-surface2 overflow-hidden" aria-hidden="true">
        <div className={`h-full rounded-full transition-all ${barClass}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function ArmCard({ arm, summary, metric, winner }){
  const meta = ARM_META[arm];
  const isWinner = winner === arm;
  return (
    <div className={`rounded-2xl border p-3 ${isWinner ? 'border-success/50 bg-successsoft' : 'border-line bg-surface'}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">{meta.shortLabel}</p>
          <p className="text-sm font-black mt-0.5 truncate">{meta.label}</p>
        </div>
        {isWinner && <span className="ml-auto shrink-0 rounded-full border border-success/40 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-success">winner</span>}
      </div>
      <div className="mt-3 space-y-2.5">
        <MetricBar label="Target fit" value={summary?.targetAchievementRate} barClass={meta.bar} emphasized />
        <MetricBar label="Progression success" value={summary?.progressionSuccessRate} barClass={meta.bar} />
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-ink3">
        <span>{summary?.n || 0} observed transitions</span>
        <span className="tabular-nums">{summary?.meanChangePct == null ? '—' : `${summary.meanChangePct >= 0 ? '+' : ''}${Math.round(summary.meanChangePct * 100)}% avg change`}</span>
      </div>
    </div>
  );
}

export default function ProgressionLabView({ store, setStore }){
  const history = store.history || [];
  const [selectedExerciseId, setSelectedExerciseId] = useState('');
  const [message, setMessage] = useState(null);

  const comparative = useMemo(() => {
    try{
      return runComparativeStudy(history, { readinessLog: store.readinessLog || [] });
    }catch{
      return null;
    }
  }, [history, store.readinessLog]);

  const exerciseIds = useMemo(() => {
    const ids = new Set();
    for(const session of history) for(const block of session.blocks || []) if(block?.exerciseId) ids.add(block.exerciseId);
    return [...ids].sort((a, b) => (EXERCISE_BY_ID[a]?.name || a).localeCompare(EXERCISE_BY_ID[b]?.name || b));
  }, [history]);

  const activeExerciseId = exerciseIds.includes(selectedExerciseId) ? selectedExerciseId : exerciseIds[0] || '';
  const exposureCounts = useMemo(() => Object.fromEntries(exerciseIds.map(id => [id, exposuresFor(history, id).length])), [exerciseIds, history]);
  const selectedResult = resultFor(
    comparative?.byExercise?.[activeExerciseId],
    exposureCounts[activeExerciseId] || 0,
    store.progressionOverrides?.[activeExerciseId],
  );
  const tracked = Object.values(exposureCounts).filter(n => n >= MIN_EXPOSURES).length;
  const totalTransitions = comparative?.transitions || 0;
  const enrollment = store.studyEnrollment;
  const audit = enrollmentAudit(enrollment);

  const applyWinner = ()=>{
    if(!activeExerciseId || !selectedResult.winner || enrollment) return;
    const arm = selectedResult.winner;
    setStore(prev => ({
      ...prev,
      progressionOverrides: { ...(prev.progressionOverrides || {}), [activeExerciseId]: arm },
    }));
    setMessage(`${EXERCISE_BY_ID[activeExerciseId]?.name || activeExerciseId} will use ${ARM_META[arm].label}.`);
    try{ recordEvent('lab:decision-applied', { exerciseId: activeExerciseId, arm }); }catch{}
  };

  const clearWinner = ()=>{
    if(!activeExerciseId || enrollment) return;
    setStore(prev => {
      const next = { ...(prev.progressionOverrides || {}) };
      delete next[activeExerciseId];
      return { ...prev, progressionOverrides: next };
    });
    setMessage('Override cleared — Arise is back on its default policy for this movement.');
  };

  const startExperiment = ()=>{
    if(enrollment || !store.activeSchedule || !store.studyParticipantId) return;
    if(store.preferences?.telemetryEnabled !== true){
      setMessage('Enable local measurements in More before starting a clean experiment.');
      return;
    }
    try{
      const nextEnrollment = enrollParticipant({
        participantId: store.studyParticipantId,
        schedule: store.activeSchedule,
      });
      setStore(prev => ({ ...prev, studyEnrollment: nextEnrollment }));
      setMessage('Experiment started — each scheduled exercise now has a frozen policy.');
      recordEvent('lab:enrollment', { exercises: Object.keys(nextEnrollment.assignments || {}).length });
    }catch{
      setMessage('Start a programme with at least one exercise before enrolling.');
    }
  };

  return (
    <div className="px-4 py-5 space-y-4">
      <section className="relative overflow-hidden rounded-3xl bg-ink text-bg p-5 sm:p-6">
        <div className="absolute -right-12 -top-16 h-44 w-44 rounded-full border border-bg/15" aria-hidden="true" />
        <div className="absolute right-4 -bottom-20 h-48 w-48 rounded-full border border-bg/10" aria-hidden="true" />
        <p className="relative text-[11px] font-bold uppercase tracking-[0.24em] text-bg/60">Arise / N-of-1 progression lab</p>
        <h2 className="relative mt-3 max-w-xl text-3xl sm:text-4xl font-black tracking-tight leading-[0.98]">No universal best.<br />Find your best.</h2>
        <p className="relative mt-4 max-w-xl text-sm leading-relaxed text-bg/75">Arise compares its adaptive calls with simple double progression on the same movement history, then lets the evidence choose the policy per exercise.</p>
        <div className="relative mt-5 flex flex-wrap gap-2 text-[11px] font-semibold text-bg/70">
          <span className="rounded-full border border-bg/20 px-2.5 py-1">prior-only replay</span>
          <span className="rounded-full border border-bg/20 px-2.5 py-1">exercise-level readout</span>
          <span className="rounded-full border border-bg/20 px-2.5 py-1">local-first</span>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-reviewsoft text-lg" aria-hidden="true">🧪</div>
          <div className="min-w-0">
            <h3 className="text-sm font-black">Your experiment, not a leaderboard</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink3">Every arm sees only the history that existed before the next exposure. “Target fit” means the prescription matched what you actually achieved; it is not a causal claim about what would have happened under another programme.</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-surface2 px-2 py-2.5"><p className="text-lg font-black tabular-nums">{exerciseIds.length}</p><p className="text-[10px] uppercase tracking-wide text-ink3">movements</p></div>
          <div className="rounded-xl bg-surface2 px-2 py-2.5"><p className="text-lg font-black tabular-nums">{Math.round(totalTransitions)}</p><p className="text-[10px] uppercase tracking-wide text-ink3">transitions</p></div>
          <div className="rounded-xl bg-surface2 px-2 py-2.5"><p className="text-lg font-black tabular-nums">{tracked}</p><p className="text-[10px] uppercase tracking-wide text-ink3">ready to call</p></div>
        </div>
      </section>

      {!history.length && (
        <section className="rounded-2xl border border-review/30 bg-reviewsoft p-4 space-y-2">
          <p className="text-sm font-black">The lab is ready for your first observation.</p>
          <p className="text-xs leading-relaxed text-ink2">Log the same movement six times. Arise will replay both policies against each next exposure and keep the readout honest until there is enough signal to call a winner.</p>
          <div className="flex flex-wrap gap-2 pt-1 text-[11px] font-semibold text-ink3"><span className="rounded-full border border-review/30 bg-surface px-2 py-1">1 · train normally</span><span className="rounded-full border border-review/30 bg-surface px-2 py-1">2 · log the context</span><span className="rounded-full border border-review/30 bg-surface px-2 py-1">3 · compare the readout</span></div>
        </section>
      )}

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink3">Exercise readout</p>
            <h3 className="mt-1 text-base font-black">What works for this movement?</h3>
          </div>
          {exerciseIds.length > 0 && <select value={activeExerciseId} onChange={e => setSelectedExerciseId(e.target.value)} aria-label="Choose exercise for progression lab" className="max-w-[52%] rounded-xl border border-line bg-surface2 px-2.5 py-2 text-xs font-bold"><option value="">Choose exercise</option>{exerciseIds.map(id => <option key={id} value={id}>{EXERCISE_BY_ID[id]?.name || id}</option>)}</select>}
        </div>

        {!activeExerciseId ? (
          <div className="rounded-xl border border-dashed border-line p-5 text-center"><p className="text-sm font-bold">No exercise history yet.</p><p className="mt-1 text-xs text-ink3">Your first completed sessions will appear here automatically.</p></div>
        ) : (
          <>
            <div className="rounded-2xl bg-surface2 p-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-black leading-tight">{EXERCISE_BY_ID[activeExerciseId]?.name || activeExerciseId}</p>
                  <p className="mt-1 text-xs text-ink3">{EXERCISE_BY_ID[activeExerciseId]?.muscle || 'Exercise'} · {selectedResult.exposureCount} of {MIN_EXPOSURES} exposures toward a conclusive read</p>
                </div>
                <span className={`ml-auto shrink-0 rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wide ${selectedResult.conclusive ? 'border-success/40 bg-successsoft text-success' : 'border-review/30 bg-reviewsoft text-review'}`}>{selectedResult.conclusive ? 'conclusive' : 'collecting'}</span>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-surface"><div className="h-full rounded-full bg-ink transition-all" style={{ width: `${Math.min(100, Math.round(selectedResult.exposureCount / MIN_EXPOSURES * 100))}%` }} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ArmCard arm="arise" summary={selectedResult.adaptive} metric="target fit" winner={selectedResult.winner} />
              <ArmCard arm="double-progression" summary={selectedResult.simple} metric="target fit" winner={selectedResult.winner} />
            </div>
            <div className="rounded-xl border border-line bg-surface2 px-3 py-3">
              <p className="text-sm font-bold">{winnerCopy(selectedResult)}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink3">{selectedResult.conclusive ? 'The readout is based on matched transitions, not generic averages. You can keep testing if the gap feels too close to call.' : `Arise waits for ${MIN_EXPOSURES} exposures and ${comparative?.minimumSamples || 5} matched transitions before it changes your policy.`}</p>
            </div>
            {selectedResult.overrideArm && (
              <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-successsoft px-3 py-2 text-xs"><span aria-hidden="true">✓</span><span><strong>Using {ARM_META[selectedResult.overrideArm]?.label}</strong> for this movement.</span><button onClick={clearWinner} className="ml-auto text-[11px] font-bold underline underline-offset-2">Clear</button></div>
            )}
            {!enrollment && selectedResult.winner && !selectedResult.overrideArm && <button onClick={applyWinner} className="btn btn-primary min-h-11 w-full rounded-xl">Use {ARM_META[selectedResult.winner].label} for {EXERCISE_BY_ID[activeExerciseId]?.name || 'this exercise'}</button>}
            {enrollment && <p className="rounded-xl border border-line bg-surface2 px-3 py-2 text-[11px] text-ink3">This install is in a frozen randomized experiment, so policy assignments stay unchanged while outcomes accumulate.</p>}
          </>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink3">Illustrative readout</p><h3 className="mt-1 text-base font-black">Same lifter. Different answer.</h3></div>
          <span className="rounded-full border border-line px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-ink3">example only</span>
        </div>
        <p className="text-xs leading-relaxed text-ink3">Your result will look like this once a movement has enough matched transitions. The values below are a product example, not your data.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <ExampleReadout name="Dumbbell bench" adaptive={79} simple={68} winner="Keep adaptive" />
          <ExampleReadout name="Lateral raise" adaptive={81} simple={84} winner="Use simple" />
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink3">Run a clean experiment</p><h3 className="mt-1 text-base font-black">Freeze the policy, then collect the outcome</h3></div>
        <p className="text-xs leading-relaxed text-ink3">Opt in after local measurement consent and Arise assigns scheduled exercises to adaptive or simple progression. The assignment is balanced and stays frozen, so you are comparing policies you actually followed.</p>
        {enrollment ? (
          <div className="rounded-xl border border-success/30 bg-successsoft px-3 py-2.5 text-xs"><p className="font-bold">Experiment active · {audit.arise} adaptive / {audit.doubleProgression} simple</p><p className="mt-1 text-[11px] text-ink3">Participant identity is pseudonymous and stays on this device.</p></div>
        ) : (
          <button onClick={startExperiment} disabled={!store.activeSchedule || !exerciseIds.length} className="btn btn-secondary min-h-11 w-full rounded-xl disabled:opacity-40">{store.activeSchedule ? 'Start randomized exercise experiment' : 'Start a programme to enroll'}</button>
        )}
        {message && <p role="status" aria-live="polite" className="rounded-xl border border-line bg-surface2 px-3 py-2 text-xs">{message}</p>}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <details>
          <summary className="cursor-pointer text-sm font-bold">How the lab stays honest</summary>
          <ul className="mt-3 space-y-2 text-xs text-ink3">
            <li><strong className="text-ink">Prior-only.</strong> A recommendation can only see sessions logged before the exposure it is scored against.</li>
            <li><strong className="text-ink">Per exercise.</strong> A policy can win on dumbbell bench and lose on lateral raises without averaging the difference away.</li>
            <li><strong className="text-ink">Sample gates.</strong> Sparse history stays “collecting,” not a confident percentage.</li>
            <li><strong className="text-ink">No counterfactual claims.</strong> Replay measures target fit; a clean randomized run is the path to stronger evidence.</li>
          </ul>
        </details>
      </section>
    </div>
  );
}

function ExampleReadout({ name, adaptive, simple, winner }){
  return (
    <div className="rounded-2xl border border-line bg-surface2 p-3">
      <div className="flex items-center justify-between gap-2"><p className="text-sm font-black">{name}</p><span className="text-[10px] font-bold uppercase tracking-wide text-success">{winner}</span></div>
      <div className="mt-3 space-y-2">
        <div className="flex items-center gap-2 text-[11px]"><span className="w-24 text-ink3">Adaptive</span><div className="h-2 flex-1 rounded-full bg-surface"><div className="h-full rounded-full bg-ink" style={{ width: `${adaptive}%` }} /></div><span className="w-8 text-right font-black tabular-nums">{adaptive}%</span></div>
        <div className="flex items-center gap-2 text-[11px]"><span className="w-24 text-ink3">Simple</span><div className="h-2 flex-1 rounded-full bg-surface"><div className="h-full rounded-full bg-ink3" style={{ width: `${simple}%` }} /></div><span className="w-8 text-right font-black tabular-nums">{simple}%</span></div>
      </div>
      <p className="mt-3 text-[11px] text-ink3">12-week target achievement · illustrative</p>
    </div>
  );
}

