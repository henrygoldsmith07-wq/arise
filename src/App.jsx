import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from './components/AppShell.jsx';
import TodayView from './components/TodayView.jsx';
import Onboarding from './components/Onboarding.jsx';
import LiveAnnouncer from './components/LiveAnnouncer.jsx';

// Route-level code splitting: the boot path ships only the shell, Today view
// and onboarding — everything else loads on first navigation. Each lazy view
// is ALSO warmed up after first paint (warmLazyViews below), so on anything
// but a cold offline start the chunk is local before the user taps the tab:
// splitting is for boot bytes, not for navigation jank.
const loadTrainView = ()=> import('./components/TrainView.jsx');
const loadExerciseBrowser = ()=> import('./components/ExerciseBrowser.jsx');
const loadProgressView = ()=> import('./components/ProgressView.jsx');
const loadMoreView = ()=> import('./components/MoreView.jsx');
const loadSessionRunner = ()=> import('./components/SessionRunner.jsx');
const loadGuidedRunner = ()=> import('./components/GuidedRunner.jsx');

const TrainView = lazy(loadTrainView);
const ExerciseBrowser = lazy(loadExerciseBrowser);
const ProgressView = lazy(loadProgressView);
const MoreView = lazy(loadMoreView);
const SessionRunner = lazy(loadSessionRunner);
const GuidedRunner = lazy(loadGuidedRunner);

let warmStarted = false;
function warmLazyViews(){
  if(warmStarted || typeof window === 'undefined') return;
  warmStarted = true;
  const idle = typeof window.requestIdleCallback === 'function'
    ? (fn)=> window.requestIdleCallback(fn, { timeout: 4000 })
    : (fn)=> window.setTimeout(fn, 1200);
  idle(()=> {
    // Warm every split chunk right after first paint so on anything but a
    // cold offline start the code is local before the user taps its tab:
    // splitting is for boot bytes, not for navigation jank. Failures are
    // harmless — the real navigation retries through Suspense.
    for(const load of [loadTrainView, loadExerciseBrowser, loadProgressView, loadMoreView, loadSessionRunner, loadGuidedRunner]) {
      load().catch(()=>{});
    }
  });
}
import { loadStore, saveStore, upsertHistory } from './lib/store.js';
import { recommendExercises } from './lib/data.js';
import { recordEvent, recordErrorEvent } from './lib/telemetry.js';
import { pushToPulse } from './lib/pulse.js';
import { adaptActiveSchedule } from './lib/programming.js';
import { reviewCompletedWeek, applyWeeklyReview } from './lib/mesocycle.js';
import { attachOutcome } from './lib/longitudinal.js';
import { setRestPreset } from './lib/gymMode.js';

// Suspense fallback for lazy tabs: same chrome height as a view header so
// the tab bar doesn't jump when the chunk resolves.
function TabFallback({ label }){
  return (
    <div className="px-4 py-10 animate-pulse" role="status" aria-label={`Loading ${label} view`}>
      <div className="h-5 w-28 rounded bg-surface2 mb-4" />
      <div className="h-20 rounded-2xl bg-surface2 mb-3" />
      <div className="h-20 rounded-2xl bg-surface2" />
    </div>
  );
}

