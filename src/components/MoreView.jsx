import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { downloadJson, portableCsv, deletionPreview, buildPartialExportPayload } from '../lib/export.js';
import { applyImportPreview as applyImport, importAppCsv, previewBackupFile, previewBackupPayload } from '../services/restoreService.js';
import { buildCoachExport, renderCoachMarkdown } from '../lib/coachExport.js';
import { shareTextAsFile } from '../lib/nativeShare.js';
const SyncPanel = lazy(() => import('./SyncPanel.jsx'));
import { clearTelemetry, telemetrySummary, getEventHistory, recordEvent, getErrorEvents, clearErrorEvents } from '../lib/telemetry.js';
import { mergeHealthSummary, pullHealthSummary } from '../lib/health.js';
import { LOCATIONS, GOALS } from '../lib/data.js';
import { setRestPreset } from '../lib/gymMode.js';
import { EXERCISE_BY_ID } from '../lib/data.js';
import { buildSupportBundle } from '../lib/supportDiagnostics.js';
import { buildSalvagePayload } from '../lib/salvageExport.js';
import { dataLifecycleService } from '../services/dataLifecycleService.js';
import {
  SETTINGS_GROUPS,
  acknowledgeConsentReview,
  clearEventHistoryStore,
  matchSettings,
  mergeImportedHealthSummary as mergeImportedHealthSummaryAction,
  setConsentReviewReminder,
  setHealthSummaryConsent as setHealthSummaryConsentAction,
  setPulseConsent as setPulseConsentAction,
  setTelemetryConsent as setTelemetryConsentAction,
  setTelemetryOption,
} from '../services/settingsService.js';
import { backupReminderDue, dismissBackupReminder as persistBackupReminderDismissal, readBackupState } from '../lib/backupState.js';
import { decryptEncryptedFullBackup, downloadEncryptedFullBackup, downloadFullBackup, encryptedBackupSupported } from '../services/backupService.js';
import ToggleRow from './settings/ToggleRow.jsx';
const AiCoachSettings = lazy(()=> import('./settings/AiCoachSettings.jsx'));
const FeedbackSettings = lazy(()=> import('./settings/FeedbackSettings.jsx'));
const AppearanceAccessibilitySettings = lazy(()=> import('./settings/AppearanceAccessibilitySettings.jsx'));
const GuidedSettings = lazy(()=> import('./settings/GuidedSettings.jsx'));
const TrainingPolicySettings = lazy(()=> import('./settings/TrainingPolicySettings.jsx'));
const EvidenceSettings = lazy(()=> import('./settings/EvidenceSettings.jsx'));
import { useTransientMessage } from '../hooks/useTransientMessage.js';
import { useDialogs } from './Dialog.jsx';
const StorageDiagnostics = lazy(()=> import('./StorageDiagnostics.jsx'));

// Settings search: the index lives in settingsService (pure data + matcher);
// a query becomes a jump to a section id under the intent group headings
// below. Matching scrolls the section into view and flashes it (opening the
// Advanced disclosure first when the section lives inside it), so nothing is
// hidden — filtering sections would hide unrelated settings the query
// happened not to name.

