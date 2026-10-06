import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import AppShell from './components/AppShell.jsx';
import LiveAnnouncer from './components/LiveAnnouncer.jsx';

// Route-level code splitting: the boot path ships only the shell, Today view
// and onboarding — everything else loads on first navigation. Each lazy view
// is ALSO warmed up after first paint (warmLazyViews below), so on anything
// but a cold offline start the chunk is local before the user taps the tab:
// splitting is for boot bytes, not for navigation jank.
const loadTodayView = ()=> import('./components/TodayView.jsx');
const loadOnboarding = ()=> import('./components/Onboarding.jsx');
const loadTrainView = ()=> import('./components/TrainView.jsx');
const loadExerciseBrowser = ()=> import('./components/ExerciseBrowser.jsx');
const loadProgressView = ()=> import('./components/ProgressView.jsx');
const loadMoreView = ()=> import('./components/MoreView.jsx');
const loadSessionRunner = ()=> import('./components/SessionRunner.jsx');
const loadGuidedRunner = ()=> import('./components/GuidedRunner.jsx');

const TodayView = lazy(loadTodayView);
const Onboarding = lazy(loadOnboarding);
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
    // Warm only the likely workout path after first paint. Progress, More and
    // the exercise browser remain genuinely on-demand so a user who opens the
    // app just to log a session does not immediately download/parse every tab.
    // Failures are harmless — real navigation retries through Suspense.
    for(const load of [loadTrainView, loadSessionRunner, loadGuidedRunner]) {
      load().catch(()=>{});
    }
  });
}
import { loadStore, saveStore } from './lib/store.js';
import { clearAllStoredData, hydrateStorage, refreshCachedStoreFromIdb, subscribeStoreCommits, whenPersisted } from './lib/storage.js';
import { recordEvent, recordErrorEvent } from './lib/telemetry.js';
import { watchStandaloneBodyClass, consumeShortcut } from './lib/pwa.js';
import { setHapticsSource } from './lib/haptics.js';
import OfflineBanner from './components/OfflineBanner.jsx';
import DemoBanner from './components/DemoBanner.jsx';
const InstallCard = lazy(() => import('./components/InstallCard.jsx'));
import { setRestPreset } from './lib/gymMode.js';
import { cancellationPlan } from './services/workoutCancellationService.js';
import { setTelemetryConsent } from './services/settingsService.js';

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
  const [consentOpen,setConsentOpen]=useState(()=> !loadStore().demo && loadStore().preferences?.telemetryEnabled == null);
  const [onboardingOpen,setOnboardingOpen]=useState(()=> !loadStore().onboarding && !loadStore().demo);
  const [updateReady,setUpdateReady]=useState(false);
  const [updateDeferred,setUpdateDeferred]=useState(false);
  const [persistFailed,setPersistFailed]=useState(false);
  // Quota guard: one backup prompt per escalation level per session. At
  // critical, a best-effort snapshot is captured automatically so the last
  // healthy state is recoverable even if the prompt is dismissed.
  const [quotaPrompt,setQuotaPrompt]=useState(null);
  const quotaPromptedRef=useRef(null);
  const [toast,setToast]=useState(null);
  const applyReloadRef=useRef(false);
  const saveInFlightRef=useRef(false);
  const storeRef=useRef(store);
  const activeSessionRef=useRef(activeSession);
  // Protection is per-tab ownership, not merely "the canonical store contains
  // an activeWorkout". An idle peer may observe another tab's draft and still
  // must continue accepting later invalidations from that owner.
  const localDraftProtectedRef=useRef(Boolean(store.activeWorkout));
  const externalSnapshotRef=useRef(null);
  // A snapshot persisted explicitly on a durability-critical path (workout
  // completion/demo load) must not be written a second time by the generic
  // React persistence effect after state catches up.
  const durableSnapshotRef=useRef(null);
  const persistenceOptionsRef=useRef(null);
  const crossTabRefreshRef=useRef(null);
  storeRef.current = store;
  activeSessionRef.current = activeSession;

  // ── Demo mode ─────────────────────────────────────────────────────────
  // "Try it with sample data" — a fully populated app (month of training,
  // live schedule) for cold-start exploration. The store is generated by a
  // seeded fixture, ids are `demo-` prefixed, and the exit wipes everything
  // back to a true empty start. Demo data never mingles with real data
  // because demo mode only ever starts from a wiped slate.
  const isDemo = Boolean(store.demo);
  const prepareDestructiveTransition = useCallback(async (reason)=>{
    // Snapshot is best-effort; the wipe is not. If clearing canonical storage
    // fails we must never proceed into demo/fresh state and risk mixing worlds.
    // Flush first so the safety snapshot includes the latest queued React save.
    await whenPersisted();
    try{
      const { captureSnapshot } = await import('./lib/snapshots.js');
      await captureSnapshot({ force: true, reason });
    }catch{}
    await clearAllStoredData({ preserveSnapshots:true });
    // Clearing deliberately latches writes off so an in-flight pre-clear save
    // cannot resurrect old data. Re-hydrate the now-empty canonical store
    // before demo/fresh-state code writes anything new.
    await hydrateStorage();
  }, []);

  const loadDemo = useCallback(async () => {
    try{
      await prepareDestructiveTransition('pre-demo');
      // Lazy: the seeded generator is demo-only and never belongs in the boot chunk.
      const { makeDemoStore } = await import('./lib/demoData.js');
      const demo = makeDemoStore();
      if(!saveStore(demo)) throw new Error('Could not queue demo data for storage.');
      await whenPersisted();
      durableSnapshotRef.current = demo;
      setStoreState(demo);
      setPersistFailed(false);
      setOnboardingOpen(false);
      setConsentOpen(false);
      setTab('today');
      setToast({ title: 'Demo loaded — explore freely', detail: 'Sample training data, clearly labeled. “Start fresh” in the banner erases it.', note: 'Nothing syncs while in demo mode.' });
      return true;
    }catch(err){
      setToast({
        title: 'Demo could not start',
        detail: 'Arise could not safely clear the current device data, so your existing data was left in place.',
        note: String(err?.message || err || 'Storage operation failed.'),
      });
      return false;
    }
  }, [prepareDestructiveTransition]);

  const exitDemo = useCallback(async ()=>{
    await prepareDestructiveTransition('pre-exit-demo');
  }, [prepareDestructiveTransition]);

  // State-setting wrapper kept for all call sites and child views. Persistence
  // happens once, in the [store] effect below — never inside the setter. The
  // optional second argument is reserved for explicit persistence semantics
  // such as a full backup replacement of the evaluation ledger.
  const setStore = useCallback((value, persistenceOptions = null)=>{
    if(persistenceOptions) persistenceOptionsRef.current = persistenceOptions;
    setStoreState(value);
  }, []);

  // Single persistence point: state updates flow through setStoreState and this
  // effect writes once. (Saving inside updaters or wrappers double-wrote on
  // every keystroke under StrictMode.) Demo mode never re-persists through
  // here: the demo store is written once when loaded, and a save racing the
  // demo exit could resurrect sample data after the wipe.
  const isDemoRef = useRef(false);
  isDemoRef.current = Boolean(store.demo);
  useEffect(()=>{
    if(isDemoRef.current) return;
    if(externalSnapshotRef.current === store){
      externalSnapshotRef.current = null;
      return;
    }
    if(durableSnapshotRef.current === store){
      durableSnapshotRef.current = null;
      setPersistFailed(false);
      return;
    }
    const persistenceOptions = persistenceOptionsRef.current;
    persistenceOptionsRef.current = null;
    if(!saveStore(store, persistenceOptions)){
      setPersistFailed(true);
      return;
    }
    let live = true;
    void whenPersisted()
      .then(()=> { if(live) setPersistFailed(false); })
      .catch((err)=> {
        if(!live) return;
        setPersistFailed(true);
        try{ recordErrorEvent(err, { where:'store-persist' }); }catch{}
      });
    return ()=> { live = false; };
  },[store]);

  // Warm the lazy route chunks once boot has settled (see warmLazyViews).
  useEffect(()=>{ warmLazyViews(); },[]);

  // Data-loss protection: the first logged session is the first moment there
  // is something to lose, so that is when we ask the browser to make this
  // origin's storage persistent (never evicted under pressure). Latched to
  // once per device — a user who declined is not re-prompted, and More keeps
  // a manual retry. Local only: no notification, no network.
  const persistAskedRef = useRef(false);
  useEffect(()=>{
    if(persistAskedRef.current) return;
    if(!(store.history?.length > 0)) return;
    if(store.demo) return;
    persistAskedRef.current = true;
    // Deferred off the boot path on purpose. navigator.storage.persisted()
    // and persist() are real async calls into the browser's storage layer; on
    // the critical path they compete with hydration and the first paint, and
    // on a profile that already has history they fire on EVERY app open. The
    // ask is about durability, not about what the user is doing right now, so
    // it waits for an idle main thread.
    let live = true;
    const ask = ()=>{
      if(!live) return;
      import('./lib/storageQuota.js')
        .then(({ requestPersistentStorageOnce })=> requestPersistentStorageOnce())
        .catch(()=>{});
    };
    const idle = typeof requestIdleCallback === 'function'
      ? requestIdleCallback(ask, { timeout: 4000 })
      : setTimeout(ask, 4000);
    return ()=>{
      live = false;
      if(typeof cancelIdleCallback === 'function' && typeof idle === 'number') cancelIdleCallback(idle);
      else clearTimeout(idle);
    };
  },[store.history?.length, store.demo]);

  // Storage-quota watch: evaluate shortly after boot and re-check when the
  // store grows (every persistence round). Cheap, async, fail-soft.
  useEffect(()=>{
    let live = true;
    import('./lib/quotaGuard.js')
    .then(({ checkQuotaProtection })=> checkQuotaProtection({
      lastPromptedLevel:quotaPromptedRef.current,
      isActive:()=> live,
    }))
    .then(({ decision, snapshotCaptured }) => {
      if(!live || !decision) return;
      if(decision.shouldPrompt){
        quotaPromptedRef.current = decision.level;
        setQuotaPrompt({ ...decision, snapshotCaptured });
      }
    }).catch(()=>{});
    return ()=> { live = false; };
  },[store.history?.length, store.readinessLog?.length]);

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
    let live = true;
    let registration = null;
    let installing = null;
    const onControllerChange = ()=>{
      // Only reload when WE activated a waiting worker (applyUpdate). The very
      // first claim after install would otherwise loop-reload first-time visits.
      if(window.__ariseSwActivating) window.location.reload();
    };
    const onInstallingStateChange = ()=>{
      if(live && installing?.state === 'installed' && navigator.serviceWorker.controller) setUpdateReady(true);
    };
    const onUpdateFound = ()=>{
      if(installing) installing.removeEventListener?.('statechange', onInstallingStateChange);
      installing = registration?.installing || null;
      installing?.addEventListener?.('statechange', onInstallingStateChange);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    // Check for waiting SW on load
    navigator.serviceWorker.getRegistration().then(r=>{
      if(!live) return;
      registration = r || null;
      if(r?.waiting) setUpdateReady(true);
      registration?.addEventListener?.('updatefound', onUpdateFound);
    });
    return ()=> {
      live = false;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      registration?.removeEventListener?.('updatefound', onUpdateFound);
      installing?.removeEventListener?.('statechange', onInstallingStateChange);
    };
  },[]);

  // IndexedDB is canonical after hydration. Other tabs publish only a small
  // invalidation message after their durable commit; this tab then performs a
  // real IDB re-read rather than consulting its process-local cache. Active
  // drafts are protected and the refresh is deferred until the workout ends.
  useEffect(()=>{
    let disposed = false;
    let cleanup = ()=>{};
    void import('./lib/crossTabStore.js').then(({ createStoreInvalidationBus, createStoreRefreshCoordinator })=>{
      if(disposed) return;
      const bus = createStoreInvalidationBus();
      const stopPublishing = subscribeStoreCommits((reason)=> bus.publish(reason));
      const coordinator = createStoreRefreshCoordinator({
        subscribe: (handler)=> bus.subscribe(handler),
        isProtected: ()=> Boolean(activeSessionRef.current || localDraftProtectedRef.current),
        readCanonical: async()=> {
          await whenPersisted();
          await refreshCachedStoreFromIdb();
          return loadStore();
        },
        applyCanonical: (next)=> {
          localDraftProtectedRef.current = false;
          externalSnapshotRef.current = next;
          setStoreState(next);
          setRecoveryOpen(Boolean(next?.activeWorkout));
        },
      });
      crossTabRefreshRef.current = coordinator;
      cleanup = ()=> {
        stopPublishing();
        crossTabRefreshRef.current = null;
        coordinator.close();
        bus.close();
      };
    }).catch(()=>{});
    return ()=> {
      disposed = true;
      cleanup();
    };
  },[]);

  useEffect(()=>{
    if(!activeSession && !store.activeWorkout) void crossTabRefreshRef.current?.flushDeferred();
  },[activeSession, store.activeWorkout]);

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
    const onUnhandledRejection = (e)=> onError(e.reason || e);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return ()=> {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  },[]);

  const handleCompleteOnboarding = (payload)=>{
    const next = { ...store, onboarding: payload };
    setStore(next);
  };

  // Progress's empty-state CTA: start the scheduled session if one is due,
  // otherwise jump to Train to pick one. Never a dead button.
  const startFromProgress = ()=>{
    if(!store.activeSchedule){ setTab('train'); return; }
    import('./lib/schedule.js').then(({ sessionForToday, nextSession })=>{
      const session = sessionForToday(store.activeSchedule) || nextSession(store.activeSchedule);
      if(session) handleStartSession(session);
      else setTab('train');
    }).catch(()=> setTab('train'));
  };

  const handleStartSession = (session)=>{
    if(store.activeWorkout && store.activeWorkout.session?.id !== session.id){
      setRecoveryOpen(true);
      return;
    }
    setActiveSession(session);
    // Completion/adaptation logic is deliberately outside the boot graph. Warm
    // it once the user enters a workout so the eventual Save stays instant.
    void import('./services/workoutService.js').catch(()=>{});
    localDraftProtectedRef.current = true;
    setRecoveryOpen(false);
    try { recordEvent('session:start', { sessionId: session.id, title: session.title }); } catch {}
  };

  const chooseMeasurementConsent=(enabled)=>{
    setStore(setTelemetryConsent(store, enabled));
    recordEvent('consent:local-measurements', { enabled }, { essential:true });
    setConsentOpen(false);
  };

  const handleDraftChange = useCallback((draft)=>{
    // Pure updater — the [store] effect below owns persistence. Writing
    // localStorage inside an updater double-fires under StrictMode.
    localDraftProtectedRef.current = true;
    setStoreState(prev=> ({ ...prev, activeWorkout: draft }));
  },[]);

  // Gym Mode preferences (rest presets, focus defaults) are portable session
  // behaviour with per-exercise recency metadata, merged deterministically
  // (see sync.js mergeGymPrefs) — never receiving-device-wins.
  const handleSetRestPreset = useCallback((exerciseId, seconds)=>{
    setStoreState(prev=>{
      const now = new Date().toISOString();
      const map = setRestPreset(prev.gymPrefs, exerciseId, seconds);
      const prevTs = (prev.gymPrefs?.restPresetUpdatedAt && typeof prev.gymPrefs.restPresetUpdatedAt === 'object') ? prev.gymPrefs.restPresetUpdatedAt : {};
      const nextTs = { ...prevTs };
      if(seconds > 0) nextTs[exerciseId] = now;
      else delete nextTs[exerciseId];
      return { ...prev, gymPrefs: { ...(prev.gymPrefs||{}), restPresets: map, restPresetUpdatedAt: nextTs, updatedAt: now } };
    });
  },[]);

  const handleSaveSession = async (payload)=>{
    if(saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    let persistenceStage = false;
    // Save-time measurement covers the deterministic completion workflow. The
    // chunk is pre-warmed at workout start; auto-sync remains fire-and-forget.
    try{
      const { completeWorkoutWorkflow, recordWorkoutEvents, runPostSaveIntegrations } = await import('./services/workoutService.js');
      const saveStartedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : null;
      const completed = completeWorkoutWorkflow({
        store:storeRef.current,
        payload,
        saveStartedAt,
        performanceNow:saveStartedAt != null && typeof performance !== 'undefined' && performance.now ? ()=> performance.now() : null,
      });
      const { store:next, history:hist, events, toast:saveToast } = completed;
      // Workout completion is durability-critical: do not dismiss the runner,
      // clear its recoverable draft, or announce success until IndexedDB has
      // committed the completed snapshot. storage.js rolls its cache back if
      // this write fails and no newer local snapshot superseded it.
      persistenceStage = true;
      if(!saveStore(next)) throw new Error('Could not queue the completed workout for storage.');
      await whenPersisted();
      // The write may have three-way reconciled with another tab. Re-read the
      // committed canonical snapshot so this writer does not keep rendering a
      // pre-merge local object after reporting success.
      await refreshCachedStoreFromIdb();
      const committedStore = loadStore();
      durableSnapshotRef.current = committedStore;
      setPersistFailed(false);
      setStore(committedStore);
      runPostSaveIntegrations({ store:committedStore, payload, history:committedStore.history || hist, setStore });
      localDraftProtectedRef.current = false;
      setActiveSession(null);
      setRecoveryOpen(false);
      setTab('progress');
      setToast(saveToast);
      recordWorkoutEvents(events);
    }catch(err){
      if(persistenceStage) setPersistFailed(true);
      try{ recordErrorEvent(err, { where:'workout-save', sessionId:payload?.id }); }catch{}
      setToast({
        kind:'error',
        title:'Workout not saved',
        detail:'Your in-progress workout is still on this device. Try Save again.',
        note:String(err?.message || err || 'Save workflow could not load.'),
      });
    }finally{
      saveInFlightRef.current = false;
    }
  };
  const retryPersistence = async()=>{
    const snapshot = storeRef.current;
    if(!saveStore(snapshot)){
      setPersistFailed(true);
      return;
    }
    try{
      await whenPersisted();
      await refreshCachedStoreFromIdb();
      const committedStore = loadStore();
      durableSnapshotRef.current = committedStore;
      setStoreState(committedStore);
      setPersistFailed(false);
      setToast({ title:'Storage retry succeeded', detail:'Your latest app state is durable on this device.' });
    }catch(err){
      setPersistFailed(true);
      try{ recordErrorEvent(err, { where:'store-persist-retry' }); }catch{}
    }
  };

  // Durable workout discard. Presentation (SessionRunner/GuidedRunner) owns
  // its confirmation UI and calls this only after the user confirmed once —
  // there is no second confirmation here. Telemetry (session:abandon) and the
  // durable draft removal still happen exactly as before, and the crash-draft
  // / cross-tab protections are released only after the removal is committed.
  const handleCancelSession = async()=>{
    const plan = cancellationPlan({ store:storeRef.current, activeSession:activeSessionRef.current });
    if(plan.event) try{ recordEvent(plan.event.type, plan.event.payload); }catch{}
    try{
      if(!saveStore(plan.nextStore)) throw new Error('Could not queue draft removal for storage.');
      await whenPersisted();
      await refreshCachedStoreFromIdb();
      const committedStore = loadStore();
      durableSnapshotRef.current = committedStore;
      setStoreState(committedStore);
      setPersistFailed(false);
      localDraftProtectedRef.current = false;
      setActiveSession(null);
      setRecoveryOpen(false);
    }catch(err){
      setPersistFailed(true);
      try{ recordErrorEvent(err, { where:'workout-cancel' }); }catch{}
    }
  };

  const resumeDraft = ()=>{
    const draft=store.activeWorkout;
    if(!draft?.session){
      setStore({ ...store, activeWorkout: null });
      setRecoveryOpen(false);
      return;
    }
    void import('./services/workoutService.js').catch(()=>{});
    setActiveSession(draft.session);
    localDraftProtectedRef.current = true;
    setRecoveryOpen(false);
    try { recordEvent('session:resume', { sessionId: draft.session.id }); } catch {}
  };

  const discardDraft = async()=>{
    const next = { ...storeRef.current, activeWorkout:null };
    try{
      if(!saveStore(next)) throw new Error('Could not queue draft removal for storage.');
      await whenPersisted();
      await refreshCachedStoreFromIdb();
      const committedStore = loadStore();
      durableSnapshotRef.current = committedStore;
      setStoreState(committedStore);
      setPersistFailed(false);
      localDraftProtectedRef.current = false;
      setRecoveryOpen(false);
    }catch(err){
      setPersistFailed(true);
      try{ recordErrorEvent(err, { where:'draft-discard' }); }catch{}
    }
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

  // PWA shell: standalone body class (CSS hooks: status-bar padding), and
  // home-screen shortcut landing (?shortcut=start-workout / quick-log).
  // Haptics read storeRef so the source is installed once rather than mutating
  // module state during every React render.
  useEffect(()=> { setHapticsSource(() => storeRef.current.preferences?.haptics !== false); }, []);

  useEffect(() => watchStandaloneBodyClass(), []);
  useEffect(() => { consumeShortcut(setTab); }, []);

  // A deferred update applies automatically the moment the workout ends
  // (save or discard both clear activeSession).
  useEffect(()=>{
    if(updateReady && updateDeferred && !activeSession) performUpdateReload();
  }, [updateReady, updateDeferred, activeSession]);

  return (
    <AppShell tab={tab} setTab={setTab} storeVersion={store.version} theme={theme} onCycleTheme={cycleTheme}>
      <OfflineBanner />
      {isDemo && <DemoBanner onExitDemo={exitDemo} />}
      <LiveAnnouncer />
      {tab==='today' && <Suspense fallback={null}><InstallCard /></Suspense>}
      {updateReady && (
        <div className="mx-4 mt-2 rounded-xl border border-review/30 bg-reviewsoft px-3 py-2 flex items-center gap-2 text-xs">
          <span className="font-bold text-review">Update available</span>
          <span className="text-ink2">{updateDeferred ? 'Update will apply after this workout — no rush.' : 'New version cached — reload to apply.'}</span>
          <button onClick={applyUpdate} className="ml-auto btn btn-primary min-h-8 rounded-xl px-3 text-xs">Update</button>
        </div>
      )}
      {persistFailed && (
        <div className="mx-4 mt-2 rounded-xl border border-review/40 bg-reviewsoft px-3 py-2 flex flex-wrap items-center gap-2 text-xs" role="alert">
          <span className="font-bold text-review">Storage write failed</span>
          <span className="text-ink2 flex-1 min-w-40">Keep this tab open. Your latest in-memory changes may not be durable yet.</span>
          <button onClick={retryPersistence} className="btn btn-primary min-h-8 rounded-xl px-3 text-xs">Retry</button>
          <button onClick={()=> setTab('more')} className="btn btn-secondary min-h-8 rounded-xl px-3 text-xs">Back up</button>
        </div>
      )}
      {quotaPrompt && (
        <div className="mx-4 mt-2 rounded-xl border border-review/30 bg-reviewsoft px-3 py-2 flex flex-wrap items-center gap-2 text-xs" role="alert">
          <span className="font-bold text-review">{quotaPrompt.level === 'critical' ? 'Storage almost full' : 'Storage filling up'}</span>
          <span className="text-ink2 flex-1 min-w-40">{quotaPrompt.level === 'critical'
            ? quotaPrompt.snapshotCaptured
              ? 'Writes may start failing. Export a backup now — a safety snapshot was taken automatically.'
              : 'Writes may start failing. Export a backup now — the automatic safety snapshot could not be confirmed.'
            : 'Past 80% of this browser’s storage quota. An export now keeps you safe.'}</span>
          <button onClick={()=> setTab('more')} className="btn btn-primary min-h-8 rounded-xl px-3 text-xs">Back up now</button>
          <button onClick={()=> setQuotaPrompt(null)} className="btn btn-secondary min-h-8 rounded-xl px-2.5 text-xs" aria-label="Dismiss storage prompt">✕</button>
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
        <div role="status" className={`fixed bottom-20 inset-x-4 z-30 mx-auto max-w-md rounded-2xl border px-4 py-3 flex items-start gap-3 fade-in ${toast.kind === 'error' ? 'border-review/40 bg-reviewsoft' : 'border-success/30 bg-successsoft'}`}>
          <span aria-hidden className="text-base leading-none mt-0.5">{toast.kind === 'error' ? '!' : '✓'}</span>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-bold truncate ${toast.kind === 'error' ? 'text-review' : 'text-success'}`}>{toast.title}</p>
            <p className="text-xs text-ink2">{toast.detail}</p>
            {toast.note && <p className="text-[11px] text-ink3 mt-0.5">{toast.note}</p>}
          </div>
          <button onClick={()=> setToast(null)} aria-label="Dismiss" className="shrink-0 -mt-1 -mr-1 w-8 h-8 grid place-items-center rounded-full text-ink3 hover:text-ink">✕</button>
        </div>
      )}
      {tab==='today' && (
        <Suspense fallback={<TabFallback label="Today" />}><TodayView
            store={store}
            setStore={setStore}
            onStartSession={handleStartSession}
            onOpenTrain={()=> setTab('train')}
            onOpenProgress={()=> setTab('progress')}
            plateConfig={store.onboarding?.plateConfig || null}
          /></Suspense>
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
        <Suspense fallback={<TabFallback label="Exercises" />}><ExerciseBrowser store={store} availableEquipment={store.onboarding?.equipment || []} onboarding={store.onboarding} /></Suspense>
      )}

      {tab==='progress' && <Suspense fallback={<TabFallback label="Progress" />}><ProgressView store={store} setStore={setStore} onStart={startFromProgress} /></Suspense>}
      {tab==='more' && <Suspense fallback={<TabFallback label="More" />}><MoreView store={store} setStore={setStore} onboardingOpen={onboardingOpen} setOnboardingOpen={setOnboardingOpen} onLoadDemo={loadDemo} /></Suspense>}

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
          plateConfig={store.onboarding?.plateConfig || null}
          appPrefs={store.preferences || null}
          studyEnrollment={store.studyEnrollment || null}
          participantId={store.studyParticipantId || null}
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

      {onboardingOpen && (
        <Suspense fallback={null}><Onboarding
          open={onboardingOpen}
          onClose={()=> setOnboardingOpen(false)}
          onComplete={handleCompleteOnboarding}
          initial={store.onboarding}
          units={store.preferences?.units || 'kg'}
          onLoadDemo={isDemo ? null : loadDemo}
        /></Suspense>
      )}

      {!store.onboarding && !onboardingOpen && !isDemo && (
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
