import { useRef, useState } from 'react';
import { buildExportPayload, downloadJson, parseImportFile, mergeStores, portableCsv, deletionPreview } from '../lib/export.js';
import { clearStore } from '../lib/store.js';
import { clearTelemetry, telemetrySummary, getEventHistory, mergeEventHistory, replaceEventHistory, recordEvent } from '../lib/telemetry.js';
import { mergeHealthSummary, pullHealthSummary } from '../lib/health.js';
import { LOCATIONS, GOALS } from '../lib/data.js';
import { loadEvaluationLedger } from '../lib/longitudinal.js';
import { STUDY_ARMS, studyCoverage, runComparativeStudy, collectDeloadDecisions, validateDeloadDecisions } from '../lib/study.js';

export default function MoreView({ store, setStore, setTab, onboardingOpen, setOnboardingOpen }){
  const [importStrategy,setImportStrategy]=useState('merge');
  const [msg,setMsg]=useState(null);
  const fileRef = useRef(null);
  const [showTelemetry,setShowTelemetry]=useState(false);
  const [healthMsg,setHealthMsg]=useState(null);
  const [evidenceOpen,setEvidenceOpen]=useState(false);

  // Computed lazily — only while the study details panel is open.
  let evidenceData = null;
  let evidenceSummary = '';
  let pairedLine = '';
  if(evidenceOpen && store.preferences?.telemetryEnabled === true){
    try{
      const coverage = studyCoverage(loadEvaluationLedger());
      evidenceSummary = `${coverage.totalResolved} pairs · ${coverage.exercisesTracked} exercises`;
      let comparative = null;
      try{ comparative = runComparativeStudy(store.history || []); }catch{}
      const deloads = validateDeloadDecisions(collectDeloadDecisions([store.activeSchedule]), store.history || []);
      const pair = comparative?.pairedVsArise?.['double-progression'];
      if(pair?.pairs){
        pairedLine = `Paired vs double progression on ${pair.pairs} shared sessions: Arise met target where it didn't ${pair.ariseWins}×; baseline won ${pair.baselineWins}× (both met ${pair.bothMetTarget}, neither ${pair.neitherMetTarget}).`;
      }
      evidenceData = { coverage, comparative, deloads };
    }catch{ evidenceSummary = 'unavailable'; }
  }

  const healthAdapter = typeof window !== 'undefined' ? window.__ARISE_HEALTH_ADAPTER__ : null;

  const exportNow = ()=>{
    const payload = buildExportPayload(store);
    const date = new Date().toISOString().slice(0,10);
    downloadJson(`arise-backup-${date}.json`, payload);
    setMsg('Export downloaded — keep it somewhere safe.');
    setTimeout(()=> setMsg(null), 3000);
  };
  const exportCsv = ()=>{
    const csv = portableCsv(store.history||[]);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`arise-history-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    setTimeout(()=> URL.revokeObjectURL(url), 2000);
  };

  const exportEvents = ()=>{
    const date=new Date().toISOString().slice(0,10);
    downloadJson(`arise-event-history-${date}.json`, { app:'arise', version:3, exportedAt:new Date().toISOString(), eventHistory:getEventHistory() });
    setMsg('Event history exported — it stays on your device unless you share the file.');
    setTimeout(()=> setMsg(null), 3000);
  };

  const onPickFile = async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    const text = await file.text();
    try{
      const imported = parseImportFile(text);
      const merged = mergeStores(store, imported, importStrategy);
      if(importStrategy==='replace') replaceEventHistory(imported.eventHistory || []);
      else if(imported.eventHistory?.length) mergeEventHistory(imported.eventHistory);
      setStore({ ...merged, eventHistory:getEventHistory() });
      setMsg(importStrategy==='replace' ? 'Backup restored — replaced this device.' : 'Backup merged — history combined.');
    }catch(err){
      setMsg(String(err.message || err));
    }finally{
      e.target.value='';
      setTimeout(()=> setMsg(null), 4000);
    }
  };

  const reset = ()=>{
    if(!confirm('Clear all local data on this device? This cannot be undone unless you have an export.')) return;
    clearStore(); clearTelemetry();
    location.reload();
  };
  const deleteAccount = ()=>{
    const preview = deletionPreview(store);
    if(!confirm(`Delete all Arise data on this device?\n\nHistory: ${preview.historyCount} sessions\nSchedule: ${preview.schedulePresent?'yes':'no'}\nOnboarding: ${preview.onboardingPresent?'yes':'no'}\nReadiness: ${preview.readinessCount} entries\n\nThis cannot be undone.`)) return;
    clearStore(); clearTelemetry();
    location.reload();
  };

  const setTelemetryConsent=(enabled)=>{
    setStore({ ...store, preferences:{ ...(store.preferences||{}), telemetryEnabled:enabled } });
    recordEvent('consent:local-measurements', { enabled }, { essential:true });
    setMsg(enabled ? 'Local measurements enabled.' : 'Local measurements disabled. Existing history remains on this device.');
    setTimeout(()=> setMsg(null), 3000);
  };

  const setPulseConsent=(enabled)=>{
    setStore({ ...store, preferences:{ ...(store.preferences||{}), pulseEnabled:enabled } });
    recordEvent('consent:pulse', { enabled }, { essential:true });
    setMsg(enabled ? 'Pulse sharing enabled. Arise will only push completed workouts.' : 'Pulse sharing disabled.');
    setTimeout(()=> setMsg(null), 3000);
  };

  const setHealthConsent=(enabled)=>{
    setStore({ ...store, preferences:{ ...(store.preferences||{}), healthSummaryEnabled:enabled }, healthSummary:enabled ? store.healthSummary : null });
    recordEvent('consent:health-summary', { enabled }, { essential:true });
    setHealthMsg(enabled ? 'Health summary import enabled.' : 'Health summary disabled and its saved summary removed.');
  };

  const importHealthSummary=async()=>{
    if(!store.preferences?.healthSummaryEnabled){ setHealthMsg('Enable health summary consent first.'); return; }
    const result=await pullHealthSummary(healthAdapter);
    if(!result.ok){ setHealthMsg(result.reason); return; }
    setStore({ ...store, healthSummary:mergeHealthSummary(store.healthSummary,result.summary) });
    recordEvent('health:summary-imported', { source:result.summary.source }, { essential:false });
    setHealthMsg('Health summary imported locally.');
  };

  return (
    <div className="px-4 py-5 space-y-4 max-w-3xl mx-auto">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight">More</h2>
        <p className="text-xs text-ink3">Backup, portability, privacy and help.</p>
      </div>

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <h3 className="text-sm font-bold">Backup & portability</h3>
        <p className="text-xs text-ink3">Local-first — your history lives on this device. Export JSON (full, versioned) or CSV (history only) and restore/merge on another device. No account required.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportNow} className="btn btn-primary min-h-10 rounded-xl px-4">Export JSON</button>
          <button onClick={exportCsv} className="btn btn-secondary min-h-10 rounded-xl px-4">Export CSV</button>
          <button onClick={exportEvents} className="btn btn-secondary min-h-10 rounded-xl px-4">Export events</button>
          <label className="btn btn-secondary min-h-10 rounded-xl px-4 cursor-pointer">
            Import backup
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onPickFile} />
          </label>
        </div>
        <div className="flex gap-2 text-xs">
          <label className="flex items-center gap-1.5"><input type="radio" name="strategy" checked={importStrategy==='merge'} onChange={()=> setImportStrategy('merge')} /> Merge</label>
          <label className="flex items-center gap-1.5"><input type="radio" name="strategy" checked={importStrategy==='replace'} onChange={()=> setImportStrategy('replace')} /> Replace</label>
          <span className="text-ink3 ml-auto">Merge de-dupes by session id; Replace overwrites.</span>
        </div>
        <p className="text-xs text-ink3">Cross-device sync is Merge with last-write-wins per session (via savedAt). Conflicts resolve without losing either device's work.</p>
        {msg && <p role="status" className="text-xs bg-surface2 border border-line rounded-xl px-3 py-2">{msg}</p>}
        <details className="text-xs">
          <summary className="font-semibold cursor-pointer">What’s in the backup?</summary>
          <pre className="mt-2 overflow-auto rounded-xl bg-surface2 border border-line p-3 text-[11px] leading-relaxed">{JSON.stringify({ app:'arise', version:3, schemaVersion:4, exportedAt:'…', data:{ onboarding:'{goal,equipment,location,level,daysPerWeek,availableMinutes,preferredExerciseIds,dislikedExerciseIds,plateConfig}', activeSchedule:'{programId,sessions}', activeWorkout:'recoverable draft or null', history:'[{id,date,blocks:[{exerciseId,sets:[{reps,weightKg,rpe,side,rom}]}]}]', preferences:'{units,theme,telemetryEnabled,pulseEnabled,healthSummaryEnabled}', eventHistory:'[{id,type,at,payload}]', healthSummary:'optional summary or null' }}, null, 2)}</pre>
        </details>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <h3 className="text-sm font-bold">Personalise</h3>
          <p className="text-xs text-ink3">Onboarding gates recommendations honestly — kit, time, level and movement preferences shape generated programmes.</p>
        <div className="rounded-xl border border-line bg-surface2 px-3 py-2 text-sm">
          <p className="font-semibold">Current onboarding</p>
          {!store.onboarding ? <p className="text-xs text-ink3 mt-1">Not completed — open onboarding to set goal, kit and location.</p> : (
            <ul className="text-xs text-ink3 mt-1 space-y-0.5">
              <li>Goal: <span className="font-semibold text-ink">{GOALS.find(g=>g.id===store.onboarding.goal)?.label || store.onboarding.goal}</span></li>
              <li>Location: <span className="font-semibold text-ink">{LOCATIONS.find(l=>l.id===store.onboarding.location)?.label || store.onboarding.location || '—'}</span></li>
              <li>Kit: <span className="font-semibold text-ink">{(store.onboarding.equipment||[]).join(', ') || '—'}</span></li>
              <li>Level: <span className="font-semibold text-ink">{store.onboarding.level || '—'}</span> • {store.onboarding.daysPerWeek || '—'}×/week • {store.onboarding.availableMinutes || '—'} min</li>
              <li>Preferences: <span className="font-semibold text-ink">{store.onboarding.preferredExerciseIds?.length || 0} liked</span> • <span className="font-semibold text-ink">{store.onboarding.dislikedExerciseIds?.length || 0} avoided</span></li>
              {store.onboarding.plateConfig && <li>Barbell setup: <span className="font-semibold text-ink">{store.onboarding.plateConfig.barWeightKg || 0}kg bar • {(store.onboarding.plateConfig.platesKg || []).join(', ')}kg plates</span></li>}
            </ul>
          )}
        </div>
        <button onClick={()=> setOnboardingOpen(true)} className="btn btn-secondary w-full min-h-11 rounded-xl">{store.onboarding ? 'Edit onboarding' : 'Start onboarding'}</button>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-2">
        <h3 className="text-sm font-bold">Privacy & data</h3>
        <p className="text-xs text-ink3">Local-first. Event measurements stay on this device. Nothing is sent to Pulse or a health platform unless you explicitly enable that separate integration.</p>
        <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-2"><p className="text-xs font-bold">Local measurements</p><span className="ml-auto text-[11px] text-ink3">{store.preferences?.telemetryEnabled===true?'enabled':store.preferences?.telemetryEnabled===false?'disabled':'choice needed'}</span></div>
          <p className="text-[11px] text-ink3">Measures set logging time, session abandonment and recommendation acceptance. It never leaves this device.</p>
          <div className="flex gap-2">
            <button onClick={()=> setTelemetryConsent(true)} className="btn btn-primary min-h-9 rounded-xl px-3 text-xs">Allow local measurements</button>
            <button onClick={()=> setTelemetryConsent(false)} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">Keep private</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={()=> setShowTelemetry(v=>!v)} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">{showTelemetry?'Hide':'Show'} local telemetry</button>
          <button onClick={()=> { clearTelemetry(); setMsg('Local telemetry cleared.'); setTimeout(()=> setMsg(null), 2000); }} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">Clear telemetry</button>
        </div>
        {showTelemetry && (
          <pre className="text-[11px] overflow-auto rounded-xl bg-surface2 border border-line p-3">{JSON.stringify(telemetrySummary(), null, 2)}</pre>
        )}
        <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-2"><p className="text-xs font-bold">Optional health-platform summary</p><span className="ml-auto text-[11px] text-ink3">{store.preferences?.healthSummaryEnabled?'enabled':'disabled'}</span></div>
          <p className="text-[11px] text-ink3">Import only a small summary such as steps, sleep, weight or resting heart rate. No raw health history is required.</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={()=> setHealthConsent(!store.preferences?.healthSummaryEnabled)} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">{store.preferences?.healthSummaryEnabled?'Disable health summary':'Enable health summary'}</button>
            <button onClick={importHealthSummary} disabled={!healthAdapter || !store.preferences?.healthSummaryEnabled} className="btn btn-primary min-h-9 rounded-xl px-3 text-xs disabled:opacity-40">Import summary</button>
          </div>
          <p className="text-[11px] text-ink3">{healthAdapter?'Adapter detected — ready to import.':'No health adapter detected — this remains optional.'}</p>
          {store.healthSummary && <p className="text-[11px]">Latest: {Object.entries(store.healthSummary).filter(([k])=> !['version','source','asOf','importedAt'].includes(k)).map(([k,v])=> `${k} ${v}`).join(' · ')} <span className="text-ink3">({store.healthSummary.source})</span></p>}
          {healthMsg && <p role="status" className="text-xs border border-line rounded-xl px-3 py-2">{healthMsg}</p>}
        </div>
        <details className="rounded-xl border border-line bg-surface2 px-3 py-2">
          <summary className="text-sm font-semibold cursor-pointer">Pulse connector</summary>
          <p className="text-xs text-ink3 mt-2">When enabled, completed sessions and weekly volume can be pushed to Pulse. Requires a Pulse adapter — configure via <code>window.__PULSE_ADAPTER__</code> (see <code>src/lib/pulse.js</code>). Data is only sent when you allow it.</p>
          <p className="text-xs text-ink3 mt-1">Current: {store.preferences?.pulseEnabled ? 'enabled' : 'disabled'}.</p>
          <button onClick={()=> setPulseConsent(!store.preferences?.pulseEnabled)} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs mt-2">{store.preferences?.pulseEnabled?'Disable Pulse sharing':'Enable Pulse sharing'}</button>
        </details>
        <div className="flex gap-2 mt-2">
          <button onClick={reset} className="text-xs font-semibold text-ink3 underline underline-offset-2">Clear local data</button>
          <button onClick={deleteAccount} className="ml-auto text-xs font-bold text-danger underline underline-offset-2">Delete all data</button>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-2">
        <h3 className="text-sm font-bold">Progression evidence</h3>
        <p className="text-xs text-ink3">Arise records each recommendation before the workout (with your measurement consent) and scores it against what you actually did next — compared against simple double progression, linear progression and a flat baseline on the same sessions.</p>
        {store.preferences?.telemetryEnabled !== true ? (
          <p className="text-xs text-ink3">Enable local measurements above to start collecting recommendation→outcome pairs. Pairs stay on this device and are included in your backup file.</p>
        ) : (
          <details className="rounded-xl border border-line bg-surface2 px-3 py-2" onToggle={(e)=> setEvidenceOpen(e.target.open)}>
            <summary className="text-sm font-semibold cursor-pointer">Study status{evidenceSummary ? ` — ${evidenceSummary}` : ''}</summary>
            {evidenceData && (
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-xs font-bold">Coverage</p>
                  <p className="text-[11px] text-ink3 mt-1">{evidenceData.coverage.totalResolved} resolved pairs · {evidenceData.coverage.openRecords} awaiting their workout · {evidenceData.coverage.exercisesTracked} exercises tracked. Segments need {evidenceData.coverage.minimumSamples}+ pairs to conclude.</p>
                  {!!evidenceData.coverage.gaps.length && (
                    <ul className="text-[11px] text-ink3 list-disc pl-4 mt-1">
                      {evidenceData.coverage.gaps.slice(0, 3).map(gap=> (
                        <li key={`${gap.dimension}-${gap.key}`}>{gap.dimension === 'exercise' ? gap.key : `${gap.key} experience`}: needs {gap.deficit} more</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="text-xs font-bold">Replay comparison ({evidenceData.comparative.transitions} transitions)</p>
                  <div className="mt-1 space-y-1" role="table" aria-label="Progression arm comparison">
                    {STUDY_ARMS.map(arm=> {
                      const row = evidenceData.comparative.overall[arm];
                      if(!row) return null;
                      const pct = v=> v == null ? '—' : `${Math.round(v * 100)}%`;
                      return (
                        <div key={arm} role="row" className="flex items-center gap-2 text-[11px]">
                          <span className="font-semibold w-36 truncate" role="cell">{arm}</span>
                          <span role="cell" className="text-ink3">met {pct(row.targetAchievementRate)} · success {pct(row.progressionSuccessRate)} · over-conservative {pct(row.unnecessaryConservatismRate)}</span>
                          <span className={`ml-auto px-1.5 py-0.5 rounded-full border ${row.conclusive ? 'border-success text-success' : 'border-line text-ink3'}`} role="cell">{row.conclusive ? `n=${row.n}` : `n=${row.n} · inconclusive`}</span>
                        </div>
                      );
                    })}
                  </div>
                  {pairedLine && <p className="text-[11px] text-ink3 mt-1">{pairedLine}</p>}
                </div>
                <p className="text-[11px] text-ink3">
                  Deloads: {evidenceData.deloads.decisions} decision{evidenceData.deloads.decisions === 1 ? '' : 's'} recorded
                  {evidenceData.deloads.cutsObservedRate != null ? ` · volume actually cut in ${Math.round(evidenceData.deloads.cutsObservedRate * 100)}% of cases` : ''}.
                  {' '}Every arm sees only prior sessions; nothing here feeds back into recommendations.
                </p>
              </div>
            )}
          </details>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-2">
        <h3 className="text-sm font-bold">Help & testing</h3>
        <details className="rounded-xl border border-line bg-surface2 px-3 py-2">
          <summary className="text-sm font-semibold cursor-pointer">Test on a real phone (30-second checklist)</summary>
          <ol className="list-decimal pl-5 text-xs text-ink2 mt-2 space-y-1">
            <li>Open this app on your phone (same Wi-Fi → use the dev URL, or deploy preview).</li>
            <li>Install to home screen (Share → Add to Home Screen / Install). Verify standalone display, icon, splash.</li>
            <li>Airplane mode → reload. Today + Exercises + last schedule should render from cache; saving a session queues locally.</li>
            <li>Log a session with varied loads — check Progress attributes and PRs update immediately and persist after reload.</li>
            <li>Export → airplane off → import on a second device (Merge) → verify history appears (conflict resolution is last-write-wins per session).</li>
            <li>Keyboard-only: Tab through Today → Train → Exercises; focus ring visible, no trap, landmarks announced.</li>
            <li>VoiceOver/TalkBack: headers, session rows, and form fields read with labels and live regions.</li>
          </ol>
        </details>
        <details className="rounded-xl border border-line bg-surface2 px-3 py-2">
          <summary className="text-sm font-semibold cursor-pointer">What this app is (and isn’t)</summary>
          <p className="text-xs text-ink3 mt-2">A game-like training companion: scheduled programs, honest load tracking, and attributes that derive from what you actually log. <span className="font-semibold text-ink">No nutrition system</span> — that would recreate Forq and dilute the training proposition.</p>
        </details>
      </section>
    </div>
  );
}
