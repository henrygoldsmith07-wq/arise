import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from './components/AppShell.jsx';
import TodayView from './components/TodayView.jsx';
import TrainView from './components/TrainView.jsx';
import ExerciseBrowser from './components/ExerciseBrowser.jsx';
import ProgressView from './components/ProgressView.jsx';
import MoreView from './components/MoreView.jsx';
import SessionRunner from './components/SessionRunner.jsx';
import Onboarding from './components/Onboarding.jsx';
import { loadStore, saveStore, upsertHistory } from './lib/store.js';
import { recommendExercises } from './lib/data.js';
import { recordEvent } from './lib/telemetry.js';
import { pushToPulse } from './lib/pulse.js';
import { adaptActiveSchedule } from './lib/programming.js';
import { attachOutcome } from './lib/longitudinal.js';

export default function App(){
  const [store,setStoreState]=useState(()=> loadStore());
  const [tab,setTab]=useState('today');
  const [activeSession,setActiveSession]=useState(null);
  const [recoveryOpen,setRecoveryOpen]=useState(()=> Boolean(loadStore().activeWorkout));
  const [consentOpen,setConsentOpen]=useState(()=> loadStore().preferences?.telemetryEnabled == null);
  const [onboardingOpen,setOnboardingOpen]=useState(()=> !loadStore().onboarding);
  const [updateReady,setUpdateReady]=useState(false);
  const [persistFailed,setPersistFailed]=useState(false);
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

  useEffect(()=>{
    setConsentOpen(store.preferences?.telemetryEnabled == null);
  },[store.preferences?.telemetryEnabled]);

  useEffect(()=>{
    const isDark = store.preferences?.theme ? store.preferences.theme==='dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', isDark);
  },[store.preferences?.theme]);

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

  // Global error telemetry (privacy-gated, local only)
  useEffect(()=>{
    const onError = (e)=>{
      try { recordEvent('error', { message: String(e.message||e.error||e), at: new Date().toISOString() }); } catch {}
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
    next = { ...next, history: hist, activeSchedule, activeWorkout: null };
    setStore(next);
    setActiveSession(null);
    setRecoveryOpen(false);
    setTab('progress');
    try { recordEvent('session:complete', { sessionId: payload.id, blocks: payload.blocks.length }); } catch {}
    if(adaptation?.changed){
      try { recordEvent('programme:adapt', { sessionId: payload.id, changes: adaptation.changes, decision: adaptation.decision }); } catch {}
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

  return (
    <AppShell tab={tab} setTab={setTab} storeVersion={store.version}>
      {updateReady && (
        <div className="mx-4 mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 flex items-center gap-2 text-xs">
          <span className="font-bold">Update available</span>
          <span className="text-ink3">New version cached — reload to apply.</span>
          <button onClick={applyUpdate} className="ml-auto btn btn-primary min-h-8 rounded-xl px-3 text-xs">Update</button>
        </div>
      )}
      {recoveryOpen && store.activeWorkout && !activeSession && (
        <div className="mx-4 mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-2" role="alert">
          <div className="flex items-start gap-3">
            <span className="text-base" aria-hidden>↩</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Resume your workout?</p>
              <p className="text-xs text-amber-900">{store.activeWorkout.session?.title || 'Workout'} · {draftDone}/{draftSets} sets saved locally{store.activeWorkout.updatedAt ? ` · last updated ${formatDraftTime(store.activeWorkout.updatedAt)}` : ''}</p>
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
        <TrainView
          store={store}
          setStore={setStore}
          onStartSession={handleStartSession}
          availableEquipment={store.onboarding?.equipment || []}
        />
      )}
      {tab==='exercises' && (
        <>
          <ExerciseBrowser availableEquipment={store.onboarding?.equipment || []} />
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
      {tab==='progress' && <ProgressView store={store} />}
      {tab==='more' && <MoreView store={store} setStore={setStore} setTab={setTab} onboardingOpen={onboardingOpen} setOnboardingOpen={setOnboardingOpen} />}

      {activeSession && (
        <SessionRunner
          session={activeSession}
          history={store.history || []}
          availableEquipment={store.onboarding?.equipment || []}
          plateConfig={store.onboarding?.plateConfig || null}
          preferences={store.onboarding || null}
          draft={store.activeWorkout?.session?.id===activeSession.id ? store.activeWorkout : null}
          measurementConsent={store.preferences?.telemetryEnabled === true}
          onDraftChange={handleDraftChange}
          onSave={handleSaveSession}
          onCancel={handleCancelSession}
        />
      )}

      <Onboarding
        open={onboardingOpen}
        onClose={()=> setOnboardingOpen(false)}
        onComplete={handleCompleteOnboarding}
        initial={store.onboarding}
      />

      {!store.onboarding && !onboardingOpen && (
        <div className="fixed bottom-20 inset-x-4 z-10 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3">
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
