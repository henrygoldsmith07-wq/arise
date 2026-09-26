import { lazy, Suspense, useMemo, useState } from 'react';
import { STUDY_ARMS } from '../../lib/study.js';
import { enrollmentAudit } from '../../lib/studyEnrollment.js';
import { isValidStudyParticipantId } from '../../lib/studyIdentity.js';
import { participationCopy, participationStatus, studyEligibility } from '../../lib/participation.js';
import { buildEvidenceSnapshot, exportStudyDataFile, joinEvidenceStudy, withdrawEvidenceStudy } from '../../services/evidenceService.js';
import { useTransientMessage } from '../../hooks/useTransientMessage.js';

const EvidenceDashboard = lazy(()=> import('../EvidenceDashboard.jsx'));

export default function EvidenceSettings({ store, setStore }){
  const [open,setOpen]=useState(false);
  const { message, flash } = useTransientMessage();
  const data = useMemo(()=> {
    if(!open || store.preferences?.telemetryEnabled !== true) return null;
    try{ return buildEvidenceSnapshot(store); }catch{ return null; }
  },[open,store]);
  const summary = data ? `${data.coverage.totalResolved} pairs · ${data.coverage.exercisesTracked} exercises` : '';
  const pair = data?.comparative?.pairedVsArise?.['double-progression'];
  const pairedLine = pair?.pairs
    ? `Paired vs double progression on ${pair.pairs} shared sessions: Arise met target where it didn't ${pair.ariseWins}×; baseline won ${pair.baselineWins}× (both met ${pair.bothMetTarget}, neither ${pair.neitherMetTarget}).`
    : '';
  const status = participationStatus(store);
  const eligibility = studyEligibility(store);
  const audit = status === 'enrolled' ? enrollmentAudit(store.studyEnrollment) : null;

  const join = ()=>{
    try{
      setStore(joinEvidenceStudy(store));
      flash(status === 'withdrawn' ? 'Rejoined the study — same pseudonymous id, same deterministic assignment.' : 'Joined the study — pseudonymous, on this device only.');
    }catch(err){ flash(`Could not enroll: ${String(err?.message || err)}`); }
  };
  const withdraw = ()=>{
    if(!confirm('Withdraw from the study?\n\nNew workouts stop getting study assignments (the normal engine takes over).\nEverything already recorded — sessions, measurements, export history — stays on this device exactly as it is.\n\nNote: files you already sent to the study team are copies the app cannot reach. Deleting local data never removes them; ask the study team to delete their copies if you want that.\n\nDeleting local data is a separate action and is never done by withdrawing.')) return;
    setStore(withdrawEvidenceStudy(store));
    flash('Withdrawn — new workouts are study-free; recorded history preserved.');
  };
  const exportStudy = async()=>{
    flash('Preparing study export…');
    try{
      await exportStudyDataFile(store);
      flash('Study data exported — send this file to the study team.');
    }catch(err){ flash(String(err?.message || err)); }
  };

  return (
    <section id="sec-evidence" className="rounded-2xl border border-line bg-surface p-4 space-y-2">
      <h3 className="text-sm font-bold">Progression evidence</h3>
      <p className="text-xs text-ink3">Arise records each recommendation before the workout (with your measurement consent) and scores it against what you actually did next — compared against simple double progression, linear progression and a flat baseline on the same sessions.</p>
      <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2" aria-label="Real-world study onboarding">
        <p className="text-xs font-bold">Take part in the real-world study</p>
        <p className="text-[11px] text-ink3">
          Who can join: anyone training with Arise who has measurement consent on and at least 3 logged workouts. What the study keeps: the target shown before each workout and what you actually did next, structured readiness check-ins, and logging timing — never your name, health-platform data, or free-text notes. Nothing leaves this device unless you export it yourself. Pseudonymous participant id:{' '}
          <span className="font-semibold text-ink2">{isValidStudyParticipantId(store.studyParticipantId) ? `${String(store.studyParticipantId).slice(0, 8)}…` : 'created when you join'}</span>
        </p>
        {status === 'enrolled' ? (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-success">✓ Current status: enrolled{audit?.ok ? '' : ' (assignment audit needs review)'} — new workouts get frozen arm assignments.</p>
            <details className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
              <summary className="text-[11px] font-semibold cursor-pointer">How to take part &amp; export</summary>
              <ul className="text-[11px] text-ink3 list-disc pl-4 mt-1 space-y-0.5">
                <li>Train as normal — enrolment never changes what a good workout looks like.</li>
                <li>Once a week, export study data below; repeated exports fold into one participant.</li>
                <li>Everything stays on this device between exports; nothing uploads by itself.</li>
              </ul>
            </details>
            <details className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
              <summary className="text-[11px] font-semibold cursor-pointer">What a study export contains</summary>
              <ul className="text-[11px] text-ink3 list-disc pl-4 mt-1 space-y-0.5">
                <li>Workout structure and performance: exercises, sets, reps, load, RPE, completed/skipped/failed, structured pain flags, session mode and duration.</li>
                <li>Recommendation evidence: the target that was shown, whether you met it, and any overrides.</li>
                <li>Readiness check-ins, structured only: date, score, sleep, soreness, motivation.</li>
                <li>Logging/timing measurements: how long sets took to log. Programme adjustment metadata: why the app substituted or adapted an exercise (written by the app, not you).</li>
                <li>Study metadata: your pseudonymous ID, study status, enrollment and export date.</li>
              </ul>
              <p className="text-[11px] text-ink3 mt-1">Never included: free-text notes/session titles, onboarding profile, custom templates, health-platform data, crash diagnostics, or credentials.</p>
            </details>
            <button onClick={exportStudy} className="btn btn-primary min-h-9 rounded-lg px-2.5 text-[11px]">Export study data</button>
            <button onClick={withdraw} className="btn btn-secondary min-h-9 rounded-lg px-2.5 text-[11px]">Withdraw from the study</button>
          </div>
        ) : status === 'withdrawn' ? (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-ink2">Current status: withdrawn.</p>
            <p className="text-[11px] text-ink3">New workouts run on the normal engine with no study assignments. Recorded observations remain local until separately deleted.</p>
            {eligibility.eligible && <button onClick={join} className="btn btn-secondary min-h-9 rounded-lg px-2.5 text-[11px]">Rejoin the study</button>}
          </div>
        ) : eligibility.problems.length ? (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold text-ink2">Current status: not yet eligible</p>
            <ul className="text-[11px] text-ink3 list-disc pl-5 space-y-0.5" aria-label="Study eligibility">{eligibility.problems.map((reason,i)=> <li key={i}>{reason}</li>)}</ul>
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-ink2">Current status: eligible to join</p>
            <button onClick={join} className="btn btn-primary min-h-9 rounded-lg px-3 text-[11px]">Join the study</button>
          </div>
        )}
        <p className="text-[11px] text-ink3">{participationCopy(store)}</p>
        <p className="text-[11px] text-ink3">Until enough participants and sessions exist, reports say <span className="font-semibold">“Insufficient real-user evidence”</span> and rank nothing — synthetic tests are never presented as real-world results.</p>
        {message && <p role="status" className="text-[11px] font-semibold text-ink2">{message}</p>}
      </div>

      {store.preferences?.telemetryEnabled !== true ? (
        <p className="text-xs text-ink3">Enable local measurements above to start collecting recommendation→outcome pairs. Pairs stay on this device and are included in your backup file.</p>
      ) : (
        <details className="rounded-xl border border-line bg-surface2 px-3 py-2" onToggle={e=> setOpen(e.currentTarget.open)}>
          <summary className="text-sm font-semibold cursor-pointer">Study status{summary ? ` — ${summary}` : ''}</summary>
          {data && (
            <div className="mt-3 space-y-3">
              <Suspense fallback={null}><EvidenceDashboard records={data.ledger || []} archivedCount={data.archivedCount} /></Suspense>
              <div>
                <p className="text-xs font-bold">Coverage</p>
                <p className="text-[11px] text-ink3 mt-1">{data.coverage.totalResolved} resolved pairs · {data.coverage.openRecords} awaiting their workout · {data.coverage.exercisesTracked} exercises tracked. Segments need {data.coverage.minimumSamples}+ pairs to conclude.</p>
                {!!data.coverage.gaps.length && <ul className="text-[11px] text-ink3 list-disc pl-4 mt-1">{data.coverage.gaps.slice(0,3).map(gap=> <li key={`${gap.dimension}-${gap.key}`}>{gap.dimension === 'exercise' ? gap.key : `${gap.key} experience`}: needs {gap.deficit} more</li>)}</ul>}
              </div>
              <div>
                <p className="text-xs font-bold">Replay comparison ({data.comparative?.transitions || 0} transitions)</p>
                <div className="mt-1 space-y-1" role="table" aria-label="Progression arm comparison">
                  {STUDY_ARMS.map(arm=> {
                    const row = data.comparative?.overall?.[arm];
                    if(!row) return null;
                    const pct = value=> value == null ? '—' : `${Math.round(value * 100)}%`;
                    return <div key={arm} role="row" className="flex items-center gap-2 text-[11px]">
                      <span className="font-semibold w-36 truncate" role="cell">{arm}</span>
                      <span role="cell" className="text-ink3">met {pct(row.targetAchievementRate)} · success {pct(row.progressionSuccessRate)} · over-conservative {pct(row.unnecessaryConservatismRate)}</span>
                      <span className={`ml-auto px-1.5 py-0.5 rounded-full border ${row.conclusive ? 'border-success text-success' : 'border-line text-ink3'}`} role="cell">{row.conclusive ? `n=${row.n}` : `n=${row.n} · inconclusive`}</span>
                    </div>;
                  })}
                </div>
                {pairedLine && <p className="text-[11px] text-ink3 mt-1">{pairedLine}</p>}
              </div>
              <div>
                <p className="text-xs font-bold">Field-study contribution</p>
                <p className="text-[11px] text-ink3 mt-1">{data.fieldStudy.mode === 'enrolled' ? `Enrolled${data.fieldStudy.enrollmentOk ? '' : ' (enrollment needs review)'} · ` : data.fieldStudy.mode === 'observing' ? 'Observing (not enrolled) · ' : 'Off · '}{data.fieldStudy.samples.assigned} assigned transitions (arise {data.fieldStudy.samples.arise} · double progression {data.fieldStudy.samples.doubleProgression}) · {data.fieldStudy.samples.users} users · maturity: {data.fieldStudy.maturity}.</p>
                {!!data.fieldStudy.reasons.length && <p className="text-[11px] text-ink3 mt-1">{data.fieldStudy.reasons.join('; ')}.</p>}
                <p className="text-[11px] text-ink3 mt-1">{data.fieldStudy.note}</p>
              </div>
              <div>
                <p className="text-xs font-bold">Progression model capabilities</p>
                <div className="mt-1 flex flex-wrap gap-1" role="list" aria-label="Progression model capabilities">
                  {(data.model?.capabilities || []).map(cap=> <span key={cap.id} role="listitem" title={cap.detail}
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${cap.status==='active'||cap.status==='ready' ? 'border-success text-success' : cap.status==='existing' ? 'border-line text-ink3' : 'border-review/40 text-review bg-reviewsoft'}`}>{cap.label}: {cap.status}</span>)}
                </div>
                <p className="text-[11px] text-ink3 mt-1">{data.model?.activeOverrideCount > 0 ? `${data.model.activeOverrideCount} exercise-specific override${data.model.activeOverrideCount===1?'':'s'} currently shaping recommendations.` : 'No overrides active — capabilities stay inert until sample gates AND a proven baseline weakness open them.'}{data.model?.autoregulationApplied ? ' Autoregulation band shifted.' : ''}{data.model?.shortBreakEasing ? ' Short-break easing enabled.' : ''}</p>
              </div>
              <p className="text-[11px] text-ink3">Deloads: {data.deloads.decisions} decision{data.deloads.decisions === 1 ? '' : 's'} recorded{data.deloads.cutsObservedRate != null ? ` · volume actually cut in ${Math.round(data.deloads.cutsObservedRate * 100)}% of cases` : ''}. Every arm sees only prior sessions; nothing here feeds back into recommendations.</p>
            </div>
          )}
        </details>
      )}
    </section>
  );
}
