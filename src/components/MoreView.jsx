import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { buildExportPayload, downloadJson, parseImportFile, mergeStores, portableCsv, deletionPreview, downloadBackup, parseBackupFile } from '../lib/export.js';
import { buildImportPreview, getAppVersion } from '../lib/exportPolicy.js';
import { clearStore } from '../lib/store.js';
import { clearAllStoredData, getIntegrityNotice, clearIntegrityNotice, whenPersisted } from '../lib/storage.js';
import { buildPartialExportPayload } from '../lib/export.js';
import { buildCoachExport, renderCoachMarkdown } from '../lib/coachExport.js';
import { shareTextAsFile } from '../lib/nativeShare.js';
const SyncPanel = lazy(() => import('./SyncPanel.jsx'));
import { storageHealth, requestPersistentStorage } from '../lib/storageQuota.js';
import { cryptoAvailable, encryptBackup, decryptBackup, looksEncrypted } from '../lib/cryptoBackup.js';
import { clearTelemetry, telemetrySummary, getEventHistory, mergeEventHistory, replaceEventHistory, recordEvent, getErrorEvents, clearErrorEvents } from '../lib/telemetry.js';
import { mergeHealthSummary, pullHealthSummary } from '../lib/health.js';
import { LOCATIONS, GOALS } from '../lib/data.js';
import { loadEvaluationLedger, loadArchivedEvaluationCount } from '../lib/longitudinal.js';
import { deriveProgressionModel } from '../lib/progressionModel.js';
import { getAiSettings, saveAiSettings, clearAiSettings, buildTrainingContext, requestCoachInsight, DEFAULT_MODEL, aiCoachRoute, COACH_FEEDBACK_URL } from '../lib/aiCoach.js';
import { STUDY_ARMS, studyCoverage, runComparativeStudy, collectDeloadDecisions, validateDeloadDecisions } from '../lib/study.js';
import { enrollmentAudit } from '../lib/studyEnrollment.js';
import { isValidStudyParticipantId } from '../lib/studyIdentity.js';
import { studyEligibility, joinStudy, withdrawFromStudy, participationStatus, participationCopy } from '../lib/participation.js';
import { fieldStudyStatus } from '../lib/fieldStudy.js';
import { voiceSupported } from '../lib/voiceCoach.js';
import { setRestPreset } from '../lib/gymMode.js';
import { EXERCISE_BY_ID } from '../lib/data.js';
import { PROGRESSION_POLICIES, POLICY_ORDER } from '../lib/progressionPolicies.js';
import { EXPERIENCE_LEVELS, EXPERIENCE_INFO, experiencePatch, resolveExperience } from '../lib/experienceMode.js';
import { makeDemoStore } from '../lib/demoData.js';
import { captureSnapshot } from '../lib/snapshots.js';
import { buildSupportBundle } from '../lib/supportDiagnostics.js';
import { buildSalvagePayload } from '../lib/salvageExport.js';
import { normaliseHistoryEntry } from '../lib/store.js';
import {
  CLASSIFIER_TAXONOMY_VERSION,
  classifyFeedback,
  clearClassifierSettings,
  getCoachRoutingSettings,
  getFeedbackClassifierSettings,
  redactTextForClassification,
  saveCoachRoutingSettings,
  saveFeedbackClassifierSettings,
} from '../lib/feedbackClassifier.js';
import {
  buildFeedbackRecord,
  buildFeedbackSharePayload,
  clearFeedbackRecords,
  formatFeedbackSharePayload,
  loadFeedbackRecords,
  markFeedbackReviewed,
  saveFeedbackRecord,
} from '../lib/feedbackStore.js';
const StorageDiagnostics = lazy(()=> import('./StorageDiagnostics.jsx'));
const EvidenceDashboard = lazy(()=> import('./EvidenceDashboard.jsx'));

