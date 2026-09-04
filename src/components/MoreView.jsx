import { useEffect, useRef, useState } from 'react';
import { buildExportPayload, downloadJson, parseImportFile, mergeStores, portableCsv, deletionPreview, downloadBackup, parseBackupFile } from '../lib/export.js';
import { buildImportPreview } from '../lib/exportPolicy.js';
import { clearStore } from '../lib/store.js';
import { clearAllStoredData, getIntegrityNotice, clearIntegrityNotice, whenPersisted } from '../lib/storage.js';
import { storageHealth, requestPersistentStorage } from '../lib/storageQuota.js';
import { cryptoAvailable, encryptBackup, decryptBackup, looksEncrypted } from '../lib/cryptoBackup.js';
import { clearTelemetry, telemetrySummary, getEventHistory, mergeEventHistory, replaceEventHistory, recordEvent } from '../lib/telemetry.js';
import { mergeHealthSummary, pullHealthSummary } from '../lib/health.js';
import { LOCATIONS, GOALS } from '../lib/data.js';
import { loadEvaluationLedger } from '../lib/longitudinal.js';
import { deriveProgressionModel } from '../lib/progressionModel.js';
import { getAiSettings, saveAiSettings, clearAiSettings, buildTrainingContext, requestCoachInsight, DEFAULT_MODEL } from '../lib/aiCoach.js';
import { STUDY_ARMS, studyCoverage, runComparativeStudy, collectDeloadDecisions, validateDeloadDecisions } from '../lib/study.js';
import { voiceSupported } from '../lib/voiceCoach.js';
import { PROGRESSION_POLICIES, POLICY_ORDER } from '../lib/progressionPolicies.js';
import StorageDiagnostics from './StorageDiagnostics.jsx';