export default function App(){
  const [store,setStoreState]=useState(()=> loadStore());
  const [tab,setTab]=useState('today');
  const [activeSession,setActiveSession]=useState(null);
  const [recoveryOpen,setRecoveryOpen]=useState(()=> Boolean(loadStore().activeWorkout));
  const [consentOpen,setConsentOpen]=useState(()=> loadStore().preferences?.telemetryEnabled == null);
  const [onboardingOpen,setOnboardingOpen]=useState(()=> !loadStore().onboarding);
  const [updateReady,setUpdateReady]=useState(false);
  const [updateDeferred,setUpdateDeferred]=useState(false);
  const [persistFailed,setPersistFailed]=useState(false);
  const [toast,setToast]=useState(null);
  const applyReloadRef=useRef(false);

  // State-setting wrapper kept for all call sites and child views. Persistence
  // happens once, in the [store] effect below — never inside the setter.
  const setStore = setStoreState;

  // Single persistence point: state updates flow through setStoreState and this
  // effect writes once. (Saving inside updaters or wrappers double-wrote on
  // every keystroke under StrictMode.)
  useEffect(()=>{
    if(!saveStore(store)) setPersistFailed(true);
  },[store]);

  // Warm the lazy route chunks once boot has settled (see warmLazyViews).
  useEffect(()=>{ warmLazyViews(); },[]);

  useEffect(()=>{
    setConsentOpen(store.preferences?.telemetryEnabled == null);
  },[store.preferences?.telemetryEnabled]);

  // Theme: an explicit preference wins; 'system' (null) tracks the OS and keeps
  // tracking it live, so the app flips with the OS without a reload.
  const theme = store.preferences?.theme ?? null;
  useEffect(()=>{
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = ()=> document.documentElement.classList.toggle('dark', theme ? theme==='dark' : query.matches);
    apply();
    if(theme) return;
    query.addEventListener?.('change', apply);
    return ()=> query.removeEventListener?.('change', apply);
  },[theme]);

  // Accessibility preferences map straight onto the opt-in root classes
  // le-studio.css defines. Kept here so every view — including the modal
  // session runner, which renders outside the shell — inherits them.
  const a11y = store.preferences?.accessibility;
  useEffect(()=>{
    const root = document.documentElement;
    root.classList.toggle('large-text', a11y?.largeText === true);
    root.classList.toggle('high-contrast', a11y?.highContrast === true);
    root.classList.toggle('reduce-motion', a11y?.reduceMotion === true);
  },[a11y?.largeText, a11y?.highContrast, a11y?.reduceMotion]);

  // Header control cycles system → light → dark → system, so the common case
  // (flip it for this gym's lighting) is one tap instead of a trip into More.
  const cycleTheme = ()=>{
    const next = theme === null ? 'light' : theme === 'light' ? 'dark' : null;
    setStore(prev=> ({ ...prev, preferences:{ ...(prev.preferences||{}), theme: next } }));
  };

  // PWA lifecycle: listen for SW update
  useEffect(()=>{
    if(!('serviceWorker' in navigator)) return;
    const onControllerChange = ()=>{
      // Only reload when WE activated a waiting worker (applyUpdate). The very
      // first claim after install would otherwise loop-reload first-time visits.
      if(window.__ariseSwActivating) window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    // Check for waiting SW on load
    navigator.serviceWorker.getRegistration().then(r=>{
      if(r?.waiting) setUpdateReady(true);
      if(r) r.addEventListener('updatefound', ()=>{
        const nw = r.installing;
        if(nw) nw.addEventListener('statechange', ()=>{ if(nw.state==='installed' && navigator.serviceWorker.controller) setUpdateReady(true); });
      });
    });
    return ()=> navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  },[]);

  // Keep state fresh when another tab writes the store. Skipped mid-session so
  // a foreign write can't clobber the runner draft.
  useEffect(()=>{
    if(!('storage' in window)) return;
    const onStorage = (e)=>{
      if(e.key !== 'arise.store.v1' || activeSession) return;
      setStoreState(loadStore());
    };
    window.addEventListener('storage', onStorage);
    return ()=> window.removeEventListener('storage', onStorage);
  },[activeSession]);

  // Transient confirmation. Saving a session also switches tabs, so without
  // this the jump to Progress is the only signal that anything was recorded.
  useEffect(()=>{
    if(!toast) return;
    const id = setTimeout(()=> setToast(null), 6000);
    return ()=> clearTimeout(id);
  },[toast]);

  // Global error capture (privacy-gated, local only): structured events go to
  // the isolated error store (capped at 50, sanitizer-only fields) — never the
  // product ledger — and only when error diagnostics are explicitly opted in.
  useEffect(()=>{
    const onError = (e)=>{
      try { recordErrorEvent(e.error || e.reason || e, 'window'); } catch {}
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', (e)=> onError(e.reason||e));
    return ()=> { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onError); };
  },[]);

  const recs = useMemo(()=>{
    if(!store.onboarding) return [];
    return recommendExercises({ goal: store.onboarding.goal, availableEquipment: store.onboarding.equipment, limit: 4 });
  },[store.onboarding]);

  const handleCompleteOnboarding = (payload)=>{
    const next = { ...store, onboarding: payload };
    setStore(next);
  };

  const handleStartSession = (session)=>{
    if(store.activeWorkout && store.activeWorkout.session?.id !== session.id){
      setRecoveryOpen(true);
      return;
    }
    setActiveSession(session);
    setRecoveryOpen(false);
    try { recordEvent('session:start', { sessionId: session.id, title: session.title }); } catch {}
  };

  const chooseMeasurementConsent=(enabled)=>{
    setStore({ ...store, preferences:{ ...(store.preferences||{}), telemetryEnabled:enabled } });
    recordEvent('consent:local-measurements', { enabled }, { essential:true });
    setConsentOpen(false);
  };

  const handleDraftChange = useCallback((draft)=>{
    // Pure updater — the [store] effect below owns persistence. Writing
    // localStorage inside an updater double-fires under StrictMode.
    setStoreState(prev=> ({ ...prev, activeWorkout: draft }));
  },[]);

  // Gym Mode preferences (rest presets, focus defaults) live beside the app
  // preferences: session-behavioural, device-local, safe to merge forward.
  const handleSetRestPreset = useCallback((exerciseId, seconds)=>{
    setStoreState(prev=> ({ ...prev, gymPrefs: { ...(prev.gymPrefs||{}), restPresets: setRestPreset(prev.gymPrefs, exerciseId, seconds) } }));
  },[]);

  const handleSaveSession = (payload)=>{
    let next = { ...store };
    const hist = upsertHistory(next.history || [], payload);
    // Longitudinal evaluation: resolve open recommendation records against this
    // real outcome. Uses the pre-save history as "before" context; consent-gated
    // and stored separately from training history.
    try{
      attachOutcome({
        sessionId: payload.id,
        dateISO: payload.dateISO,
        blocks: payload.blocks,
        historyBefore: next.history || [],
        preferences: next.preferences?.telemetryEnabled === true ? { telemetryEnabled: true } : null,
      });
    }catch{}
    let activeSchedule = next.activeSchedule;
    if(activeSchedule){
      activeSchedule = { ...activeSchedule, sessions: activeSchedule.sessions.map(s=> s.id===payload.id ? { ...s, status:'done' } : s) };
    }
    const adaptation = activeSchedule ? adaptActiveSchedule(activeSchedule, hist, {
      readinessLog: next.readinessLog || [],
      availableEquipment: next.onboarding?.equipment || [],
    }) : null;
    if(adaptation?.changed) activeSchedule = adaptation.schedule;
    // Week-level roll-up: when this save closed out the training week (no
    // unfinished sessions left in its ISO week), review the week and direct
    // the next one. Runs after per-session adaptation so both layers compose.
    let weeklyReview = null;
    try{
      const review = reviewCompletedWeek({
        schedule: activeSchedule,
        history: hist,
        readinessLog: next.readinessLog || [],
        availableEquipment: next.onboarding?.equipment || [],
        policy: next.preferences?.progressionPolicy || 'standard',
      });
      if(review.ready && review.directives.some(d => d.kind !== 'hold')){
        const applied = applyWeeklyReview(activeSchedule, review);
        if(applied.changed){ activeSchedule = applied.schedule; weeklyReview = applied; }
      }
    }catch{}
    next = { ...next, history: hist, activeSchedule, activeWorkout: null };
    setStore(next);
    setActiveSession(null);
    setRecoveryOpen(false);
    setTab('progress');
    const savedSets = payload.blocks.reduce((n,b)=> n + b.sets.filter(s=> s.completed).length, 0);
    const savedVolume = payload.blocks.reduce((n,b)=> n + b.sets.reduce((m,s)=> {
      if(!s.completed) return m;
      const load = Math.max(0, (Number(s.weightKg)||0) - (Number(s.assistedKg)||0));
      return m + (Number(s.reps)||0) * load;
    }, 0), 0);
    setToast({
      title: `${payload.title} saved`,
      detail: [
        `${savedSets} set${savedSets===1?'':'s'}`,
        savedVolume > 0 ? `${Math.round(savedVolume).toLocaleString()} kg` : null,
        `${payload.durationMinutes} min`,
      ].filter(Boolean).join(' · '),
      note: adaptation?.changed ? 'Your next sessions were adjusted from this result.' : null,
    });
    try { recordEvent('session:complete', { sessionId: payload.id, blocks: payload.blocks.length }); } catch {}
    if(adaptation?.changed){
      try { recordEvent('programme:adapt', { sessionId: payload.id, changes: adaptation.changes, decision: adaptation.decision }); } catch {}
    }
    if(weeklyReview?.changed){
      try { recordEvent('programme:weekly-review', { basisWeek: weeklyReview.entry.basisKey, changes: weeklyReview.changes }); } catch {}
    }
    // Pulse push if enabled and adapter present (adapter injected via window.__PULSE_ADAPTER__ for now)
    try {
      const adapter = typeof window !== 'undefined' ? window.__PULSE_ADAPTER__ : null;
      if(next.preferences?.pulseEnabled && adapter){
        Promise.resolve(pushToPulse(payload, hist, adapter)).then(result=>{
          const ok=result?.ok ?? Object.values(result||{}).every(value=> value?.ok !== false);
          recordEvent('pulse:sync', { sessionId:payload.id, ok, result }, { essential:false });
        }).catch(error=> recordEvent('pulse:sync', { sessionId:payload.id, ok:false, error:String(error?.message||error) }, { essential:false }));
      }
    } catch {}
  };
  const handleCancelSession = ()=>{
    const draft=store.activeWorkout;
    if(activeSession && draft){
      const completedSets=draft.blocks?.reduce((n,b)=> n+(b.sets||[]).filter(s=> s.completed).length,0) || 0;
      // The draft is crash-insurance for logged sets — discarding it needs a
      // deliberate confirmation once real work is on the line.
      if(completedSets>0 && !window.confirm(`Discard this workout? ${completedSets} completed set${completedSets===1?'':'s'} will be lost.`)) return;
    }
    if(activeSession) try {
      const totalSets=draft?.blocks?.reduce((n,b)=> n+(b.sets||[]).length,0) || 0;
      const completedSets=draft?.blocks?.reduce((n,b)=> n+(b.sets||[]).filter(s=> s.completed).length,0) || 0;
      const startedAt=draft?.startedAt ? Date.parse(draft.startedAt) : null;
      recordEvent('session:abandon', { sessionId: activeSession.id, totalSets, completedSets, elapsedMs:startedAt ? Math.max(0,Date.now()-startedAt) : null });
    } catch {}
    setStore({ ...store, activeWorkout: null });
    setActiveSession(null);
    setRecoveryOpen(false);
  };

  const resumeDraft = ()=>{
    const draft=store.activeWorkout;
    if(!draft?.session){
      setStore({ ...store, activeWorkout: null });
      setRecoveryOpen(false);
      return;
    }
    setActiveSession(draft.session);
    setRecoveryOpen(false);
    try { recordEvent('session:resume', { sessionId: draft.session.id }); } catch {}
  };

  const discardDraft = ()=>{
    setStore({ ...store, activeWorkout: null });
    setRecoveryOpen(false);
  };

  const draftSets = store.activeWorkout?.blocks?.reduce((n,b)=> n+(b.sets||[]).length, 0) || 0;
  const draftDone = store.activeWorkout?.blocks?.reduce((n,b)=> n+(b.sets||[]).filter(s=> s.completed).length, 0) || 0;

  const applyUpdate = ()=>{
    // Safe update: never interrupt a workout in progress. The draft and the
    // runner live in this page instance; a reload mid-session risks losing
    // unsaved keystrokes. With an active session, the banner switches to a
    // non-blocking "restart when ready" state instead.
    if(activeSession){
      setUpdateDeferred(true);
      try { recordEvent('update:deferred', { sessionId: activeSession.id }, { essential:false }); } catch {}
      return;
    }
    performUpdateReload();
  };

  const performUpdateReload = ()=>{
    if('serviceWorker' in navigator){
      navigator.serviceWorker.getRegistration().then(r=>{
        if(r?.waiting){
          window.__ariseSwActivating = true;
          r.waiting.postMessage('SKIP_WAITING');
        } else {
          window.__ariseSwActivating = true;
          window.location.reload();
        }
      });
    }
  };

  // A deferred update applies automatically the moment the workout ends
  // (save or discard both clear activeSession).
  useEffect(()=>{
    if(updateReady && updateDeferred && !activeSession) performUpdateReload();
  }, [updateReady, updateDeferred, activeSession]);

  return (
    <AppShell tab={tab} setTab={setTab} storeVersion={store.version} theme={theme} onCycleTheme={cycleTheme}>
      <LiveAnnouncer />
      {updateReady && (
        <div className="mx-4 mt-2 rounded-xl border border-review/30 bg-reviewsoft px-3 py-2 flex items-center gap-2 text-xs">
          <span className="font-bold text-review">Update available</span>
          <span className="text-ink2">{updateDeferred ? 'Update will apply after this workout — no rush.' : 'New version cached — reload to apply.'}</span>
          <button onClick={applyUpdate} className="ml-auto btn btn-primary min-h-8 rounded-xl px-3 text-xs">Update</button>
        </div>
      )}
      {recoveryOpen && store.activeWorkout && !activeSession && (
        <div className="mx-4 mt-2 rounded-2xl border border-review/30 bg-reviewsoft px-4 py-3 space-y-2" role="alert">
          <div className="flex items-start gap-3">
            <span className="text-base" aria-hidden>↩</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Resume your workout?</p>
              <p className="text-xs text-ink2">{store.activeWorkout.session?.title || 'Workout'} · {draftDone}/{draftSets} sets saved locally{store.activeWorkout.updatedAt ? ` · last updated ${formatDraftTime(store.activeWorkout.updatedAt)}` : ''}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={resumeDraft} className="btn btn-primary min-h-10 rounded-xl flex-1">Resume</button>
            <button onClick={discardDraft} className="btn btn-secondary min-h-10 rounded-xl">Discard draft</button>
          </div>
        </div>
      )}
      {consentOpen && !activeSession && (
        <div className="mx-4 mt-2 rounded-2xl border border-line bg-surface px-4 py-3 space-y-2" role="dialog" aria-label="Local measurement consent">
          <p className="text-sm font-bold">Choose local measurements</p>
          <p className="text-xs text-ink3">Arise can measure logging time, session abandonment and recommendation acceptance. These events stay on this device and are included only when you export a backup.</p>
          <div className="flex gap-2">
            <button onClick={()=> chooseMeasurementConsent(true)} className="btn btn-primary min-h-10 rounded-xl flex-1">Allow local measurements</button>
            <button onClick={()=> chooseMeasurementConsent(false)} className="btn btn-secondary min-h-10 rounded-xl">No thanks</button>
          </div>
        </div>
      )}
      {toast && (
        <div role="status" className="fixed bottom-20 inset-x-4 z-30 mx-auto max-w-md rounded-2xl border border-success/30 bg-successsoft px-4 py-3 flex items-start gap-3 fade-in">
          <span aria-hidden className="text-base leading-none mt-0.5">✓</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-success truncate">{toast.title}</p>
            <p className="text-xs text-ink2">{toast.detail}</p>
            {toast.note && <p className="text-[11px] text-ink3 mt-0.5">{toast.note}</p>}
          </div>
          <button onClick={()=> setToast(null)} aria-label="Dismiss" className="shrink-0 -mt-1 -mr-1 w-8 h-8 grid place-items-center rounded-full text-ink3 hover:text-ink">✕</button>
        </div>
      )}
      {tab==='today' && (
        <TodayView
          store={store}
          setStore={setStore}
          onStartSession={handleStartSession}
          onOpenTrain={()=> setTab('train')}
          plateConfig={store.onboarding?.plateConfig || null}
        />
      )}
      {tab==='train' && (
        <Suspense fallback={<TabFallback label="Train" />}> <TrainView
          store={store}
          setStore={setStore}
          onStartSession={handleStartSession}
          availableEquipment={store.onboarding?.equipment || []}
        /></Suspense>
      )}
      {tab==='exercises' && (
        <>
          <Suspense fallback={<TabFallback label="Exercises" />}><ExerciseBrowser availableEquipment={store.onboarding?.equipment || []} /></Suspense>
          {!!recs.length && (
            <div className="px-4 pb-4 -mt-2">
              <div className="rounded-2xl border border-line bg-surface p-3">
                <p className="text-xs font-bold">Recommended for you</p>
                <p className="text-[11px] text-ink3 mt-1">Based on onboarding: goal <span className="font-semibold text-ink">{store.onboarding.goal}</span> • location <span className="font-semibold text-ink">{store.onboarding.location}</span> • kit {(store.onboarding.equipment||[]).join(', ')}</p>
                <ul className="mt-2 grid gap-1.5">
                  {recs.map(r=> <li key={r.id} className="text-sm flex gap-2"><span className="font-semibold">{r.name}</span><span className="text-xs text-ink3 ml-auto">{r.muscle} • {r.equipment.join(', ')}</span></li>)}
                </ul>
                <p className="text-[11px] text-ink3 mt-2">Change kit or location in More → Edit onboarding to see this update.</p>
              </div>
            </div>
          )}
        </>
      )}
      {tab==='progress' && <Suspense fallback={<TabFallback label="Progress" />}><ProgressView store={store} /></Suspense>}
      {tab==='more' && <Suspense fallback={<TabFallback label="More" />}><MoreView store={store} setStore={setStore} setTab={setTab} onboardingOpen={onboardingOpen} setOnboardingOpen={setOnboardingOpen} /></Suspense>}

      {activeSession && activeSession.mode === 'guided' && (
        <Suspense fallback={null}><GuidedRunner
          session={activeSession}
          history={store.history || []}
          availableEquipment={store.onboarding?.equipment || []}
          draft={store.activeWorkout?.session?.id===activeSession.id ? store.activeWorkout : null}
          measurementConsent={store.preferences?.telemetryEnabled === true}
          wakeLock={store.preferences?.wakeLock === true}
          gymPrefs={store.gymPrefs || null}
          onSetRestPreset={handleSetRestPreset}
          soundCues={store.preferences?.soundCues !== false}
          onToggleSoundCues={(v)=> setStore(prev=> ({ ...prev, preferences:{ ...(prev.preferences||{}), soundCues: v } }))}
          voiceCoach={store.preferences?.voiceCoach === true}
          onToggleVoiceCoach={(v)=> setStore(prev=> ({ ...prev, preferences:{ ...(prev.preferences||{}), voiceCoach: v } }))}
          voiceRate={Number(store.preferences?.voiceRate) || 1}
          onDraftChange={handleDraftChange}
          onSave={handleSaveSession}
          onCancel={handleCancelSession}
        /></Suspense>
      )}
      {activeSession && activeSession.mode !== 'guided' && (
        <Suspense fallback={null}><SessionRunner
          session={activeSession}
          history={store.history || []}
          availableEquipment={store.onboarding?.equipment || []}
          plateConfig={store.onboarding?.plateConfig || null}
          preferences={store.onboarding || null}
          appPrefs={store.preferences || null}
          gymPrefs={store.gymPrefs || null}
          onSetRestPreset={handleSetRestPreset}
          draft={store.activeWorkout?.session?.id===activeSession.id ? store.activeWorkout : null}
          measurementConsent={store.preferences?.telemetryEnabled === true}
          studyEnrollment={store.studyEnrollment || null}
          participantId={store.studyParticipantId || null}
          onDraftChange={handleDraftChange}
          onSave={handleSaveSession}
          onCancel={handleCancelSession}
        /></Suspense>
      )}

      <Onboarding
        open={onboardingOpen}
        onClose={()=> setOnboardingOpen(false)}
        onComplete={handleCompleteOnboarding}
        initial={store.onboarding}
      />

      {!store.onboarding && !onboardingOpen && (
        <div className="fixed bottom-20 inset-x-4 z-10 rounded-2xl border border-review/30 bg-reviewsoft px-4 py-3 flex items-center gap-3">
          <span className="text-sm">👋</span>
          <span className="text-sm flex-1"><span className="font-bold">Set up Arise</span> — 30 seconds so recommendations actually match your kit.</span>
          <button onClick={()=> setOnboardingOpen(true)} className="btn btn-primary min-h-9 rounded-xl px-3 text-xs">Set up</button>
        </div>
      )}
    </AppShell>
  );
}

function formatDraftTime(value){
  const date=new Date(value);
  return Number.isNaN(date.getTime()) ? 'recently' : date.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}