export default function MoreView({ store, setStore, setTab, onboardingOpen, setOnboardingOpen }){
  const [importStrategy,setImportStrategy]=useState('merge');
  const [msg,setMsg]=useState(null);
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
  const [evidenceOpen,setEvidenceOpen]=useState(false);
  const ai = getAiSettings();
  const [aiKeyInput,setAiKeyInput]=useState('');
  const [aiPrompt,setAiPrompt]=useState('');
  const [aiModelInput,setAiModelInput]=useState(ai.model || DEFAULT_MODEL);
  const [aiEnabled,setAiEnabled]=useState(ai.enabled);
  const [aiBusy,setAiBusy]=useState(false);
  const [aiResult,setAiResult]=useState(null);
  const [feedbackClassifierEnabled,setFeedbackClassifierEnabled]=useState(()=> getFeedbackClassifierSettings().enabled);
  const [coachRoutingEnabled,setCoachRoutingEnabled]=useState(()=> getCoachRoutingSettings().enabled);
  const [feedbackText,setFeedbackText]=useState('');
  const [feedbackBusy,setFeedbackBusy]=useState(false);
  const [feedbackResult,setFeedbackResult]=useState(null);
  const [feedbackRecords,setFeedbackRecords]=useState(()=> loadFeedbackRecords());
  const [feedbackSharePreview,setFeedbackSharePreview]=useState(null);

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
      evidenceData = { coverage, comparative, deloads, model, ledger: loadEvaluationLedger(), archivedCount: loadArchivedEvaluationCount(), fieldStudy: fieldStudyStatus({ store, ledger: loadEvaluationLedger() }) };
    }catch{ evidenceSummary = 'unavailable'; }
  }

  const prefs = store.preferences || {};
  const a11y = prefs.accessibility || {};
  const setPreference = (patch)=> setStore({ ...store, preferences: { ...prefs, ...patch } });
  const setAccessibility = (patch)=> setStore({ ...store, preferences: { ...prefs, accessibility: { ...a11y, ...patch } } });
  const setGymPref = (patch)=> setStore({ ...store, gymPrefs: { ...(store.gymPrefs||{}), ...patch } });

  // Settings search: More has grown to nine sections; this index turns a
  // query into a jump. Matching scrolls the section into view and flashes it,
  // so nothing is hidden — filtering out sections would hide unrelated
  // settings the query happened not to name.
  const [searchQuery, setSearchQuery] = useState('');
  const settingsIndex = [
    { id: 'sec-gym', title: 'Gym mode', keywords: 'gym focus wake screen stay awake rest timer presets keypad swipe one thumb cautious mode safety pain' },
    { id: 'sec-backup', title: 'Backup & portability', keywords: 'backup export import csv encrypt data file' },
    { id: 'sec-appearance', title: 'Appearance & accessibility', keywords: 'theme dark light text contrast motion units kg lb pounds kilograms weight experience simple expert mode' },
    { id: 'sec-guided', title: 'Guided mode', keywords: 'guided sound cues voice coach speech rate maximum effort warnings' },
    { id: 'sec-policy', title: 'Training policy', keywords: 'policy conservative standard aggressive maintenance explanation confidence' },
    { id: 'sec-personalise', title: 'Personalise', keywords: 'onboarding goal kit location level equipment plates' },
    { id: 'sec-privacy', title: 'Privacy & data', keywords: 'privacy telemetry consent measurements delete storage diagnostics demo sample data' },
    { id: 'sec-ai', title: 'AI coach', keywords: 'ai coach model api key insight' },
    { id: 'sec-feedback', title: 'Feedback & issue triage', keywords: 'feedback issue report classifier categorisation category review cloud local coach routing privacy' },
    { id: 'sec-evidence', title: 'Progression evidence', keywords: 'evidence study ledger metrics calibration dashboard' },
    { id: 'sec-help', title: 'Help & testing', keywords: 'help testing diagnostics about version legal disclaimers terms privacy license medical' },
  ];
  const searchMatches = (()=>{
    const q = searchQuery.trim().toLowerCase();
    if(!q) return [];
    return settingsIndex.filter(s=> `${s.title} ${s.keywords}`.toLowerCase().includes(q));
  })();
  const jumpToSetting = (id)=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.scrollIntoView({ behavior:'smooth', block:'start' });
    el.classList.add('settings-flash');
    setTimeout(()=> el.classList.remove('settings-flash'), 1800);
  };

  const healthAdapter = typeof window !== 'undefined' ? window.__ARISE_HEALTH_ADAPTER__ : null;

  const markExported = ()=>{ try{ localStorage.setItem('arise.lastExportAt', new Date().toISOString()); }catch{} };

  const exportNow = ()=>{
    markExported();
    const payload = buildExportPayload(store);
    const date = new Date().toISOString().slice(0,10);
    // Compressed when the browser supports it; plain JSON otherwise — both
    // shapes import identically (parseBackupFile unwraps the envelope).
    downloadBackup(payload, `arise-backup-${date}.arise`);
    setMsg('Export downloaded — keep it somewhere safe.');
    setTimeout(()=> setMsg(null), 3000);
  };

  // ── Dedicated STUDY export (not the backup) ────────────────────────────────
  // The file the study tooling ingests: pseudonymous id, consent fact,
  // evidence slices, exportedAt — and none of the profile/credential fields a
  // backup must carry. Plain JSON, versioned; ingestion needs no conversion.
  // The serializer module is lazy-loaded: it exists for this one button, so
  // the boot chunk never carries it.
  const exportStudyData = ()=>{
    markExported();
    setMsg('Preparing study export…');
    import('../lib/studyExport.js').then(({ buildStudyExportPayload }) => {
      const envelope = buildStudyExportPayload(store);
      const date = new Date().toISOString().slice(0, 10);
      downloadJson(`arise-study-${date}.json`, envelope);
      setMsg('Study data exported — send this file to the study team.');
    }).catch((err) => setMsg(String(err?.message || err)));
    setTimeout(()=> setMsg(null), 4000);
  };

  const exportEncrypted = async ()=>{
    markExported();
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
    clearFeedbackRecords(); clearClassifierSettings();
    location.reload();
  };
  const exportCsv = ()=>{
    markExported();
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

  // Partial exports: one slice, same versioned envelope — a coach, a new
  // device or the study tooling each need only part of the store.
  const exportPartial = (kind)=>{
    try{
      const payload = buildPartialExportPayload(store, kind);
      const date = new Date().toISOString().slice(0,10);
      downloadJson(`arise-${kind}-${date}.json`, payload);
      setMsg(`${kind[0].toUpperCase()+kind.slice(1)} export downloaded.`);
    }catch(err){ setMsg(String(err.message || err)); }
    setTimeout(()=> setMsg(null), 4000);
  };

  // Coach export: consent-gated, human-readable summary. Nothing identity- or
  // health-bearing unless explicitly ticked; never credentials, never telemetry.
  const [coachSections, setCoachSections] = useState({ performance: true, weekly: true, readiness: false, detail: false });
  const shareCoach = async ()=>{
    const data = buildCoachExport(store, { sections: coachSections, weeks: 8 });
    const md = renderCoachMarkdown(data);
    const outcome = await shareTextAsFile({ text: md, filename: `arise-coach-${new Date().toISOString().slice(0,10)}.md`, mimeType: 'text/markdown', title: 'Training summary' });
    setMsg(outcome === 'shared' ? "Shared via your device's share sheet." : outcome === 'copied' ? 'Share sheet unavailable — summary copied to clipboard.' : 'Sharing cancelled.');
    setTimeout(()=> setMsg(null), 4000);
  };

  const exportCoach = ()=>{
    const data = buildCoachExport(store, { sections: coachSections, weeks: 8 });
    const md = renderCoachMarkdown(data);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `arise-coach-${new Date().toISOString().slice(0,10)}.md`; a.click();
    setTimeout(()=> URL.revokeObjectURL(url), 2000);
    setMsg('Coach summary downloaded — it contains only the sections ticked below.');
    setTimeout(()=> setMsg(null), 5000);
  };

  // Backup reminder: a gentle weekly nudge, dismissed until next week.
  const lastExportAt = (()=>{ try{ return localStorage.getItem('arise.lastExportAt'); }catch{ return null; } })();
  const [backupReminderDismissed, setBackupReminderDismissed] = useState(()=>{ try{ return localStorage.getItem('arise.backupReminderDismissedAt'); }catch{ return null; } });
  const WEEK_MS = 7 * 86400000;
  const newestSessionISO = (store.history||[]).length ? (store.history||[])[(store.history||[]).length-1].dateISO : null;
  const referenceAt = lastExportAt || (newestSessionISO ? Date.parse(newestSessionISO) : null);
  const backupReminderDue = referenceAt != null && (Date.now() - (lastExportAt ? Date.parse(lastExportAt) : referenceAt)) > WEEK_MS
    && (!backupReminderDismissed || (Date.now() - Date.parse(backupReminderDismissed)) > WEEK_MS);
  const dismissBackupReminder = ()=>{ const at = new Date().toISOString(); try{ localStorage.setItem('arise.backupReminderDismissedAt', at); }catch{} setBackupReminderDismissed(at); };

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
      const parsed = parseAppCsv(text, { byId: EXERCISE_BY_ID });
      if(!parsed.rows.length){
        setMsg(`No usable rows found (${parsed.skipped} skipped${parsed.unmappedExercises.length ? `; unknown exercises: ${parsed.unmappedExercises.slice(0, 5).join(', ')}` : ''}).`);
        setTimeout(()=> setMsg(null), 6000);
        return;
      }
      const entries = rowsToHistory(parsed.rows, { byId: EXERCISE_BY_ID }).map(en => normaliseHistoryEntry(en));
      const merged = mergeStores(store, { history: entries, eventHistory: [] }, 'merge');
      setStore({ ...merged });
      setMsg(`Imported ${parsed.rows.length} rows into ${entries.length} sessions${parsed.unmappedExercises.length ? ` · skipped unknown exercises: ${parsed.unmappedExercises.slice(0, 5).join(', ')}` : ''}.`);
    }catch(err){
      setMsg(String(err.message || err));
    }
    setTimeout(()=> setMsg(null), 6000);
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
    clearFeedbackRecords(); clearClassifierSettings();
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

  const setFeedbackClassifierConsent = (enabled)=>{
    saveFeedbackClassifierSettings({ enabled });
    setFeedbackClassifierEnabled(enabled);
    setMsg(enabled
      ? 'Feedback cloud categorisation enabled. Only redacted feedback may reach classifier.dev when you categorise it; nothing was shared with the developer.'
      : 'Feedback cloud categorisation disabled. Categorisation stays local.');
    setTimeout(()=> setMsg(null), 4500);
  };

  const setCoachRoutingConsent = (enabled)=>{
    saveCoachRoutingSettings({ enabled });
    setCoachRoutingEnabled(enabled);
    setMsg(enabled
      ? 'Coach cloud routing enabled. Only ambiguous, redacted coach questions may reach classifier.dev.'
      : 'Coach cloud routing disabled. Routing stays local.');
    setTimeout(()=> setMsg(null), 4500);
  };

  const submitFeedback = async ()=>{
    const redacted = redactTextForClassification(feedbackText);
    if(!redacted){
      setMsg('Enter a short issue or piece of feedback first.');
      setTimeout(()=> setMsg(null), 3000);
      return;
    }
    setFeedbackBusy(true);
    try{
      const classifiedAt = new Date().toISOString();
      const classification = await classifyFeedback(feedbackText);
      const record = buildFeedbackRecord({
        text: feedbackText,
        submittedAt: classifiedAt,
        classification: {
          ...classification,
          classifiedAt,
          taxonomyVersion: CLASSIFIER_TAXONOMY_VERSION,
        },
      });
      if(!saveFeedbackRecord(record)) throw new Error('Could not save feedback on this device.');
      setFeedbackRecords(loadFeedbackRecords());
      setFeedbackResult(record);
      setFeedbackText('');
      setMsg('Feedback categorised and saved locally. Nothing was sent to the developer.');
      setTimeout(()=> setMsg(null), 4500);
    }catch(err){
      setMsg(String(err?.message || err));
      setTimeout(()=> setMsg(null), 4500);
    }finally{
      setFeedbackBusy(false);
    }
  };

  const reviewFeedback = (id)=>{
    if(markFeedbackReviewed(id)) setFeedbackRecords(loadFeedbackRecords());
  };

  const prepareFeedbackShare = (record)=>{
    const payload = buildFeedbackSharePayload(record, { appVersion: getAppVersion() || '0.1.0' });
    if(!payload) return;
    setFeedbackSharePreview({ text: formatFeedbackSharePayload(payload) });
  };

  const shareFeedbackWithDeveloper = async ()=>{
    if(!feedbackSharePreview) return;
    const outcome = await shareTextAsFile({
      text: feedbackSharePreview.text,
      filename: `arise-feedback-${new Date().toISOString().slice(0, 10)}.json`,
      mimeType: 'application/json',
      title: 'Arise feedback report',
    });
    setMsg(outcome === 'shared'
      ? 'Redacted feedback report shared — no local record was sent automatically.'
      : outcome === 'copied'
        ? 'Redacted feedback report copied. Choose the developer as the recipient yourself.'
        : 'Sharing cancelled; nothing left the device.');
    if(outcome !== 'cancelled') setFeedbackSharePreview(null);
    setTimeout(()=> setMsg(null), 5000);
  };

  // Support bundle: environment + shape summary only, never training data.
  const exportSupportBundle = async ()=>{
    try{
      const bundle = await buildSupportBundle({ store });
      downloadJson(`arise-support-${new Date().toISOString().slice(0, 10)}.json`, bundle);
      setMsg('Support bundle downloaded — attach it when reporting a problem. It contains no training data.');
    }catch{ setMsg('Could not build the support bundle in this browser.'); }
    setTimeout(()=> setMsg(null), 5000);
  };
  // Recovery salvage: every intact history row from the current (possibly
  // repaired) store, before the user chooses rollback or a fresh start.
  const exportSalvage = ()=>{
    const payload = buildSalvagePayload(store);
    if(!payload){
      setMsg('Nothing salvageable was found — a snapshot rollback or backup import is the better path.');
    } else {
      downloadJson(`arise-salvage-${new Date().toISOString().slice(0, 10)}.json`, payload);
      setMsg(`Salvaged ${payload.data.history.length} sessions (${payload.droppedMalformed} unreadable rows skipped).`);
    }
    setTimeout(()=> setMsg(null), 5000);
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

  const generateInsight = async ()=>{
    if(aiBusy) return;
    const key = aiKeyInput.trim() || ai.apiKey;
    if(!aiPrompt.trim()){ setAiResult({ ok:false, error:'Ask a question first.' }); return; }
    setAiBusy(true);
    setAiResult(null);
    try{
      saveAiSettings({ apiKey: key, model: aiModelInput, enabled: true });
      setAiEnabled(true);
      // Intent routing happens BEFORE the cloud coach is touched: deterministic
      // keyword rules -> classifier.dev semantic fallback (opt-in, redacted) ->
      // lane only. The cloud coach never receives training prescriptions.
      const route = await aiCoachRoute(aiPrompt);
      if(route.lane === 'feedback-pipeline'){
        setAiResult({ ok:true, text:`That sounds like something to report. Please open an issue and include your support bundle (More → Data → Export support bundle).\n\n${COACH_FEEDBACK_URL}` });
        return;
      }
      if(route.lane === 'clarify'){
        setAiResult({ ok:false, error:'Could you rephrase that? I can explain past sessions or answer general coaching questions — I can’t prescribe future workouts.' });
        return;
      }
      if(route.lane === 'local-engine'){
        setAiResult({ ok:true, text:'That’s a training/progression question the deterministic engine already shows in Train and Progress — open a session there for the live recommendation and its reasoning.' });
        return;
      }
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

  const restPresetEntries = Object.entries(store.gymPrefs?.restPresets || {});
  const exerciseName = (id)=> EXERCISE_BY_ID[id]?.name || id;

  return (
    <div className="px-4 pt-5 pb-2 space-y-4 max-w-3xl mx-auto">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight">More</h2>
        <p className="text-xs text-ink3">Backup, portability, privacy and help.</p>
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

      <section id="sec-gym" className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <h3 className="text-sm font-bold">Gym mode</h3>
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

        <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5">
          <p className="text-xs font-bold">Rest presets by exercise</p>
          {restPresetEntries.length ? (
            <ul className="mt-2 space-y-1">
              {restPresetEntries.map(([exerciseId, seconds])=> (
                <li key={exerciseId} className="flex items-center gap-2 text-xs">
                  <span className="truncate">{exerciseName(exerciseId)}</span>
                  <span className="ml-auto font-bold tabular-nums shrink-0">{seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}</span>
                  <button onClick={()=> setGymPref({ restPresets: setRestPreset(store.gymPrefs, exerciseId, 0) })} aria-label={`Clear rest preset for ${exerciseName(exerciseId)}`} className="shrink-0 w-8 h-8 grid place-items-center rounded-full border border-line text-ink3">✕</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-ink3 mt-1">None yet — tap a preset chip on the rest timer during a session and it is remembered for that exercise.</p>
          )}
        </div>
      </section>

      <section id="sec-backup" className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <h3 className="text-sm font-bold">Backup & portability</h3>
        {backupReminderDue && (
          <div role="status" className="rounded-xl border border-review/40 bg-reviewsoft px-3 py-2 text-xs space-y-1">
            <p className="font-bold">Time for a backup</p>
            <p className="text-ink3">It&apos;s been over a week since your last export. A local file is the only copy of your training history.</p>
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
              <button onClick={()=> { clearIntegrityNotice(); setNoticeDismissed(true); }} className="underline font-semibold">Dismiss</button>
            </div>
          </div>
        )}
        <p className="text-xs text-ink3">Local-first — your history lives on this device. Export JSON (full, versioned), an encrypted backup, or CSV (history only) and restore/merge on another device. No account required.</p>
        {store.demo && (
          <p className="text-xs text-ink2 bg-reviewsoft border border-review/30 rounded-xl px-3 py-2" role="note">
            <strong>Demo mode:</strong> export is disabled — this is sample data, not yours. Exit demo to start your real log.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button onClick={exportNow} disabled={store.demo === true} className="btn btn-primary min-h-10 rounded-xl px-4 disabled:opacity-40">Export JSON</button>
          <button onClick={exportEncrypted} disabled={store.demo === true} className="btn btn-primary min-h-10 rounded-xl px-4 disabled:opacity-40">Export encrypted</button>
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
          <label className="btn btn-secondary min-h-10 rounded-xl px-4 cursor-pointer" title="Import a CSV exported from another gym app">
            Import from other apps (CSV)
            <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={onPickAppCsv} />
          </label>
          <button onClick={exportSupportBundle} className="btn btn-secondary min-h-10 rounded-xl px-4">Support diagnostics</button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="self-center text-[11px] text-ink3">Partial export:</span>
          <button onClick={()=> exportPartial('history')} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px]">History only</button>
          <button onClick={()=> exportPartial('settings')} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px]">Settings only</button>
          <button onClick={()=> exportPartial('events')} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px]">Events only</button>
        </div>
        <details className="rounded-xl border border-line bg-surface2 px-3 py-2 text-xs">
          <summary className="font-semibold cursor-pointer">Coach export — share a summary with a human coach</summary>
          <p className="text-ink3 mt-1.5">Aggregates only by default: best sets and weekly volume. Tick extra sections; nothing identity-bearing is included, and a coach export never contains your backups, events or credentials.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={coachSections.performance} onChange={(e)=> setCoachSections({ ...coachSections, performance: e.target.checked })} /> Per-exercise bests</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={coachSections.weekly} onChange={(e)=> setCoachSections({ ...coachSections, weekly: e.target.checked })} /> Weekly volume</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={coachSections.readiness} onChange={(e)=> setCoachSections({ ...coachSections, readiness: e.target.checked })} /> Readiness scores</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={coachSections.detail} onChange={(e)=> setCoachSections({ ...coachSections, detail: e.target.checked })} /> Full set detail</label>
          </div>
          <button onClick={exportCoach} className="btn btn-primary min-h-8 rounded-lg px-2.5 text-[11px] mt-2">Download coach summary (.md)</button>
          <button onClick={()=> { import('../lib/printReport.js').then(({ printProgressReport }) => printProgressReport(store, { units: store.preferences?.units === 'lb' ? 'lb' : 'kg' })); }} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px] mt-2">Print / save as PDF</button>
          <button onClick={shareCoach} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px] mt-2">Share…</button>
        </details>
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
              <button onClick={()=> { if(importStrategy==='replace' && !confirm('Replace overwrites ALL data on this device with the backup — your current history, programs and settings are gone. Export a backup first if in doubt. Continue?')) return; applyImportPreview(); }} className="btn btn-primary min-h-9 rounded-xl px-4">Apply {importStrategy}</button>
              <button onClick={()=> setImportPreview(null)} className="btn btn-secondary min-h-9 rounded-xl px-4">Cancel</button>
            </div>
          </div>
        )}
        <p className="text-xs text-ink3">Cross-device sync is Merge with last-write-wins per session (via savedAt). Conflicts resolve without losing either device's work.</p>
        <Suspense fallback={<p className="text-xs text-ink3">Loading sync settings…</p>}>
          <SyncPanel store={store} setStore={setStore} setMsg={setMsg} />
        </Suspense>
        {msg && <p role="status" className="text-xs bg-surface2 border border-line rounded-xl px-3 py-2">{msg}</p>}
        <details className="text-xs">
          <summary className="font-semibold cursor-pointer">What’s in the backup?</summary>
          <div className="mt-2 rounded-xl border border-line bg-surface2 px-3 py-2">
            <p className="font-semibold">This export would contain:</p>
            <p className="text-ink3 mt-0.5">
              {(store.history||[]).length} session(s) ·
              {(store.history||[]).reduce((n,h)=> n + (h.blocks||[]).reduce((m,b)=> m + (b.sets||[]).length, 0), 0)} set(s) ·
              {(store.customTemplates||[]).length} template(s) ·
              {(store.readinessLog||[]).length} readiness entr{(store.readinessLog||[]).length === 1 ? 'y' : 'ies'} ·
              {getEventHistory().length} event(s)
              {store.studyParticipantId ? ' · your pseudonymous study id' : ''}
            </p>
            <p className="text-[11px] text-ink3 mt-1">Excluded by design: crash logs, telemetry granular options, sync credentials, consent toggles.</p>
          </div>
          <pre className="mt-2 overflow-auto rounded-xl bg-surface2 border border-line p-3 text-[11px] leading-relaxed">{JSON.stringify({ app:'arise', version:3, schemaVersion:4, exportedAt:'…', data:{ onboarding:'{goal,equipment,location,level,daysPerWeek,availableMinutes,preferredExerciseIds,dislikedExerciseIds,plateConfig}', activeSchedule:'{programId,sessions}', activeWorkout:'recoverable draft or null', history:'[{id,date,blocks:[{exerciseId,sets:[{reps,weightKg,rpe,side,rom}]}]}]', preferences:'{units,theme,telemetryEnabled,pulseEnabled,healthSummaryEnabled}', eventHistory:'[{id,type,at,payload}]', healthSummary:'optional summary or null' }}, null, 2)}</pre>
        </details>
      </section>

      <Suspense fallback={null}><StorageDiagnostics setMsg={setMsg} /></Suspense>

      <section id="sec-appearance" className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <h3 className="text-sm font-bold">Appearance & accessibility</h3>
        <p className="text-xs text-ink3">Applies to every screen on this device, including the session runner. Stored with your other preferences and included in a backup.</p>

        <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
          <p className="text-xs font-bold">Weight units</p>
          <p className="text-[11px] text-ink3">Display only — your logs, engine math and backups stay in kilograms so history never breaks. (lb shows kg × 2.205.)</p>
          <div className="flex gap-1.5" role="group" aria-label="Weight units">
            {[['kg','Kilograms'],['lb','Pounds']].map(([value, label]) => (
              <button key={value} onClick={()=> setPreference({ units: value })} aria-pressed={(prefs.units || 'kg') === value}
                className={`flex-1 min-h-10 rounded-xl border px-2 py-1.5 text-xs font-bold ${(prefs.units || 'kg') === value ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink3'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
          <p className="text-xs font-bold">Experience level</p>
          <p className="text-[11px] text-ink3">Controls how much detail the app shows — never what it computes or stores. Everything stays in your export either way.</p>
          <div className="flex gap-1.5" role="group" aria-label="Experience level">
            {EXPERIENCE_LEVELS.map((level) => (
              <button
                key={level}
                onClick={()=> setPreference(experiencePatch(level))}
                aria-pressed={resolveExperience(prefs) === level}
                className={`flex-1 min-h-10 rounded-xl border px-2 py-1.5 text-xs ${resolveExperience(prefs) === level ? 'bg-ink text-bg border-ink font-bold' : 'bg-surface border-line text-ink3'}`}
              >
                <span className="block font-bold">{EXPERIENCE_INFO[level].label}</span>
                <span className={`block text-[10px] leading-snug ${resolveExperience(prefs) === level ? 'text-bg/80' : 'text-ink3'}`}>{EXPERIENCE_INFO[level].hint}</span>
              </button>
            ))}
          </div>
        </div>

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

        <ToggleRow
          label="Haptic feedback"
          hint="Short vibration pulses when a set is logged, rest ends, or a guided step advances. Android and most non-iOS browsers; iOS Safari does not expose vibration to web apps."
          checked={prefs.haptics !== false}
          onChange={value=> setPreference({ haptics: value })}
        />

        <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2.5">
          <p className="text-xs font-bold">Accessibility</p>
          <ToggleRow bare label="Larger text" hint="Scales the whole interface up by roughly 12%." checked={a11y.largeText === true} onChange={value=> setAccessibility({ largeText: value })} />
          <ToggleRow bare label="High contrast" hint="Pushes text and borders to maximum contrast against the background." checked={a11y.highContrast === true} onChange={value=> setAccessibility({ highContrast: value })} />
          <ToggleRow bare label="Reduce motion" hint="Removes transitions and animations, regardless of your OS setting." checked={a11y.reduceMotion === true} onChange={value=> setAccessibility({ reduceMotion: value })} />
        </div>
      </section>

      <section id="sec-guided" className="rounded-2xl border border-line bg-surface p-4 space-y-3">
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

        <ToggleRow
          label="Maximum effort warnings"
          hint="Notes when a prescribed target sits close to failure (from your last logged RPE) and reminds you to set safeties and watch bar speed."
          checked={prefs.maxEffortWarnings === true}
          onChange={value=> setPreference({ maxEffortWarnings: value })}
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

      <section id="sec-policy" className="rounded-2xl border border-line bg-surface p-4 space-y-3">
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

      <section id="sec-personalise" className="rounded-2xl border border-line bg-surface p-4 space-y-3">
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

      <section id="sec-privacy" className="rounded-2xl border border-line bg-surface p-4 space-y-2">
        <h3 className="text-sm font-bold">Privacy & data</h3>
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
                  try{ await captureSnapshot({ force: true, reason: 'pre-demo' }); }catch{}
                  try{ const { clearAllStoredData } = await import('../lib/storage.js'); await clearAllStoredData(); }catch{}
                  setStore(makeDemoStore());
                  setTab('today');
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
                onChange={(v)=> setStore({ ...store, preferences:{ ...store.preferences, telemetryOptions:{ ...(store.preferences?.telemetryOptions||{}), errorDiagnostics: v } } })} />
              <ToggleRow bare label="Set logging times" hint="Adds how long each set takes to log to the timing metric. Excluded when off."
                checked={store.preferences?.telemetryOptions?.sessionTimings === true}
                onChange={(v)=> setStore({ ...store, preferences:{ ...store.preferences, telemetryOptions:{ ...(store.preferences?.telemetryOptions||{}), sessionTimings: v } } })} />
              <ToggleRow bare label="Quarterly consent review reminder" hint="A local reminder to re-read these choices. Stored on this device only."
                checked={store.preferences?.consentReview?.remind === true}
                onChange={(v)=> setStore({ ...store, preferences:{ ...store.preferences, consentReview: { ...(store.preferences?.consentReview||{}), remind: v, lastReviewedAt: store.preferences?.consentReview?.lastReviewedAt || null } } })} />
              {store.preferences?.consentReview?.remind === true && consentReviewDue && (
                <div className="rounded-lg border border-review/30 bg-reviewsoft px-2.5 py-2 text-[11px]">
                  <p className="font-bold">Consent review due</p>
                  <p className="text-ink3 mt-0.5">You last reviewed these choices {Math.round((Date.now() - Date.parse(store.preferences.consentReview.lastReviewedAt)) / 86400000)} days ago.</p>
                  <button onClick={()=> setStore({ ...store, preferences:{ ...store.preferences, consentReview: { ...store.preferences.consentReview, lastReviewedAt: new Date().toISOString() } } })} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px] mt-1">Mark reviewed</button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={()=> setShowTelemetry(v=>!v)} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">{showTelemetry?'Hide':'Show'} local telemetry</button>          <button onClick={()=> { clearTelemetry(); clearErrorEvents(); setMsg('Local telemetry and crash logs cleared.'); setTimeout(()=> setMsg(null), 2000); }} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">Clear telemetry</button>
          <button onClick={()=> setShowErrors(v=>!v)} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">{showErrors?'Hide':'Show'} crash logs</button>
          <button onClick={()=> { clearErrorEvents(); setMsg('Crash logs cleared.'); setTimeout(()=> setMsg(null), 2000); }} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">Clear crash logs</button>
        </div>
        {showTelemetry && (
          <pre className="text-[11px] overflow-auto rounded-xl bg-surface2 border border-line p-3">{JSON.stringify(telemetrySummary(), null, 2)}</pre>
        )}
        {showErrors && (
          <pre className="text-[11px] overflow-auto rounded-xl bg-surface2 border border-line p-3">{getErrorEvents().length ? JSON.stringify(getErrorEvents(), null, 2) : 'No crash logs recorded.'}</pre>
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
          <summary className="text-sm font-semibold cursor-pointer">What is stored on this device?</summary>
          <div className="text-xs text-ink3 mt-2 space-y-1.5">
            <p><span className="font-semibold text-ink">Always:</span> your training history, programs, templates, readiness log, preferences and the event ledger — all local, all in your backups, all deleted by "Delete all data".</p>
            <p><span className="font-semibold text-ink">Never:</span> health summaries and study identity travel nowhere on their own — they exist only inside exports you create.</p>
            <p><span className="font-semibold text-ink">Excluded from every export:</span> error diagnostics and the granular telemetry options (device-local by design).</p>
            <p>Telemetry (opt-in) records recommendation acceptance and logging timings with free-text fields stripped by the sanitizer before write.</p>
          </div>
        </details>
        <details className="rounded-xl border border-line bg-surface2 px-3 py-2">
          <summary className="text-sm font-semibold cursor-pointer">What is shared?</summary>
          <div className="text-xs text-ink3 mt-2 space-y-1.5">
            <p><span className="font-semibold text-ink">By default: nothing.</span> No account, no analytics service, no trackers (enforced by this app's Content-Security-Policy, not just a promise).</p>
            <p>Separate consent controls Pulse sharing, health-platform summary import, local telemetry, classifier.dev feedback categorisation, and classifier.dev coach-request routing. The feedback channel sends only redacted feedback for triage; the coach channel sends only an ambiguous redacted question for lane selection. Both classifier.dev channels are off by default. Neither sends feedback to the Arise developer or creates training prescriptions.</p>
            <p>Exercise illustrations load from one static host (bryllim.github.io). That request carries no identity beyond your IP — the browser sends nothing else.</p>
          </div>
        </details>
        <details className="rounded-xl border border-line bg-surface2 px-3 py-2">
          <summary className="text-sm font-semibold cursor-pointer">Privacy, ownership & disclaimers</summary>
          <div className="text-xs text-ink3 mt-2 space-y-2">
            <p><span className="font-semibold text-ink">Data ownership.</span> Everything Arise stores is yours: it lives on your device, exports are plain files, and deleting the data removes it from this device. There is no server copy and no account — but files you already shared (backups, study exports) are copies outside the app that deleting here cannot reach.</p>
            <p><span className="font-semibold text-ink">Not medical advice.</span> Arise is a training-log tool with heuristic recommendations. It does not diagnose, treat or prevent any condition. Consult a qualified health professional before starting or changing an exercise program, especially with pre-existing conditions, injuries or during pregnancy.</p>
            <p><span className="font-semibold text-ink">High-intensity caution.</span> Aggressive progression policies and proximity-to-failure targets raise injury risk when misapplied. Treat every recommendation as a suggestion — reduce load or stop entirely if you feel sharp pain, dizziness or unusual discomfort.</p>
            <p><span className="font-semibold text-ink">Privacy policy (short form).</span> Arise is local-first: data stays on this device unless you export it or explicitly enable a sharing integration. Telemetry is opt-in and device-local. No third-party trackers, ads or analytics are included. Crash logs (opt-in) stay local, are capped at 50 and are excluded from exports.</p>
          </div>
        </details>        <details className="rounded-xl border border-line bg-surface2 px-3 py-2">
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

      <section id="sec-ai" className="rounded-2xl border border-line bg-surface p-4 space-y-2">
        <h3 className="text-sm font-bold">AI coach (optional)</h3>
        <p className="text-xs text-ink3">Optional: an NVIDIA-hosted model reads <span className="font-semibold text-ink">aggregated numbers only</span> (weekly sets/volume, adherence, readiness average) and returns short coaching notes. Your key is stored on this device only — never exported, synced, or included in backups.</p>
        <ToggleRow
          label="Cloud-assisted coach request routing"
          checked={coachRoutingEnabled}
          onChange={setCoachRoutingConsent}
          hint="Off by default. Routing is deterministic and local first. When switched on, only an ambiguous redacted coach question may reach classifier.dev; it selects a lane only and never creates training prescriptions."
        />
        <p className="text-xs text-ink3">Ask the coach routes your request invisibly: deterministic intent rules choose the local engine, the explanation path, or the local feedback queue. Training prescriptions always come from the deterministic engine — the cloud coach only explains.</p>
        <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
          <label className="block">
            <span className="text-[11px] font-bold">NVIDIA API key</span>
            <input type="password" value={aiKeyInput} onChange={e=> setAiKeyInput(e.target.value)} placeholder={ai.apiKey ? '•••• saved — paste to replace' : 'nvapi-…'} autoComplete="off" className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-ink3">Model</span>
            <input value={aiModelInput} onChange={e=> setAiModelInput(e.target.value)} placeholder={DEFAULT_MODEL} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs" />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold">Ask the coach</span>
            <textarea value={aiPrompt} onChange={e=> setAiPrompt(e.target.value)} placeholder="e.g. summarise last week, explain why my bench stalled, or report a crash"
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm resize-none" rows={3} maxLength={500} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button onClick={generateInsight} disabled={aiBusy || !aiPrompt.trim()} className="btn btn-primary min-h-9 rounded-xl px-3 text-xs disabled:opacity-40">{aiBusy ? 'Routing…' : 'Ask'}</button>
            {ai.apiKey && <button onClick={()=> { clearAiSettings(); setAiEnabled(false); setAiResult(null); setAiKeyInput(''); }} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">Clear key</button>}
            <span className="ml-auto text-[11px] text-ink3 self-center">{ai.apiKey ? 'key saved on this device' : 'no key stored'} · {ai.enabled || aiBusy ? 'enabled' : 'disabled'}</span>
          </div>
          {aiResult && (
            <div role="status" aria-live="polite" className={`rounded-xl border px-3 py-2 text-xs whitespace-pre-wrap ${aiResult.ok ? 'border-line bg-surface' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
              {aiResult.ok ? (aiResult.text) : `AI request unavailable: ${aiResult.error}`}
            </div>
          )}
        </div>
      </section>

      <section id="sec-feedback" className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        <h3 className="text-sm font-bold">Feedback &amp; issue triage</h3>
        <p className="text-xs text-ink3">
          Tell us about a problem, accessibility issue, content error, or request. Classification is local by default;
          when enabled, redacted feedback may be sent to classifier.dev. Categorisation does not send feedback to the
          Arise developer and never changes progression, readiness, workouts, substitutions, safety, treatment, study
          gates, or evidence.
        </p>
        <ToggleRow
          label="Cloud-assisted feedback categorisation"
          checked={feedbackClassifierEnabled}
          onChange={setFeedbackClassifierConsent}
          hint="Off by default. When switched on, feedback text may be sent to classifier.dev after obvious personal identifiers are redacted first. Training decisions never use this service. Switching it off keeps classification local."
        />
        <form
          onSubmit={(event)=> { event.preventDefault(); void submitFeedback(); }}
          className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2"
          aria-label="Save feedback locally"
        >
          <label htmlFor="feedback-issue" className="block text-xs font-bold">Describe the issue or request</label>
          <textarea
            id="feedback-issue"
            value={feedbackText}
            onChange={(event)=> setFeedbackText(event.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="What happened? Please do not include passwords or other sensitive information."
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-ink3">
              {feedbackClassifierEnabled ? 'Redacted feedback may be sent to classifier.dev for categorisation; developer sharing is separate.' : 'Classification stays on this device and is not sent to the developer.'}
            </span>
            <button type="submit" disabled={feedbackBusy} className="btn btn-primary min-h-9 rounded-xl px-3 text-xs disabled:opacity-40">
              {feedbackBusy ? 'Categorising…' : 'Save feedback locally'}
            </button>
          </div>
        </form>
        {feedbackResult && (
          <div data-testid="feedback-result" role="status" aria-live="polite" className="rounded-xl border border-line bg-surface2 px-3 py-2 text-xs space-y-1">
            <p className="font-bold">Latest category: <span data-testid="feedback-category">{feedbackResult.category}</span></p>
            <p className="text-ink3">
              Confidence: {feedbackResult.confidence == null ? 'not available' : Math.round(feedbackResult.confidence * 100) + '%'}
              {' · '}{feedbackResult.needsReview ? 'needs operator review' : 'accepted automatically'}
              {' · '}{feedbackResult.source}
            </p>
          </div>
        )}
        <div aria-label="Local feedback review queue" className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-bold">Local feedback review queue</h4>
            <span className="ml-auto text-[11px] text-ink3">{feedbackRecords.length} stored locally</span>
          </div>
          <p className="text-[11px] text-ink3">
            This device-only queue is not a developer inbox. Saving or categorising feedback never sends it to the
            Arise developer. Only redacted issue text and triage metadata are stored; request bodies, secrets, scores,
            and cloud responses are not stored or exported.
          </p>
          {feedbackSharePreview && (
            <div data-testid="feedback-share-preview" className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 space-y-2">
              <p className="text-[11px] font-bold text-amber-950">Exactly this redacted report will leave the device only if you confirm sharing:</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-[10px] text-amber-950">{feedbackSharePreview.text}</pre>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={shareFeedbackWithDeveloper} className="btn btn-primary min-h-8 rounded-lg px-2.5 text-[11px]">Share externally</button>
                <button type="button" onClick={()=> setFeedbackSharePreview(null)} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px]">Cancel</button>
              </div>
            </div>
          )}
          {feedbackRecords.length ? (
            <div className="space-y-2">
              {feedbackRecords.map((record)=> {
                const status = record.reviewedAt ? 'Reviewed' : record.needsReview ? 'Needs review' : 'Auto-accepted';
                return (
                  <article key={record.id} className="rounded-lg border border-line bg-surface px-2.5 py-2 space-y-1" aria-label={'Feedback ' + record.category}>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-bold" data-testid="operator-category">{record.category}</span>
                      <span className="ml-auto rounded-full border border-line px-1.5 py-0.5 text-[10px] font-semibold">{status}</span>
                    </div>
                    <p className="text-[11px] text-ink2 break-words">{record.redactedText || '(empty)'}</p>
                    <p className="text-[10px] text-ink3">
                      confidence {record.confidence == null ? '—' : Math.round(record.confidence * 100) + '%'}
                      {' · '}{record.source}{' · taxonomy v'}{record.taxonomyVersion}
                    </p>
                    {!record.reviewedAt && (
                      <button onClick={()=> reviewFeedback(record.id)} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px]">
                        Mark reviewed
                      </button>
                    )}
                    <button onClick={()=> prepareFeedbackShare(record)} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px]">
                      Share with developer
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-ink3">No feedback submitted on this device yet.</p>
          )}
        </div>
      </section>

      <section id="sec-evidence" className="rounded-2xl border border-line bg-surface p-4 space-y-2">
        <h3 className="text-sm font-bold">Progression evidence</h3>
        <p className="text-xs text-ink3">Arise records each recommendation before the workout (with your measurement consent) and scores it against what you actually did next — compared against simple double progression, linear progression and a flat baseline on the same sessions.</p>
        {(() => {
          // Plain-language study onboarding — the full lifecycle:
          //   eligibility (checked against real local data) → plain-language
          //   consent → current status → participation + export instructions
          //   → withdraw (stops treatment, keeps history; deletion is a
          //   separate explicit action). joinStudy/withdrawFromStudy own the
          //   state transitions so the card never hand-rolls them.
          const status = participationStatus(store);
          const eligibility = studyEligibility(store);
          const audit = status === 'enrolled' ? enrollmentAudit(store.studyEnrollment) : null;
          return (
            <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2" aria-label="Real-world study onboarding">
              <p className="text-xs font-bold">Take part in the real-world study</p>
              <p className="text-[11px] text-ink3">
                Who can join: anyone training with Arise who has measurement consent on and at least 3 logged workouts.
                What the study keeps: the target shown before each workout and what you actually did next, your structured
                readiness check-ins (score, sleep, soreness, motivation), and timing of how long logging takes — never your
                name, health-platform data, or free-text notes. Nothing leaves this device unless you export it yourself.
                Pseudonymous participant id:{' '}
                <span className="font-semibold text-ink2">{isValidStudyParticipantId(store.studyParticipantId) ? `${String(store.studyParticipantId).slice(0, 8)}…` : 'created when you join'}</span>
              </p>
              {status === 'enrolled' ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-success">✓ Current status: enrolled{audit?.ok ? '' : ' (assignment audit needs review)'} — new workouts get frozen arm assignments.</p>
                  <details className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
                    <summary className="text-[11px] font-semibold cursor-pointer">How to take part &amp; export</summary>
                    <ul className="text-[11px] text-ink3 list-disc pl-4 mt-1 space-y-0.5">
                      <li>Train as normal — enrolment never changes what a good workout looks like.</li>
                      <li>Once a week: use <span className="font-semibold">Export study data</span> below — it downloads the exact file the study tooling reads.</li>
                      <li>Send the file to the study operator however you already share files. Repeated exports are expected — they fold back into one participant, never two.</li>
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
                    <p className="text-[11px] text-ink3 mt-1">Never included: free-text notes or session titles, your onboarding profile, custom templates, health-platform data, crash diagnostics, or credentials.</p>
                  </details>
                  <button onClick={exportStudyData}
                    className="btn btn-primary min-h-9 rounded-lg px-2.5 text-[11px]">Export study data</button>
                  <button onClick={()=> { if(!confirm('Withdraw from the study?\n\nNew workouts stop getting study assignments (the normal engine takes over).\nEverything already recorded — sessions, measurements, export history — stays on this device exactly as it is.\n\nNote: files you already sent to the study team are copies the app cannot reach. Deleting local data never removes them; ask the study team to delete their copies if you want that.\n\nDeleting local data is a separate action (More → Privacy & data → Delete all data) and is never done by withdrawing.')) return; setStore(withdrawFromStudy(store)); setMsg('Withdrawn — new workouts are study-free; recorded history preserved.'); setTimeout(()=> setMsg(null), 5000); }}
                    className="btn btn-secondary min-h-9 rounded-lg px-2.5 text-[11px]">Withdraw from the study</button>
                </div>
              ) : status === 'withdrawn' ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-ink2">Current status: withdrawn.</p>
                  <p className="text-[11px] text-ink3">New workouts run on the normal engine with no study assignments. Everything you already logged stays on this device — withdrawing never deletes observations; deletion is a separate, explicit action.</p>
                  {eligibility.eligible && (
                    <button onClick={()=> { try{ setStore(joinStudy(store)); setMsg('Rejoined the study — same pseudonymous id, same deterministic assignment.'); setTimeout(()=> setMsg(null), 4000); }catch(err){ setMsg(`Could not enroll: ${String(err?.message || err)}`); setTimeout(()=> setMsg(null), 5000); } }}
                      className="btn btn-secondary min-h-9 rounded-lg px-2.5 text-[11px]">Rejoin the study</button>
                  )}
                </div>
              ) : eligibility.problems.length ? (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-ink2">Current status: not yet eligible</p>
                  <ul className="text-[11px] text-ink3 list-disc pl-5 space-y-0.5" aria-label="Study eligibility">
                    {eligibility.problems.map((r, i)=> <li key={i}>{r}</li>)}
                  </ul>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-ink2">Current status: eligible to join</p>
                  <button
                    onClick={()=> {
                      try{
                        setStore(joinStudy(store));
                        setMsg('Joined the study — pseudonymous, on this device only.'); setTimeout(()=> setMsg(null), 4000);
                      }catch(err){ setMsg(`Could not enroll: ${String(err?.message || err)}`); setTimeout(()=> setMsg(null), 5000); }
                    }}
                    className="btn btn-primary min-h-9 rounded-lg px-3 text-[11px]">Join the study</button>
                </div>
              )}
              <p className="text-[11px] text-ink3">{participationCopy(store)}</p>
              <p className="text-[11px] text-ink3">Until enough participants and sessions exist, reports say <span className="font-semibold">“Insufficient real-user evidence”</span> and rank nothing — synthetic tests are never presented as real-world results.</p>
            </div>
          );
        })()}
        {store.preferences?.telemetryEnabled !== true ? (
          <p className="text-xs text-ink3">Enable local measurements above to start collecting recommendation→outcome pairs. Pairs stay on this device and are included in your backup file.</p>
        ) : (
          <details className="rounded-xl border border-line bg-surface2 px-3 py-2" onToggle={(e)=> setEvidenceOpen(e.target.open)}>
            <summary className="text-sm font-semibold cursor-pointer">Study status{evidenceSummary ? ` — ${evidenceSummary}` : ''}</summary>
            {evidenceData && (
              <div className="mt-3 space-y-3">
                <Suspense fallback={null}><EvidenceDashboard records={evidenceData.ledger || []} archivedCount={evidenceData.archivedCount} /></Suspense>
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
                  <p className="text-xs font-bold">Field-study contribution</p>
                  <p className="text-[11px] text-ink3 mt-1">{evidenceData.fieldStudy.mode === 'enrolled' ? `Enrolled${evidenceData.fieldStudy.enrollmentOk ? '' : ' (enrollment needs review)'} · ` : evidenceData.fieldStudy.mode === 'observing' ? 'Observing (not enrolled) · ' : 'Off · '}{evidenceData.fieldStudy.samples.assigned} assigned transitions (arise {evidenceData.fieldStudy.samples.arise} · double progression {evidenceData.fieldStudy.samples.doubleProgression}) · {evidenceData.fieldStudy.samples.users} users · maturity: {evidenceData.fieldStudy.maturity}.</p>
                  {!!evidenceData.fieldStudy.reasons.length && (
                    <p className="text-[11px] text-ink3 mt-1">{evidenceData.fieldStudy.reasons.join('; ')}.</p>
                  )}
                  <p className="text-[11px] text-ink3 mt-1">{evidenceData.fieldStudy.note}</p>
                </div>
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

      <section id="sec-help" className="rounded-2xl border border-line bg-surface p-4 space-y-2">
        <h3 className="text-sm font-bold">Help & testing</h3>
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
          <summary className="text-sm font-semibold cursor-pointer">Legal &amp; disclaimers</summary>
          <div className="text-xs text-ink2 mt-2 space-y-2">
            <p><span className="font-semibold text-ink">Not medical advice.</span> Arise is not a medical device and does not diagnose, treat, or predict anything about your health. Suggestions are arithmetic over your own logs. Consult a qualified health professional before starting or changing an exercise program.</p>
            <p><span className="font-semibold text-ink">Train at your own risk.</span> High-intensity suggestions raise injury risk when misapplied — reduce load or stop if you feel sharp pain, dizziness or unusual discomfort.</p>
            <p><span className="font-semibold text-ink">Your data is yours.</span> It lives in this browser on this device; Arise claims no license over it and cannot read it. Export or erase it any time from More → Data. Full statements: <a className="underline" href="https://github.com/henrygoldsmith07-wq/arise/blob/main/docs/TERMS.md" target="_blank" rel="noreferrer">Terms</a> · <a className="underline" href="https://github.com/henrygoldsmith07-wq/arise/blob/main/docs/PRIVACY_POLICY.md" target="_blank" rel="noreferrer">Privacy policy</a> · <a className="underline" href="https://github.com/henrygoldsmith07-wq/arise/blob/main/docs/DISCLAIMERS.md" target="_blank" rel="noreferrer">Disclaimers</a>.</p>
            <p><span className="font-semibold text-ink">License.</span> Code: MIT. Exercise illustrations: CC BY-SA 4.0 (attributed per illustration).</p>
          </div>
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