export default function MoreView({ store, setStore, setTab, onboardingOpen, setOnboardingOpen }){
  const [importStrategy,setImportStrategy]=useState('merge');
  const [msg,setMsg]=useState(null);
  const fileRef = useRef(null);
  const [showTelemetry,setShowTelemetry]=useState(false);
  const [healthMsg,setHealthMsg]=useState(null);
  const [evidenceOpen,setEvidenceOpen]=useState(false);
  const ai = getAiSettings();
  const [aiKeyInput,setAiKeyInput]=useState('');
  const [aiModelInput,setAiModelInput]=useState(ai.model || DEFAULT_MODEL);
  const [aiEnabled,setAiEnabled]=useState(ai.enabled);
  const [aiBusy,setAiBusy]=useState(false);
  const [aiResult,setAiResult]=useState(null);

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
      const model = deriveProgressionModel({ history: store.history || [], study: comparative });
      const pair = comparative?.pairedVsArise?.['double-progression'];
      if(pair?.pairs){
        pairedLine = `Paired vs double progression on ${pair.pairs} shared sessions: Arise met target where it didn't ${pair.ariseWins}×; baseline won ${pair.baselineWins}× (both met ${pair.bothMetTarget}, neither ${pair.neitherMetTarget}).`;
      }
      evidenceData = { coverage, comparative, deloads, model };
    }catch{ evidenceSummary = 'unavailable'; }
  }

  const prefs = store.preferences || {};
  const a11y = prefs.accessibility || {};
  const setPreference = (patch)=> setStore({ ...store, preferences: { ...prefs, ...patch } });
  const setAccessibility = (patch)=> setStore({ ...store, preferences: { ...prefs, accessibility: { ...a11y, ...patch } } });

  const healthAdapter = typeof window !== 'undefined' ? window.__ARISE_HEALTH_ADAPTER__ : null;

  const exportNow = ()=>{
    const payload = buildExportPayload(store);
    const date = new Date().toISOString().slice(0,10);
    // Compressed when the browser supports it; plain JSON otherwise — both
    // shapes import identically (parseBackupFile unwraps the envelope).
    downloadBackup(payload, `arise-backup-${date}.arise`);
    setMsg('Export downloaded — keep it somewhere safe.');
    setTimeout(()=> setMsg(null), 3000);
  };

  const exportEncrypted = async ()=>{
    if(!cryptoAvailable()){ setMsg('Encrypted backups need a newer browser — plain export still works.'); setTimeout(()=> setMsg(null), 4000); return; }
    const pass = prompt('Choose a passphrase for this backup.\n\nIf you lose it, the backup cannot be recovered — there is no reset.', '');
    if(pass == null) return;
    if(pass.length < 8){ setMsg('Use at least 8 characters — a short passphrase makes the backup guessable.'); setTimeout(()=> setMsg(null), 4000); return; }
    try{
      const payload = buildExportPayload(store);
      const bytes = await encryptBackup(payload, pass);
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `arise-backup-${new Date().toISOString().slice(0,10)}.arisebak`; a.click();
      setTimeout(()=> URL.revokeObjectURL(url), 2000);
      setMsg('Encrypted backup downloaded — the file is useless without your passphrase.');
    }catch(err){ setMsg(String(err.message || err)); }
    setTimeout(()=> setMsg(null), 5000);
  };

  const onPickEncrypted = async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    try{
      const bytes = new Uint8Array(await file.arrayBuffer());
      if(!looksEncrypted(bytes)) throw new Error('Not an Arise encrypted backup file.');
      const pass = prompt(`Passphrase for ${file.name}:`, '');
      if(pass == null){ e.target.value = ''; return; }
      const payload = await decryptBackup(bytes, pass);
      e.target.value = '';
      await queueImportPreview(payload);
    }catch(err){
      setMsg(String(err.message || err));
      e.target.value = '';
      setTimeout(()=> setMsg(null), 5000);
    }
  };

  const resetAllData = async ()=>{
    if(!confirm('Clear all local data on this device? This cannot be undone unless you have an export.')) return;
    await whenPersisted();
    await clearAllStoredData();
    clearStore(); clearTelemetry();
    location.reload();
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

  // Import is a two-step, reviewable flow: the file is parsed and previewed
  // (counts, conflicts, denied fields, origin metadata) and NOTHING is applied
  // until the user confirms. Cancel discards the preview entirely.
  const [importPreview, setImportPreview] = useState(null);

  const queueImportPreview = async (inner)=>{
    const preview = buildImportPreview(inner, store);
    if(!preview.ok){
      setMsg(preview.reason || 'This file could not be previewed.');
      setTimeout(()=> setMsg(null), 5000);
      return;
    }
    setImportPreview(preview);
  };

  const onPickFile = async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    const text = await file.text();
    e.target.value='';
    try{
      // Accepts plain JSON and the compressed .arise envelope alike.
      const inner = await parseBackupFile(text);
      await queueImportPreview(inner);
    }catch(err){
      setMsg(String(err.message || err));
      setTimeout(()=> setMsg(null), 5000);
    }
  };

  const applyImportPreview = ()=>{
    if(!importPreview) return;
    try{
      const imported = parseImportFile(JSON.stringify(importPreview.envelope));
      const merged = mergeStores(store, imported, importStrategy);
      if(importStrategy==='replace') replaceEventHistory(imported.eventHistory || []);
      else if(imported.eventHistory?.length) mergeEventHistory(imported.eventHistory);
      setStore({ ...merged, eventHistory:getEventHistory() });
      setMsg(importStrategy==='replace'
        ? 'Backup restored — replaced this device.'
        : `Backup merged — ${importPreview.counts.additions} new session${importPreview.counts.additions === 1 ? '' : 's'} added${importPreview.counts.updates ? `, ${importPreview.counts.updates} conflict${importPreview.counts.updates === 1 ? '' : 's'} kept your current copy` : ''}.`);
    }catch(err){
      setMsg(String(err.message || err));
    }
    setImportPreview(null);
    setTimeout(()=> setMsg(null), 6000);
  };

  const reset = resetAllData;
  const deleteAccount = async ()=>{
    const preview = deletionPreview(store);
    if(!confirm(`Delete all Arise data on this device?\n\nHistory: ${preview.historyCount} sessions\nSchedule: ${preview.schedulePresent?'yes':'no'}\nOnboarding: ${preview.onboardingPresent?'yes':'no'}\nReadiness: ${preview.readinessCount} entries\n\nThis cannot be undone.`)) return;
    await whenPersisted();
    await clearAllStoredData();
    clearStore(); clearTelemetry();
    location.reload();
  };

  const [storageInfo, setStorageInfo] = useState(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  useEffect(()=> {
    let live = true;
    storageHealth().then((h)=> { if(live) setStorageInfo(h); });
    return ()=> { live = false; };
  }, []);
  const persistStorageNow = async ()=>{
    const granted = await requestPersistentStorage();
    setStorageInfo(await storageHealth());
    setMsg(granted === null
      ? 'Persistent storage is not supported in this browser — regular exports are your safety net.'
      : granted
        ? 'Storage marked persistent — the browser will not evict your data under pressure.'
        : 'The browser declined persistent storage for now; keep exporting backups.');
    setTimeout(()=> setMsg(null), 5000);
  };
  const integrity = !noticeDismissed ? getIntegrityNotice() : null;

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

  const generateInsight = async ()=>{
    if(aiBusy) return;
    const key = aiKeyInput.trim() || ai.apiKey;
    if(!key){ setAiResult({ ok:false, error:'Paste your NVIDIA API key first.' }); return; }
    setAiBusy(true);
    setAiResult(null);
    try{
      saveAiSettings({ apiKey: key, model: aiModelInput, enabled: true });
      setAiEnabled(true);
      const context = buildTrainingContext({ history: store.history || [], schedule: store.activeSchedule, readinessLog: store.readinessLog || [], customTemplates: store.customTemplates || [] });
      const result = await requestCoachInsight({ context, apiKey: key, model: aiModelInput });
      setAiResult(result);
    }catch(err){
      setAiResult({ ok:false, error:String(err?.message || err).slice(0, 140) });
    }finally{
      setAiBusy(false);
    }
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
        {integrity && (
          <div role="alert" className="rounded-xl border border-danger/40 bg-dangersoft px-3 py-2 text-xs space-y-1">
            <p className="font-bold">Stored data needed repair on startup.</p>
            <p className="text-ink3">A broken copy was kept in quarantine and the readable parts were restored. Nothing was lost silently. Details: {integrity.errors.join(' ')}</p>
            <button onClick={()=> { clearIntegrityNotice(); setNoticeDismissed(true); }} className="underline font-semibold">Dismiss</button>
          </div>
        )}
        <p className="text-xs text-ink3">Local-first — your history lives on this device. Export JSON (full, versioned), an encrypted backup, or CSV (history only) and restore/merge on another device. No account required.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportNow} className="btn btn-primary min-h-10 rounded-xl px-4">Export JSON</button>
          <button onClick={exportEncrypted} className="btn btn-primary min-h-10 rounded-xl px-4">Export encrypted</button>
          <button onClick={exportCsv} className="btn btn-secondary min-h-10 rounded-xl px-4">Export CSV</button>
          <button onClick={exportEvents} className="btn btn-secondary min-h-10 rounded-xl px-4">Export events</button>
          <label className="btn btn-secondary min-h-10 rounded-xl px-4 cursor-pointer">
            Import backup
            <input ref={fileRef} type="file" accept=".arise,.json,application/json" className="hidden" onChange={onPickFile} />
          </label>
          <label className="btn btn-secondary min-h-10 rounded-xl px-4 cursor-pointer">
            Import encrypted
            <input type="file" accept=".arisebak,application/octet-stream" className="hidden" onChange={onPickEncrypted} />
          </label>
        </div>
        {storageInfo && (
          <div className="rounded-xl border border-line bg-surface2 px-3 py-2 text-xs space-y-1">
            {storageInfo.estimate
              ? <p>Storage: {storageInfo.estimate.usageMb} MB of about {storageInfo.estimate.quotaMb} MB used{storageInfo.level !== 'ok' ? <span className="font-bold"> — {storageInfo.level === 'critical' ? 'nearly full, export a backup now' : 'getting full'}</span> : null}.</p>
              : <p>Storage usage cannot be estimated in this browser.</p>}
            <p className="text-ink3">
              {storageInfo.persisted === true
                ? 'The browser has marked Arise’s storage persistent — it will not be evicted under pressure.'
                : storageInfo.persisted === false
                  ? 'This data is best-effort: the browser may remove it if space runs out. '
                  : null}
              {storageInfo.persisted === false && <button onClick={persistStorageNow} className="underline font-semibold">Request persistent storage</button>}
            </p>
          </div>
        )}
        <div className="flex gap-2 text-xs">
          <label className="flex items-center gap-1.5"><input type="radio" name="strategy" checked={importStrategy==='merge'} onChange={()=> setImportStrategy('merge')} /> Merge</label>
          <label className="flex items-center gap-1.5"><input type="radio" name="strategy" checked={importStrategy==='replace'} onChange={()=> setImportStrategy('replace')} /> Replace</label>
          <span className="text-ink3 ml-auto">Merge de-dupes by session id; Replace overwrites.</span>
        </div>
        {importPreview && (
          <div role="dialog" aria-label="Import preview" className="rounded-xl border border-line bg-surface2 p-3 text-xs space-y-2">
            <p className="font-bold">Review this backup before applying</p>
            <p className="text-ink3">
              Exported {importPreview.meta.exportedAt && importPreview.meta.exportedAt !== '1970-01-01T00:00:00.000Z' ? new Date(importPreview.meta.exportedAt).toLocaleString() : 'at an unknown time'}
              {importPreview.meta.device && importPreview.meta.device !== 'unknown' && importPreview.meta.device !== 'unknown-pre-contract' ? ` · device ${importPreview.meta.device}` : ''}
              {importPreview.meta.appVersion ? ` · Arise ${importPreview.meta.appVersion}` : ''}
              {importPreview.meta.contractRecognised ? '' : importPreview.meta.adapter ? ` · converted from an older format (${importPreview.meta.adapter})` : ' · older format, imported as-is'}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>{importPreview.counts.sessions} session{importPreview.counts.sessions === 1 ? '' : 's'}</span>
              <span>{importPreview.counts.sets} set{importPreview.counts.sets === 1 ? '' : 's'}</span>
              {importPreview.counts.events > 0 && <span>{importPreview.counts.events} event{importPreview.counts.events === 1 ? '' : 's'}</span>}
              {importPreview.counts.ledger > 0 && <span>{importPreview.counts.ledger} recommendation record{importPreview.counts.ledger === 1 ? '' : 's'}</span>}
              {importPreview.counts.templates > 0 && <span>{importPreview.counts.templates} template{importPreview.counts.templates === 1 ? '' : 's'}</span>}
              {importPreview.counts.readiness > 0 && <span>{importPreview.counts.readiness} readiness entr{importPreview.counts.readiness === 1 ? 'y' : 'ies'}</span>}
            </div>
            <p>
              {importStrategy === 'merge'
                ? <>{importPreview.counts.additions} new · {importPreview.counts.updates} conflict{importPreview.counts.updates === 1 ? '' : 's'} (your current copy is kept)</>
                : 'Replace overwrites everything on this device with the backup.'}
            </p>
            {importPreview.conflictsTotal > 0 && (
              <details>
                <summary className="font-semibold cursor-pointer">Conflicts ({importPreview.conflictsTotal})</summary>
                <ul className="mt-1 space-y-0.5 text-ink3">
                  {importPreview.conflicts.map((c)=> (
                    <li key={c.sessionId}>
                      {c.dateISO}: backup has {c.incomingSets} set{c.incomingSets === 1 ? '' : 's'}, this device has {c.existingSets}
                      {c.incomingNewer ? ' — backup copy is newer but merge keeps yours' : ''}
                    </li>
                  ))}
                  {importPreview.conflictsTotal > importPreview.conflicts.length && <li>…and {importPreview.conflictsTotal - importPreview.conflicts.length} more</li>}
                </ul>
              </details>
            )}
            {importPreview.deniedFields.length > 0 && (
              <p className="text-ink3">Ignored for your safety (device-local settings): {importPreview.deniedFields.join(', ')}</p>
            )}
            <div className="flex gap-2">
              <button onClick={applyImportPreview} className="btn btn-primary min-h-9 rounded-xl px-4">Apply {importStrategy}</button>
              <button onClick={()=> setImportPreview(null)} className="btn btn-secondary min-h-9 rounded-xl px-4">Cancel</button>
            </div>
          </div>
        )}
        <p className="text-xs text-ink3">Cross-device sync is Merge with last-write-wins per session (via savedAt). Conflicts resolve without losing either device's work.</p>
        {msg && <p role="status" className="text-xs bg-surface2 border border-line rounded-xl px-3 py-2">{msg}</p>}
        <details className="text-xs">
          <summary className="font-semibold cursor-pointer">What’s in the backup?</summary>
          <pre className="mt-2 overflow-auto rounded-xl bg-surface2 border border-line p-3 text-[11px] leading-relaxed">{JSON.stringify({ app:'arise', version:3, schemaVersion:4, exportedAt:'…', data:{ onboarding:'{goal,equipment,location,level,daysPerWeek,availableMinutes,preferredExerciseIds,dislikedExerciseIds,plateConfig}', activeSchedule:'{programId,sessions}', activeWorkout:'recoverable draft or null', history:'[{id,date,blocks:[{exerciseId,sets:[{reps,weightKg,rpe,side,rom}]}]}]', preferences:'{units,theme,telemetryEnabled,pulseEnabled,healthSummaryEnabled}', eventHistory:'[{id,type,at,payload}]', healthSummary:'optional summary or null' }}, null, 2)}</pre>
        </details>
      </section>

      <StorageDiagnostics setMsg={setMsg} />

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <h3 className="text-sm font-bold">Appearance & accessibility</h3>
        <p className="text-xs text-ink3">Applies to every screen on this device, including the session runner. Stored with your other preferences and included in a backup.</p>

        <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
          <p className="text-xs font-bold">Theme</p>
          <div className="flex gap-1.5" role="group" aria-label="Theme">
            {THEME_OPTIONS.map(option=> {
              const active = (prefs.theme ?? null) === option.id;
              return (
                <button key={option.label} onClick={()=> setPreference({ theme: option.id })} aria-pressed={active}
                  className={`flex-1 min-h-10 rounded-xl border text-xs font-bold ${active ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink2 hover:border-ink3'}`}>
                  {option.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-ink3">System follows your device setting and keeps following it while the app is open.</p>
        </div>

        <ToggleRow
          label="Automatic rest timer"
          hint="Starts the countdown as soon as you mark a set done. The per-exercise “Start rest” button stays available either way."
          checked={prefs.autoRest !== false}
          onChange={value=> setPreference({ autoRest: value })}
        />

        <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2.5">
          <p className="text-xs font-bold">Accessibility</p>
          <ToggleRow bare label="Larger text" hint="Scales the whole interface up by roughly 12%." checked={a11y.largeText === true} onChange={value=> setAccessibility({ largeText: value })} />
          <ToggleRow bare label="High contrast" hint="Pushes text and borders to maximum contrast against the background." checked={a11y.highContrast === true} onChange={value=> setAccessibility({ highContrast: value })} />
          <ToggleRow bare label="Reduce motion" hint="Removes transitions and animations, regardless of your OS setting." checked={a11y.reduceMotion === true} onChange={value=> setAccessibility({ reduceMotion: value })} />
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <h3 className="text-sm font-bold">Guided mode</h3>
        <p className="text-xs text-ink3">Applies to guided sessions — one set at a time, with timers. Changes take effect immediately, including mid-workout.</p>

        <ToggleRow
          label="Sound cues"
          hint="Short tones when rest starts, a 3-2-1 tick, and a completion chime. A mute button also lives on the rest timer itself."
          checked={prefs.soundCues !== false}
          onChange={value=> setPreference({ soundCues: value })}
        />

        <ToggleRow
          label="Voice coach"
          hint="Speaks the exercise name, set number and rep target as each new step starts. Uses your device's built-in speech — nothing is sent anywhere."
          checked={prefs.voiceCoach === true}
          onChange={value=> setPreference({ voiceCoach: value })}
        />

        <div className={`rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2 ${prefs.voiceCoach === true ? '' : 'opacity-60'}`}>
          <p className="text-xs font-bold">Speech rate</p>
          <div className="flex gap-1.5" role="group" aria-label="Voice coach speech rate">
            {VOICE_RATE_OPTIONS.map(option=> {
              const active = (Number(prefs.voiceRate) || 1) === option.rate;
              return (
                <button key={option.label} onClick={()=> setPreference({ voiceRate: option.rate })} aria-pressed={active}
                  className={`flex-1 min-h-10 rounded-xl border text-xs font-bold ${active ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink2 hover:border-ink3'}`}>
                  {option.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-ink3">{voiceSupported() ? 'Applies to the voice coach only — sound cues keep their own rhythm.' : 'Speech is not supported in this browser — the voice coach toggle stays off.'}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <h3 className="text-sm font-bold">Training policy</h3>
        <p className="text-xs text-ink3">Shapes how the engine reacts to your logged sessions — the standard policy is the engine as designed. Applies from the next session.</p>
        <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
          <p className="text-xs font-bold">Progression policy</p>
          <div className="flex gap-1.5" role="group" aria-label="Progression policy">
            {POLICY_ORDER.map(id=> {
              const meta = PROGRESSION_POLICIES[id];
              const active = (prefs.progressionPolicy || 'standard') === id;
              return (
                <button key={id} onClick={()=> setPreference({ progressionPolicy: id })} aria-pressed={active}
                  title={meta.description}
                  className={`flex-1 min-h-10 rounded-xl border text-xs font-bold ${active ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink2 hover:border-ink3'}`}>
                  {meta.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-ink3">{PROGRESSION_POLICIES[prefs.progressionPolicy || 'standard']?.description}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
          <p className="text-xs font-bold">Explanation detail</p>
          <div className="flex gap-1.5" role="group" aria-label="Explanation detail level">
            {[['simple', 'Simple', 'One line — what to do.'], ['standard', 'Standard', 'The reason behind the prescription.'], ['advanced', 'Advanced', 'Policy, confidence, uncertainty and trend windows.']].map(([id, label, hint])=> {
              const active = (prefs.explanationMode || 'standard') === id;
              return (
                <button key={id} onClick={()=> setPreference({ explanationMode: id })} aria-pressed={active} title={hint}
                  className={`flex-1 min-h-10 rounded-xl border text-xs font-bold ${active ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink2 hover:border-ink3'}`}>
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-ink3">Controls how much detail recommendations show in Train.</p>
        </div>
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
        <h3 className="text-sm font-bold">AI coach (optional)</h3>
        <p className="text-xs text-ink3">Optional: an NVIDIA-hosted model reads <span className="font-semibold text-ink">aggregated numbers only</span> (weekly sets/volume, adherence, readiness average) and returns short coaching notes. Your key is stored on this device only — never exported, synced, or included in backups.</p>
        <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
          <label className="block">
            <span className="text-[11px] font-bold">NVIDIA API key</span>
            <input type="password" value={aiKeyInput} onChange={e=> setAiKeyInput(e.target.value)} placeholder={ai.apiKey ? '•••• saved — paste to replace' : 'nvapi-…'} autoComplete="off" className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-ink3">Model</span>
            <input value={aiModelInput} onChange={e=> setAiModelInput(e.target.value)} placeholder={DEFAULT_MODEL} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button onClick={generateInsight} disabled={aiBusy} className="btn btn-primary min-h-9 rounded-xl px-3 text-xs disabled:opacity-40">{aiBusy ? 'Thinking…' : 'Generate insight'}</button>
            {ai.apiKey && <button onClick={()=> { clearAiSettings(); setAiEnabled(false); setAiResult(null); setAiKeyInput(''); }} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">Clear key</button>}
            <span className="ml-auto text-[11px] text-ink3 self-center">{ai.apiKey ? 'key saved on this device' : 'no key stored'} · {ai.enabled || aiBusy ? 'enabled' : 'disabled'}</span>
          </div>
          {aiResult && (
            <div role="status" aria-live="polite" className={`rounded-xl border px-3 py-2 text-xs whitespace-pre-wrap ${aiResult.ok ? 'border-line bg-surface' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
              {aiResult.ok ? `${aiResult.text}\n\n— ${aiResult.model}` : `AI request failed: ${aiResult.error}`}
            </div>
          )}
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
                {(() => {
                  const segs = evidenceData.comparative?.segments || {};
                  const conclusiveRows = [];
                  for(const [dim, groups] of Object.entries(segs)){
                    for(const [key, arms] of Object.entries(groups)){
                      const a = arms.arise, dp = arms['double-progression'];
                      if(a?.conclusive && dp) conclusiveRows.push({ dim, key, aMet: a.targetAchievementRate, dpMet: dp.targetAchievementRate, n: a.n });
                    }
                  }
                  if(!conclusiveRows.length) return null;
                  return (
                    <div>
                      <p className="text-xs font-bold">Segmented comparison (conclusive only)</p>
                      <div className="mt-1 space-y-0.5">
                        {conclusiveRows.slice(0, 8).map(r => (
                          <div key={`${r.dim}-${r.key}`} className="flex items-center gap-2 text-[11px]">
                            <span className="font-semibold w-28 truncate">{r.key}</span>
                            <span className="text-ink3">{r.dim} · n={r.n}</span>
                            <span className="ml-auto tabular-nums">arise {Math.round(r.aMet*100)}% vs DP {Math.round(r.dpMet*100)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                <div>
                  <p className="text-xs font-bold">Progression model capabilities</p>
                  <div className="mt-1 flex flex-wrap gap-1" role="list" aria-label="Progression model capabilities">
                    {(evidenceData.model?.capabilities || []).map(cap=> (
                      <span key={cap.id} role="listitem" title={cap.detail}
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${cap.status==='active'||cap.status==='ready' ? 'border-success text-success' : cap.status==='existing' ? 'border-line text-ink3' : 'border-review/40 text-review bg-reviewsoft'}`}>
                        {cap.label}: {cap.status}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-ink3 mt-1">
                    {evidenceData.model?.activeOverrideCount > 0
                      ? `${evidenceData.model.activeOverrideCount} exercise-specific override${evidenceData.model.activeOverrideCount===1?'':'s'} currently shaping recommendations.`
                      : 'No overrides active — capabilities stay inert until sample gates AND a proven baseline weakness open them.'}
                    {evidenceData.model?.autoregulationApplied ? ' Autoregulation band shifted.' : ''}
                    {evidenceData.model?.shortBreakEasing ? ' Short-break easing enabled.' : ''}
                  </p>
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

const THEME_OPTIONS = [
  { id: null, label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

const VOICE_RATE_OPTIONS = [
  { rate: 0.85, label: 'Slow' },
  { rate: 1, label: 'Normal' },
  { rate: 1.2, label: 'Fast' },
];

// A labelled switch built on a real checkbox, so it is reachable by keyboard and
// announced with its state without any ARIA bookkeeping.
function ToggleRow({ label, hint, checked, onChange, bare = false }){
  return (
    <label className={`flex items-start gap-3 cursor-pointer ${bare ? '' : 'rounded-xl border border-line bg-surface2 px-3 py-2.5'}`}>
      <input type="checkbox" checked={checked} onChange={e=> onChange(e.target.checked)} className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--accent)]" />
      <span className="min-w-0">
        <span className="block text-xs font-bold">{label}</span>
        <span className="block text-[11px] text-ink3 mt-0.5">{hint}</span>
      </span>
      <span className="ml-auto shrink-0 text-[11px] font-semibold text-ink3">{checked ? 'on' : 'off'}</span>
    </label>
  );
}