export default function MoreView({ store, setStore, onboardingOpen, setOnboardingOpen, onLoadDemo }){
  const [importStrategy,setImportStrategy]=useState('merge');
  const { message:msg, setMessage:setMsg, flash:flashMsg } = useTransientMessage();
  const dialogs = useDialogs();
  const fileRef = useRef(null);
  const [showTelemetry,setShowTelemetry]=useState(false);
  const [showErrors,setShowErrors]=useState(false);
  // Optional consent-expiration: a purely local, self-set reminder. No server,
  // no notification permission — just an honest "review due" card here.
  const CONSENT_REVIEW_DAYS = 90;
  const consentReviewDue = store.preferences?.consentReview?.remind === true
    && (!store.preferences.consentReview.lastReviewedAt
        || Date.now() - Date.parse(store.preferences.consentReview.lastReviewedAt) > CONSENT_REVIEW_DAYS * 86400000);
  const [healthMsg,setHealthMsg]=useState(null);

  const prefs = store.preferences || {};
  const setPreference = (patch)=> setStore({ ...store, preferences: { ...prefs, ...patch } });
  // Gym Mode writes stamp updatedAt so portable sync merges by recency.
  const setGymPref = (patch)=> setStore({ ...store, gymPrefs: { ...(store.gymPrefs||{}), ...patch, updatedAt: new Date().toISOString() } });

  // Settings search: the index in settingsService (pure data + matcher)
  // turns a query into a jump to a section id, under the intent group
  // headings below. Matching scrolls the section into view and flashes it
  // (opening the Advanced disclosure first when the section lives inside
  // it), so nothing is hidden — filtering out sections would hide unrelated
  // settings the query happened not to name.
  const [searchQuery, setSearchQuery] = useState('');
  const searchMatches = matchSettings(searchQuery);
  // Jumping scrolls the section into view and flashes it, opening the
  // Advanced disclosure first when the section lives inside a collapsed
  // <details> — otherwise the jump would land on hidden content.
  const jumpToSetting = (id)=>{
    const el = document.getElementById(id);
    if(!el) return;
    const gate = el.closest?.('details');
    if(gate) gate.open = true;
    el.scrollIntoView({ behavior:'smooth', block:'start' });
    el.classList.add('settings-flash');
    setTimeout(()=> el.classList.remove('settings-flash'), 1800);
  };

  const healthAdapter = typeof window !== 'undefined' ? window.__ARISE_HEALTH_ADAPTER__ : null;

  const exportNow = async ()=>{
    try{
      await downloadFullBackup(store);
      flashMsg('Backup downloaded — keep it somewhere safe.', 3000);
    }catch(err){
      flashMsg(`Backup failed: ${String(err?.message || err)}`, 5000);
    }
  };

  const exportEncrypted = async ()=>{
    if(!encryptedBackupSupported()){ flashMsg('Encrypted backups need a newer browser — plain export still works.', 4000); return; }
    const pass = await dialogs.prompt({
      title:'Choose a passphrase for this backup',
      description:'If you lose it, the backup cannot be recovered — there is no reset.',
      fieldLabel:'Passphrase',
      inputType:'password',
      minLength:8,
      confirmLabel:'Create encrypted backup',
    });
    if(pass == null) return;
    if(pass.length < 8){ flashMsg('Use at least 8 characters — a short passphrase makes the backup guessable.', 4000); return; }
    try{
      await downloadEncryptedFullBackup(store, pass);
      flashMsg('Encrypted backup downloaded — the file is useless without your passphrase.', 5000);
    }catch(err){ flashMsg(String(err.message || err), 5000); }
  };

  const onPickEncrypted = async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    try{
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pass = await dialogs.prompt({
        title:`Passphrase for ${file.name}`,
        description:'This file was sealed with a passphrase when it was exported.',
        fieldLabel:'Passphrase',
        inputType:'password',
        confirmLabel:'Unlock backup',
      });
      if(pass == null){ e.target.value = ''; return; }
      const payload = await decryptEncryptedFullBackup(bytes, pass);
      e.target.value = '';
      await queueImportPreview(payload);
    }catch(err){
      flashMsg(String(err.message || err), 5000);
      e.target.value = '';
    }
  };

  // One destructive data operation for the whole app: "Erase all Arise data
  // from this device". The reviewable confirmation (counts/state) is shown
  // here; dataLifecycleService.eraseDeviceData owns the already-confirmed
  // verified wipe. On failure nothing is reloaded, so a backup is still possible.
  const eraseAllData = async ()=>{
    const preview = deletionPreview(store);
    const ok = await dialogs.confirm({
      title:'Erase all Arise data from this device?',
      description:`History: ${preview.historyCount} sessions (+ ${preview.archivedHistoryCount} archived) · Schedule: ${preview.schedulePresent?'yes':'no'} · Onboarding: ${preview.onboardingPresent?'yes':'no'} · Readiness: ${preview.readinessCount} entries · Events: ${preview.eventCount}. Erasing cannot be undone unless you exported a backup.`,
      confirmLabel:'Erase everything',
      cancelLabel:'Keep my data',
      destructive:true,
    });
    if(!ok) return;
    try{
      await dataLifecycleService.eraseDeviceData();
      location.reload();
    }catch(err){
      flashMsg(`Erase failed: ${String(err?.message || err)}. This tab was not reloaded so you can export a backup.`, 7000);
    }
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
    flashMsg('Event history exported — it stays on your device unless you share the file.', 3000);
  };

  // Partial exports: one slice, same versioned envelope — a coach, a new
  // device or the study tooling each need only part of the store.
  const exportPartial = (kind)=>{
    try{
      const payload = buildPartialExportPayload(store, kind);
      const date = new Date().toISOString().slice(0,10);
      downloadJson(`arise-${kind}-${date}.json`, payload);
      flashMsg(`${kind[0].toUpperCase()+kind.slice(1)} export downloaded.`, 4000);
    }catch(err){ flashMsg(String(err.message || err), 4000); }
  };

  // Coach export: consent-gated, human-readable summary. Nothing identity- or
  // health-bearing unless explicitly ticked; never credentials, never telemetry.
  const [coachSections, setCoachSections] = useState({ performance: true, weekly: true, readiness: false, detail: false });
  const shareCoach = async ()=>{
    const data = buildCoachExport(store, { sections: coachSections, weeks: 8 });
    const md = renderCoachMarkdown(data);
    const outcome = await shareTextAsFile({ text: md, filename: `arise-coach-${new Date().toISOString().slice(0,10)}.md`, mimeType: 'text/markdown', title: 'Training summary' });
    flashMsg(outcome === 'shared' ? "Shared via your device's share sheet." : outcome === 'copied' ? 'Share sheet unavailable — summary copied to clipboard.' : 'Sharing cancelled.', 4000);
  };

  const exportCoach = ()=>{
    const data = buildCoachExport(store, { sections: coachSections, weeks: 8 });
    const md = renderCoachMarkdown(data);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `arise-coach-${new Date().toISOString().slice(0,10)}.md`; a.click();
    setTimeout(()=> URL.revokeObjectURL(url), 2000);
    flashMsg('Coach summary downloaded — it contains only the sections ticked below.', 5000);
  };

  // Backup reminder: a gentle weekly nudge, dismissed until next week.
  const storedBackupState = readBackupState();
  const [backupReminderDismissed, setBackupReminderDismissed] = useState(()=> storedBackupState.dismissedAt);
  const backupDue = backupReminderDue({
    history:store.history || [],
    lastBackupAt:storedBackupState.lastBackupAt,
    dismissedAt:backupReminderDismissed,
  });
  const dismissBackupReminder = ()=>{
    const at = new Date().toISOString();
    persistBackupReminderDismissal({ atISO:at });
    setBackupReminderDismissed(at);
  };

  // Import is a two-step, reviewable flow: the file is parsed and previewed
  // (counts, conflicts, denied fields, origin metadata) and NOTHING is applied
  // until the user confirms. Cancel discards the preview entirely. The parse /
  // preview / apply logic lives in restoreService (tested), not here.
  const [importPreview, setImportPreview] = useState(null);

  const queueImportPreview = async (inner)=>{
    const preview = previewBackupPayload(inner, store);
    if(!preview.ok){
      flashMsg(preview.reason || 'This file could not be previewed.', 5000);
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
      const preview = await previewBackupFile(text, store);
      if(!preview.ok){
        flashMsg(preview.reason || 'This file could not be previewed.', 5000);
        return;
      }
      setImportPreview(preview);
    }catch(err){
      flashMsg(String(err.message || err), 5000);
    }
  };

  // Import from other apps: their documented CSV exports, mapped into Arise's
  // portable schema. Rows become sessions through the same merge as any
  // import; unmapped exercise names are reported, never dropped silently.
  const onPickAppCsv = async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    const text = await file.text();
    e.target.value='';
    try{
      const { parseAppCsv, rowsToHistory } = await import('../lib/appCsvImport.js');
      const result = await importAppCsv({ text, store, byId: EXERCISE_BY_ID, parse: parseAppCsv, rowsToHistory });
      if(!result.ok){
        flashMsg(`No usable rows found (${result.skipped} skipped${result.unmappedExercises.length ? `; unknown exercises: ${result.unmappedExercises.slice(0, 5).join(', ')}` : ''}).`, 6000);
        return;
      }
      setStore(result.store);
      flashMsg(`Imported ${result.rowCount} rows into ${result.sessionCount} sessions${result.unmappedExercises.length ? ` · skipped unknown exercises: ${result.unmappedExercises.slice(0, 5).join(', ')}` : ''}.`, 6000);
    }catch(err){
      flashMsg(String(err.message || err), 6000);
    }
  };

  const applyImportPreview = ()=>{
    if(!importPreview) return;
    try{
      const result = applyImport({ preview: importPreview, store, strategy: importStrategy });
      setStore(result.store, result.persistenceOptions);
      flashMsg(result.summary.kind === 'replaced'
        ? 'Backup restored — replaced this device.'
        : `Backup merged — ${result.summary.additions} new session${result.summary.additions === 1 ? '' : 's'} added${result.summary.updates ? `, ${result.summary.updates} conflict${result.summary.updates === 1 ? '' : 's'} kept your current copy` : ''}.`, 6000);
    }catch(err){
      flashMsg(String(err.message || err), 6000);
    }
    setImportPreview(null);
  };

  const [storageInfo, setStorageInfo] = useState(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  useEffect(()=> {
    let live = true;
    dataLifecycleService.storageHealth().then((h)=> { if(live) setStorageInfo(h); });
    return ()=> { live = false; };
  }, []);
  const persistStorageNow = async ()=>{
    const { granted, health } = await dataLifecycleService.requestPersistentStorage();
    setStorageInfo(health);
    flashMsg(granted === null
      ? 'Persistent storage is not supported in this browser — regular exports are your safety net.'
      : granted
        ? 'Storage marked persistent — the browser will not evict your data under pressure.'
        : 'The browser declined persistent storage for now; keep exporting backups.', 5000);
  };
  const integrity = !noticeDismissed ? dataLifecycleService.integrityNotice() : null;


  // Support bundle: environment + shape summary only, never training data.
  const exportSupportBundle = async ()=>{
    try{
      const bundle = await buildSupportBundle({ store });
      downloadJson(`arise-support-${new Date().toISOString().slice(0, 10)}.json`, bundle);
      flashMsg('Support bundle downloaded — attach it when reporting a problem. It contains no training data.', 5000);
    }catch{ flashMsg('Could not build the support bundle in this browser.', 5000); }
  };
  // Recovery salvage: every intact history row from the current (possibly
  // repaired) store, before the user chooses rollback or a fresh start.
  const exportSalvage = ()=>{
    const payload = buildSalvagePayload(store);
    if(!payload){
      flashMsg('Nothing salvageable was found — a snapshot rollback or backup import is the better path.', 5000);
    } else {
      downloadJson(`arise-salvage-${new Date().toISOString().slice(0, 10)}.json`, payload);
      flashMsg(`Salvaged ${payload.data.history.length} sessions (${payload.droppedMalformed} unreadable rows skipped).`, 5000);
    }
  };

  const setTelemetryConsent=(enabled)=>{
    setStore(setTelemetryConsentAction(store, enabled));
    recordEvent('consent:local-measurements', { enabled }, { essential:true });
    flashMsg(enabled ? 'Local measurements enabled.' : 'Local measurements disabled. Existing history remains on this device.', 3000);
  };

  const setPulseConsent=(enabled)=>{
    setStore(setPulseConsentAction(store, enabled));
    recordEvent('consent:pulse', { enabled }, { essential:true });
    flashMsg(enabled ? 'Pulse sharing enabled. Arise will only push completed workouts.' : 'Pulse sharing disabled.', 3000);
  };

  const setHealthConsent=(enabled)=>{
    setStore(setHealthSummaryConsentAction(store, enabled));
    recordEvent('consent:health-summary', { enabled }, { essential:true });
    setHealthMsg(enabled ? 'Health summary import enabled.' : 'Health summary disabled and its saved summary removed.');
  };


  const importHealthSummary=async()=>{
    if(!store.preferences?.healthSummaryEnabled){ setHealthMsg('Enable health summary consent first.'); return; }
    const result=await pullHealthSummary(healthAdapter);
    if(!result.ok){ setHealthMsg(result.reason); return; }
    setStore(mergeImportedHealthSummaryAction(store, mergeHealthSummary(store.healthSummary,result.summary)));
    recordEvent('health:summary-imported', { source:result.summary.source }, { essential:false });
    setHealthMsg('Health summary imported locally.');
  };

  const restPresetEntries = Object.entries(store.gymPrefs?.restPresets || {});
  const exerciseName = (id)=> EXERCISE_BY_ID[id]?.name || id;

  return (
    <div className="px-4 pt-5 pb-2 space-y-4 max-w-3xl mx-auto">
      {dialogs.node}
      <div>
        <h2 className="text-lg font-extrabold tracking-tight">More</h2>
        <p className="text-xs text-ink3">Everything else — settings grouped by what you're here to do.</p>
      </div>

      <div role="search" className="relative">
        <input
          type="search"
          value={searchQuery}
          onChange={e=> setSearchQuery(e.target.value)}
          placeholder="Search settings… (e.g. voice, wake, policy)"
          aria-label="Search settings"
          className="w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm"
        />
        {searchQuery && (
          searchMatches.length ? (
            <div className="absolute inset-x-0 top-full mt-1 z-20 rounded-xl border border-line bg-surface shadow-lg overflow-hidden">
              {searchMatches.map(m=> (
                <button key={m.id} onClick={()=>{ jumpToSetting(m.id); setSearchQuery(''); }}
                  className="w-full text-left px-3 py-2.5 text-xs font-semibold hover:bg-surface2 border-b border-line last:border-b-0">
                  {m.title}
                </button>
              ))}
            </div>
          ) : (
            <p className="absolute inset-x-0 top-full mt-1 z-20 rounded-xl border border-line bg-surface px-3 py-2.5 text-xs text-ink3 shadow-lg">No settings match “{searchQuery}”.</p>
          )
        )}
      </div>

      {/* ── PROFILE & TRAINING: who you are, what you have, how the engine prescribes ── */}
      <div id={SETTINGS_GROUPS[0].id} className="pt-2 space-y-4" aria-label="Profile & training">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink3">{SETTINGS_GROUPS[0].title}</h3>
          <span className="flex-1 h-px bg-line" />
        </div>

        <section id="sec-personalise" className="rounded-2xl border border-line bg-surface p-4 space-y-3">
          <h4 className="text-sm font-bold">Goals, equipment & schedule</h4>
          <p className="text-xs text-ink3">Your goal, kit, level, weekly schedule and units. These shape generated programmes and every recommendation. Workout entry follows your unit choice; storage, engine math and backups stay in kilograms.</p>
          <div className="rounded-xl border border-line bg-surface2 px-3 py-2 text-sm">
            <p className="font-semibold">Current profile</p>
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
          <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
            <p className="text-xs font-bold">Weight units</p>
            <p className="text-[11px] text-ink3">Workout entry and display use this unit. Storage, engine math and backups stay in kilograms.</p>
            <div className="flex gap-1.5" role="group" aria-label="Weight units">
              {[['kg','Kilograms'],['lb','Pounds']].map(([value, label]) => (
                <button key={value} onClick={()=> setPreference({ units:value })} aria-pressed={(prefs.units || 'kg') === value}
                  className={`flex-1 min-h-10 rounded-xl border px-2 py-1.5 text-xs font-bold ${(prefs.units || 'kg') === value ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink3'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-ink3">How much detail the app shows lives in <button onClick={()=> jumpToSetting('sec-appearance')} className="underline font-semibold">Appearance & accessibility</button>.</p>
        </section>

        <Suspense fallback={null}>
          <TrainingPolicySettings store={store} setStore={setStore} />
        </Suspense>
      </div>

      {/* ── WORKOUT EXPERIENCE: sessions in the gym, rest behaviour, guided coaching ── */}
      <div id={SETTINGS_GROUPS[1].id} className="pt-2 space-y-4" aria-label="Workout experience">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink3">{SETTINGS_GROUPS[1].title}</h3>
          <span className="flex-1 h-px bg-line" />
        </div>

        <section id="sec-gym" className="rounded-2xl border border-line bg-surface p-4 space-y-3">
          <h4 className="text-sm font-bold">Gym mode</h4>
          <p className="text-xs text-ink3">Built for one-thumb logging between sets: focus mode, swipe gestures and a load keypad live inside every standard session (the 🏋️ button in the session header).</p>

          <ToggleRow
            label="Focus mode by default"
            hint="Open every session showing one exercise at a time with the swipe hint bar and skip-to search."
            checked={store.gymPrefs?.focusDefault === true}
            onChange={value=> setGymPref({ focusDefault: value })}
          />

          <ToggleRow
            label="Keep screen awake"
            hint="Requests the screen wake lock for the whole session, so your phone never dims mid-rest. Re-applies itself after tab switches; released on exit."
            checked={prefs.wakeLock === true}
            onChange={value=> setPreference({ wakeLock: value })}
          />

          <ToggleRow
            label="Cautious mode"
            hint="Training-safety checks use earlier, gentler thresholds: volume and load jumps, implausible PRs and repeated pain are flagged sooner. Advice only — the engine already clamps itself."
            checked={prefs.cautiousMode === true}
            onChange={value=> setPreference({ cautiousMode: value })}
          />

          <ToggleRow
            label="Automatic rest timer"
            hint="Starts the countdown as soon as you mark a set done. The per-exercise “Start rest” button stays available either way."
            checked={prefs.autoRest !== false}
            onChange={value=> setPreference({ autoRest: value })}
          />

          <ToggleRow
            label="Haptic feedback"
            hint="Short vibration pulses when a set is logged, rest ends, or a guided step advances. Android and most non-iOS browsers; iOS Safari does not expose vibration to web apps."
            checked={prefs.haptics !== false}
            onChange={value=> setPreference({ haptics: value })}
          />

          <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5">
            <p className="text-xs font-bold">Rest presets by exercise</p>
            {restPresetEntries.length ? (
              <ul className="mt-2 space-y-1">
                {restPresetEntries.map(([exerciseId, seconds])=> (
                  <li key={exerciseId} className="flex items-center gap-2 text-xs">
                    <span className="truncate">{exerciseName(exerciseId)}</span>
                    <span className="ml-auto font-bold tabular-nums shrink-0">{seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}</span>
                    <button onClick={()=> { const nextTs = { ...((store.gymPrefs?.restPresetUpdatedAt && typeof store.gymPrefs.restPresetUpdatedAt === 'object') ? store.gymPrefs.restPresetUpdatedAt : {}) }; delete nextTs[exerciseId]; setStore({ ...store, gymPrefs: { ...(store.gymPrefs||{}), restPresets: setRestPreset(store.gymPrefs, exerciseId, 0), restPresetUpdatedAt: nextTs, updatedAt: new Date().toISOString() } }); }} aria-label={`Clear rest preset for ${exerciseName(exerciseId)}`} className="shrink-0 w-8 h-8 grid place-items-center rounded-full border border-line text-ink3">✕</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-ink3 mt-1">None yet — tap a preset chip on the rest timer during a session and it is remembered for that exercise.</p>
            )}
          </div>
        </section>

        <Suspense fallback={null}>
          <GuidedSettings store={store} setStore={setStore} />
        </Suspense>
      </div>

      {/* ── APPEARANCE & ACCESSIBILITY ── */}
      <div id={SETTINGS_GROUPS[2].id} className="pt-2 space-y-4" aria-label="Appearance & accessibility">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink3">{SETTINGS_GROUPS[2].title}</h3>
          <span className="flex-1 h-px bg-line" />
        </div>
        <Suspense fallback={null}>
          <AppearanceAccessibilitySettings store={store} setStore={setStore} />
        </Suspense>
      </div>

      {/* ── DATA: keeping a copy, moving it between devices, recovering it ── */}
      <div id={SETTINGS_GROUPS[3].id} className="pt-2 space-y-4" aria-label="Data">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink3">{SETTINGS_GROUPS[3].title}</h3>
          <span className="flex-1 h-px bg-line" />
        </div>

        <section id="sec-backup" className="rounded-2xl border border-line bg-surface p-4 space-y-3">
          <h4 className="text-sm font-bold">Backup & portability</h4>
          {backupDue && (
            <div role="status" className="rounded-xl border border-review/40 bg-reviewsoft px-3 py-2 text-xs space-y-1">
              <p className="font-bold">Time for a backup</p>
              <p className="text-ink3">It's been over a week since your last full backup. A recoverable local file is your safety copy.</p>
              <div className="flex gap-2">
                <button onClick={exportNow} className="btn btn-primary min-h-8 rounded-lg px-2.5 text-[11px]">Export now</button>
                <button onClick={dismissBackupReminder} className="underline font-semibold">Remind me next week</button>
              </div>
            </div>
          )}
          {integrity && (
            <div role="alert" className="rounded-xl border border-danger/40 bg-dangersoft px-3 py-2 text-xs space-y-1">
              <p className="font-bold">Stored data needed repair on startup.</p>
              <p className="text-ink3">A broken copy was kept in quarantine and the readable parts were restored. Nothing was lost silently. Details: {integrity.errors.join(' ')}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <button onClick={exportSalvage} className="underline font-semibold">Export salvaged history</button>
                <button onClick={()=> { dataLifecycleService.dismissIntegrityNotice(); setNoticeDismissed(true); }} className="underline font-semibold">Dismiss</button>
              </div>
            </div>
          )}
          <p className="text-xs text-ink3">Local-first — your history lives on this device. Export JSON (full versioned backup: live + archived training history), an encrypted backup (same complete history, sealed), or CSV (live history only) and restore/merge on another device. No account required.</p>
          {store.demo && (
            <p className="text-xs text-ink2 bg-reviewsoft border border-review/30 rounded-xl px-3 py-2" role="note">
              <strong>Demo mode:</strong> export is disabled — this is sample data, not yours. Exit demo to start your real log.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={exportNow} disabled={store.demo === true} className="btn btn-primary min-h-10 rounded-xl px-4 disabled:opacity-40">Export JSON</button>
            <button onClick={exportEncrypted} disabled={store.demo === true} className="btn btn-primary min-h-10 rounded-xl px-4 disabled:opacity-40">Export encrypted</button>
            <button onClick={exportCsv} className="btn btn-secondary min-h-10 rounded-xl px-4">Export CSV</button>
            <label className="btn btn-secondary min-h-10 rounded-xl px-4 cursor-pointer">
              Import backup
              <input ref={fileRef} type="file" accept=".arise,.json,application/json" className="hidden" onChange={onPickFile} />
            </label>
            <label className="btn btn-secondary min-h-10 rounded-xl px-4 cursor-pointer">
              Import encrypted
              <input type="file" accept=".arisebak,application/octet-stream" className="hidden" onChange={onPickEncrypted} />
            </label>
            <label className="btn btn-secondary min-h-10 rounded-xl px-4 cursor-pointer" title="Import a CSV exported from another gym app">
              Import from other apps (CSV)
              <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={onPickAppCsv} />
            </label>
          </div>
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
                <span>{importPreview.counts.sessions} live session{importPreview.counts.sessions === 1 ? '' : 's'}{importPreview.counts.archived ? ` + ${importPreview.counts.archived} archived` : ''}</span>
                <span>{importPreview.counts.sets} set{importPreview.counts.sets === 1 ? '' : 's'}</span>
                {importPreview.counts.events > 0 && <span>{importPreview.counts.events} event{importPreview.counts.events === 1 ? '' : 's'}</span>}
                {importPreview.counts.ledger > 0 && <span>{importPreview.counts.ledger} recommendation record{importPreview.counts.ledger === 1 ? '' : 's'}</span>}
                {importPreview.counts.templates > 0 && <span>{importPreview.counts.templates} template{importPreview.counts.templates === 1 ? '' : 's'}</span>}
                {importPreview.counts.experiments > 0 && <span>{importPreview.counts.experiments} experiment{importPreview.counts.experiments === 1 ? '' : 's'}</span>}
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
                <button onClick={async ()=> { if(importStrategy==='replace'){ const ok = await dialogs.confirm({ title:'Replace this device with the backup?', description:'Replace overwrites ALL data on this device with the backup — your current history, programs and settings are gone. Export a backup first if in doubt.', confirmLabel:'Replace everything', cancelLabel:'Go back', destructive:true }); if(!ok) return; } applyImportPreview(); }} className="btn btn-primary min-h-9 rounded-xl px-4">Apply {importStrategy}</button>
                <button onClick={()=> setImportPreview(null)} className="btn btn-secondary min-h-9 rounded-xl px-4">Cancel</button>
              </div>
            </div>
          )}
          <details className="text-xs">
            <summary className="font-semibold cursor-pointer">What’s in the backup?</summary>
            <div className="mt-2 rounded-xl border border-line bg-surface2 px-3 py-2">
              <p className="font-semibold">This export would contain (live + archived history):</p>
              <p className="text-ink3 mt-0.5">
                {(store.history||[]).length} live session(s){(store.archivedHistory||[]).length ? ` + ${(store.archivedHistory||[]).length} archived` : ''} ·
                {[...(store.history||[]), ...(store.archivedHistory||[])].reduce((n,h)=> n + (h.blocks||[]).reduce((m,b)=> m + (b.sets||[]).length, 0), 0)} set(s) ·
                {(store.customTemplates||[]).length} template(s) ·
                {(store.experiments||[]).filter(e=> !e.deletedAt).length} experiment(s) ·
                {(store.readinessLog||[]).length} readiness entr{(store.readinessLog||[]).length === 1 ? 'y' : 'ies'} ·
                {getEventHistory().length} event(s)
                {store.studyParticipantId ? ' · your pseudonymous study id' : ''}
              </p>
              <p className="text-[11px] text-ink3 mt-1">Excluded by design: crash logs, telemetry granular options, sync credentials, consent toggles.</p>
            </div>
            <pre className="mt-2 overflow-auto rounded-xl bg-surface2 border border-line p-3 text-[11px] leading-relaxed">{JSON.stringify({ app:'arise', version:3, schemaVersion:4, exportedAt:'…', data:{ onboarding:'{goal,equipment,location,level,daysPerWeek,availableMinutes,preferredExerciseIds,dislikedExerciseIds,plateConfig}', activeSchedule:'{programId,sessions}', activeWorkout:'recoverable draft or null', history:'[{id,date,blocks:[{exerciseId,sets:[{reps,weightKg,rpe,side,rom}]}]}]', preferences:'{units,theme,telemetryEnabled,pulseEnabled,healthSummaryEnabled}', eventHistory:'[{id,type,at,payload}]', healthSummary:'optional summary or null' }}, null, 2)}</pre>
          </details>
          <details className="rounded-xl border border-line bg-surface2 px-3 py-2 text-xs">
            <summary className="font-semibold cursor-pointer">Share more — coach summary, slices of data, printing</summary>
            <p className="text-ink3 mt-1.5">Coach export aggregates only by default: best sets and weekly volume. Tick extra sections; nothing identity-bearing is included, and a coach export never contains your backups, events or credentials.</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={coachSections.performance} onChange={(e)=> setCoachSections({ ...coachSections, performance: e.target.checked })} /> Per-exercise bests</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={coachSections.weekly} onChange={(e)=> setCoachSections({ ...coachSections, weekly: e.target.checked })} /> Weekly volume</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={coachSections.readiness} onChange={(e)=> setCoachSections({ ...coachSections, readiness: e.target.checked })} /> Readiness scores</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={coachSections.detail} onChange={(e)=> setCoachSections({ ...coachSections, detail: e.target.checked })} /> Full set detail</label>
            </div>
            <button onClick={exportCoach} className="btn btn-primary min-h-8 rounded-lg px-2.5 text-[11px] mt-2">Download coach summary (.md)</button>
            <button onClick={()=> { import('../lib/printReport.js').then(({ printProgressReport }) => printProgressReport(store, { units: store.preferences?.units === 'lb' ? 'lb' : 'kg' })); }} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px] mt-2">Print / save as PDF</button>
            <button onClick={shareCoach} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px] mt-2">Share…</button>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="self-center text-[11px] text-ink3">Partial export:</span>
              <button onClick={()=> exportPartial('history')} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px]">History only</button>
              <button onClick={()=> exportPartial('settings')} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px]">Settings only</button>
              <button onClick={()=> exportPartial('events')} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px]">Events only</button>
            </div>
            <button onClick={exportEvents} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px] mt-2">Export events</button>
          </details>
        </section>

        <section id="sec-sync" className="rounded-2xl border border-line bg-surface p-4 space-y-3">
          <p className="text-xs text-ink3">Cross-device sync merges deterministically (newest session wins per id via savedAt; archived history travels too; deletions propagate via tombstones; active workout/schedule and Gym rest presets converge by recency). Either sync direction reaches the same result.</p>
          <Suspense fallback={<p className="text-xs text-ink3">Loading sync settings…</p>}>
            <SyncPanel store={store} setStore={setStore} setMsg={setMsg} />
          </Suspense>
          {msg && <p role="status" className="text-xs bg-surface2 border border-line rounded-xl px-3 py-2">{msg}</p>}
        </section>

        <section id="sec-storage" className="rounded-2xl border border-line bg-surface p-4 space-y-3">
          <h4 className="text-sm font-bold">Storage & recovery</h4>
          <p className="text-xs text-ink3">How much space your data uses, whether the browser may evict it, and the recovery tools if anything ever needs repair.</p>
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
          <Suspense fallback={null}><StorageDiagnostics setMsg={setMsg} /></Suspense>
        </section>
      </div>

      {/* ── PRIVACY & INTEGRATIONS: what is measured, what can leave, and where ── */}
      <div id={SETTINGS_GROUPS[4].id} className="pt-2 space-y-4" aria-label="Privacy & integrations">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink3">{SETTINGS_GROUPS[4].title}</h3>
          <span className="flex-1 h-px bg-line" />
        </div>

        <section id="sec-privacy" className="rounded-2xl border border-line bg-surface p-4 space-y-2">
          <h4 className="text-sm font-bold">Privacy & data controls</h4>
          <p className="text-xs text-ink3">Local-first. Event measurements stay on this device. Nothing is sent to Pulse or a health platform unless you explicitly enable that separate integration.</p>

          {/* ── Demo mode: clearly labeled sample data, one-tap honest exit ── */}
          <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold">Demo mode</p>
              <span className="ml-auto text-[11px] text-ink3">{store.demo ? 'active — sample data' : 'off'}</span>
            </div>
            {store.demo ? (
              <>
                <p className="text-[11px] text-ink3">Sample data is labeled everywhere (banner + demo- prefixed sessions). “Start fresh” in the banner wipes it and boots an empty app — export is disabled by design so demo data can never masquerade as yours.</p>
              </>
            ) : (
              <>
                <p className="text-[11px] text-ink3">Loads a clearly labeled, fully populated sample (a month of training on a live schedule). Your current data — if any — is snapshotted first; exiting demo erases the sample and restores an empty start.</p>
                <button
                  onClick={async ()=> {
                    await onLoadDemo?.();
                  }}
                  className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs"
                >
                  Load demo data
                </button>
              </>
            )}
          </div>

          <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
            <div className="flex items-center gap-2"><p className="text-xs font-bold">Local measurements</p><span className="ml-auto text-[11px] text-ink3">{store.preferences?.telemetryEnabled===true?'enabled':store.preferences?.telemetryEnabled===false?'disabled':'choice needed'}</span></div>
            <p className="text-[11px] text-ink3">Measures set logging time, session abandonment and recommendation acceptance. It never leaves this device.</p>
            <div className="flex gap-2">
              <button onClick={()=> setTelemetryConsent(true)} className="btn btn-primary min-h-9 rounded-xl px-3 text-xs">Allow local measurements</button>
              <button onClick={()=> setTelemetryConsent(false)} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">Keep private</button>
            </div>
            {store.preferences?.telemetryEnabled === true && (
              <div className="space-y-1.5 pt-1">
                <ToggleRow bare label="Error diagnostics" hint="Keeps the last 50 crash reports locally (message + stack head, nothing else). Never in exports."
                  checked={store.preferences?.telemetryOptions?.errorDiagnostics === true}
                  onChange={(v)=> setStore(setTelemetryOption(store, 'errorDiagnostics', v))} />
                <ToggleRow bare label="Set logging times" hint="Adds how long each set takes to log to the timing metric. Excluded when off."
                  checked={store.preferences?.telemetryOptions?.sessionTimings === true}
                  onChange={(v)=> setStore(setTelemetryOption(store, 'sessionTimings', v))} />
                <ToggleRow bare label="Quarterly consent review reminder" hint="A local reminder to re-read these choices. Stored on this device only."
                  checked={store.preferences?.consentReview?.remind === true}
                  onChange={(v)=> setStore(setConsentReviewReminder(store, v))} />
                {store.preferences?.consentReview?.remind === true && consentReviewDue && (
                  <div className="rounded-lg border border-review/30 bg-reviewsoft px-2.5 py-2 text-[11px]">
                    <p className="font-bold">Consent review due</p>
                    <p className="text-ink3 mt-0.5">You last reviewed these choices {Math.round((Date.now() - Date.parse(store.preferences.consentReview.lastReviewedAt)) / 86400000)} days ago.</p>
                    <button onClick={()=> setStore(acknowledgeConsentReview(store))} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px] mt-1">Mark reviewed</button>
                  </div>
                )}
              </div>
            )}
          </div>
          <details className="rounded-xl border border-line bg-surface2 px-3 py-2">
            <summary className="text-sm font-semibold cursor-pointer">What is shared?</summary>
            <div className="text-xs text-ink3 mt-2 space-y-1.5">
              <p><span className="font-semibold text-ink">By default: nothing.</span> No account, no analytics service, no trackers (enforced by this app's Content-Security-Policy, not just a promise). Arise is local-first: no training data leaves the device automatically.</p>
              <p><span className="font-semibold text-ink">Optional AI coach (NVIDIA).</span> When you paste your own NVIDIA API key and press Ask, a request goes to NVIDIA's model endpoint containing aggregated training numbers and the deterministic engine's findings only — never raw set-by-set history, notes or health summaries. Your key travels as the request credential and is session-only by default; it never enters exports, sync, backups, diagnostics or telemetry. The coach only explains — training prescriptions always come from the deterministic engine, and no cloud AI is required for any training functionality.</p>
              <p>Separate consent controls Pulse sharing, health-platform summary import, local telemetry, classifier.dev feedback categorisation, and classifier.dev coach-request routing. The feedback channel sends only redacted feedback for triage; the coach channel sends only an ambiguous redacted question for lane selection. Both classifier.dev channels are off by default. Neither sends feedback to the Arise developer or creates training prescriptions.</p>
              <p>Exercise illustrations load from one static host (bryllim.github.io). That request carries no identity beyond your IP — the browser sends nothing else.</p>
            </div>
          </details>
          <details className="rounded-xl border border-line bg-surface2 px-3 py-2">
            <summary className="text-sm font-semibold cursor-pointer">What is stored on this device?</summary>
            <div className="text-xs text-ink3 mt-2 space-y-1.5">
              <p><span className="font-semibold text-ink">Always:</span> your training history, programs, templates, readiness log, preferences and the event ledger — all local, all in your backups, all deleted by "Erase all Arise data from this device".</p>
              <p><span className="font-semibold text-ink">Never:</span> health summaries and study identity travel nowhere on their own — they exist only inside exports you create.</p>
              <p><span className="font-semibold text-ink">Excluded from every export:</span> error diagnostics and the granular telemetry options (device-local by design).</p>
              <p>Telemetry (opt-in) records recommendation acceptance and logging timings with free-text fields stripped by the sanitizer before write.</p>
            </div>
          </details>
        </section>

        <Suspense fallback={null}>
          <AiCoachSettings store={store} />
        </Suspense>
        <Suspense fallback={null}>
          <FeedbackSettings />
        </Suspense>

        <section id="sec-integrations" className="rounded-2xl border border-line bg-surface p-4 space-y-2">
          <h4 className="text-sm font-bold">Sharing & integrations</h4>
          <p className="text-xs text-ink3">Each sharing integration is off until you switch it on, and each sends only what its own card states.</p>
          <details className="rounded-xl border border-line bg-surface2 px-3 py-2">
            <summary className="text-sm font-semibold cursor-pointer">Pulse connector</summary>
            <p className="text-xs text-ink3 mt-2">When enabled, completed sessions and weekly volume can be pushed to Pulse. Requires a Pulse adapter — configure via <code>window.__PULSE_ADAPTER__</code> (see <code>src/lib/pulse.js</code>). Data is only sent when you allow it.</p>
            <p className="text-xs text-ink3 mt-1">Current: {store.preferences?.pulseEnabled ? 'enabled' : 'disabled'}.</p>
            <button onClick={()=> setPulseConsent(!store.preferences?.pulseEnabled)} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs mt-2">{store.preferences?.pulseEnabled?'Disable Pulse sharing':'Enable Pulse sharing'}</button>
          </details>
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
            <summary className="text-sm font-semibold cursor-pointer">Privacy, ownership & disclaimers</summary>
            <div className="text-xs text-ink3 mt-2 space-y-2">
              <p><span className="font-semibold text-ink">Data ownership.</span> Everything Arise stores is yours: it lives on your device, exports are plain files, and deleting the data removes it from this device. There is no server copy and no account — but files you already shared (backups, study exports) are copies outside the app that deleting here cannot reach.</p>
              <p><span className="font-semibold text-ink">Not medical advice.</span> Arise is a training-log tool with heuristic recommendations. It does not diagnose, treat or prevent any condition. Consult a qualified health professional before starting or changing an exercise program, especially with pre-existing conditions, injuries or during pregnancy.</p>
              <p><span className="font-semibold text-ink">High-intensity caution.</span> Aggressive progression policies and proximity-to-failure targets raise injury risk when misapplied. Treat every recommendation as a suggestion — reduce load or stop entirely if you feel sharp pain, dizziness or unusual discomfort.</p>
              <p><span className="font-semibold text-ink">Privacy policy (short form).</span> Arise is local-first: data stays on this device unless you export it or explicitly enable a sharing integration. Telemetry is opt-in and device-local. No third-party trackers, ads or analytics are included. Crash logs (opt-in) stay local, are capped at 50 and are excluded from exports.</p>
            </div>
          </details>
        </section>
      </div>

      {/* ── ABOUT / ADVANCED: guidance, research, diagnostics, expert settings ── */}
      <div id={SETTINGS_GROUPS[5].id} className="pt-2 space-y-4" aria-label="About / advanced">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink3">{SETTINGS_GROUPS[5].title}</h3>
          <span className="flex-1 h-px bg-line" />
        </div>

        <section id="sec-help" className="rounded-2xl border border-line bg-surface p-4 space-y-2">
          <h4 className="text-sm font-bold">Help, about & legal</h4>
          <details className="rounded-xl border border-line bg-surface2 px-3 py-2">
            <summary className="text-sm font-semibold cursor-pointer">Accessibility statement</summary>
            <div className="text-xs text-ink2 mt-2 space-y-2">
              <p>Arise aims to conform to <strong>WCAG 2.1 AA</strong>. What that means in the app today:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li><strong>Keyboard</strong> — every control is reachable by Tab; modal dialogs (sessions, onboarding, template builder) trap Tab inside and restore focus to the opener on close; a visible focus ring is shown for keyboard input only.</li>
                <li><strong>Screen readers</strong> — controls carry programmatic labels; status changes (rest minute marks, rest completion, guided step changes, set progress) go through one throttled, deduplicated polite live region so the countdown never spams; the e1RM chart ships a text summary plus a full data table.</li>
                <li><strong>Motion</strong> — Reduce motion (in-app or your OS setting) disables animations and smooth scrolling. Voice coach and screen-reader announcements never fight: TTS-spoken text is excluded from the live region.</li>
                <li><strong>Vision</strong> — Large-text mode scales type; high-contrast mode strengthens ink/lines; the layout survives Windows High Contrast (forced-colors). Status is never color alone — chips carry text or icons; gestures (swipe to complete/fail, long-press) all have button equivalents.</li>
                <li><strong>Timing</strong> — rest timers are wall-clock based and pause-safe; nothing expires mid-interaction.</li>
              </ul>
              <p>Known gaps: VoiceOver/TalkBack behaviour is verified by manual testing only (the checklist below), not automated; some third-party illustration labels are decorative. Report anything you hit via the feedback link — fixes land fast.</p>
            </div>
          </details>
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
            <p className="text-xs text-ink3 mt-2">A training log and coach: scheduled programs, honest load tracking, and progress derived from what you actually log — with the reasoning shown. <span className="font-semibold text-ink">No nutrition system</span> — that would recreate Forq and dilute the training proposition.</p>
          </details>
          <details className="rounded-xl border border-line bg-surface2 px-3 py-2">
            <summary className="text-sm font-semibold cursor-pointer">Legal & disclaimers</summary>
            <div className="text-xs text-ink2 mt-2 space-y-2">
              <p><span className="font-semibold text-ink">Not medical advice.</span> Arise is not a medical device and does not diagnose, treat, or predict anything about your health. Suggestions are arithmetic over your own logs. Consult a qualified health professional before starting or changing an exercise program.</p>
              <p><span className="font-semibold text-ink">Train at your own risk.</span> High-intensity suggestions raise injury risk when misapplied — reduce load or stop if you feel sharp pain, dizziness or unusual discomfort.</p>
              <p><span className="font-semibold text-ink">Your data is yours.</span> It lives in this browser on this device; Arise claims no license over it and cannot read it. Export or erase it any time from More → Data. Full statements: <a className="underline" href="https://github.com/henrygoldsmith07-wq/arise/blob/main/docs/TERMS.md" target="_blank" rel="noreferrer">Terms</a> · <a className="underline" href="https://github.com/henrygoldsmith07-wq/arise/blob/main/docs/PRIVACY_POLICY.md" target="_blank" rel="noreferrer">Privacy policy</a> · <a className="underline" href="https://github.com/henrygoldsmith07-wq/arise/blob/main/docs/DISCLAIMERS.md" target="_blank" rel="noreferrer">Disclaimers</a>.</p>
              <p><span className="font-semibold text-ink">License.</span> Code: MIT. Exercise illustrations: CC BY-SA 4.0 (attributed per illustration).</p>
            </div>
          </details>
        </section>

        <Suspense fallback={null}>
          <EvidenceSettings store={store} setStore={setStore} />
        </Suspense>

        <details id="sec-advanced" className="rounded-2xl border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-bold">Advanced — diagnostics & expert settings</summary>
          <div className="px-4 pb-4 space-y-4">
            <p className="text-xs text-ink3">Diagnostics and expert tools live here so everyday training stays simple. Nothing is hidden from you — open a card to see exactly what it does.</p>
            <div className="rounded-2xl border border-line bg-surface p-4 space-y-2">
              <h4 className="text-sm font-bold">Diagnostics</h4>
              <p className="text-xs text-ink3">Inspect what is recorded on this device and share a support bundle when reporting a problem. Both stay local until you send them yourself.</p>
              <div className="flex flex-wrap gap-2">
                <button onClick={()=> { setShowTelemetry(v=>!v); }} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">{showTelemetry?'Hide':'Show'} local telemetry</button>
                <button onClick={()=> { clearTelemetry(); clearErrorEvents(); setStore(clearEventHistoryStore(store), { collectionMode:'replace' }); flashMsg('Local telemetry and crash logs cleared.', 2000); }} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">Clear telemetry</button>
                <button onClick={()=> { setShowErrors(v=>!v); }} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">{showErrors?'Hide':'Show'} crash logs</button>
                <button onClick={()=> { clearErrorEvents(); flashMsg('Crash logs cleared.', 2000); }} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">Clear crash logs</button>
                <button onClick={exportSupportBundle} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">Support diagnostics</button>
              </div>
              {showTelemetry && (
                <pre className="text-[11px] overflow-auto rounded-xl bg-surface2 border border-line p-3">{JSON.stringify(telemetrySummary(), null, 2)}</pre>
              )}
              {showErrors && (
                <pre className="text-[11px] overflow-auto rounded-xl bg-surface2 border border-line p-3">{getErrorEvents().length ? JSON.stringify(getErrorEvents(), null, 2) : 'No crash logs recorded.'}</pre>
              )}
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4 space-y-2">
              <h4 className="text-sm font-bold">Expert settings</h4>
              <p className="text-xs text-ink3">The one destructive operation on this device, kept well away from everyday buttons. Ordinary backup, export and sync stay in Data above.</p>
              <div className="mt-2">
                <button onClick={eraseAllData} className="text-xs font-bold text-danger underline underline-offset-2">Erase all Arise data from this device</button>
                <p className="text-[11px] text-ink3 mt-1">History, schedule, readiness, settings, event ledger and crash logs on this device. Exports and snapshots you keep elsewhere are untouched.</p>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
