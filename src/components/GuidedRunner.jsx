import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { EXERCISE_BY_ID } from '../lib/data.js';
import {
  NOTE_PROMPTS,
  fmtRest,
  initGuidedBlocks,
  nextGuidedStep,
  guidedProgress,
  guidedVolumeKg,
  sessionElapsedMs,
  formatElapsed,
  buildGuidedPayload,
  withGuidedStepPrescription,
  applyGuidedTreatment,
} from '../lib/guidedMode.js';
import { recordEvent, trackFieldFocus, fieldCommitted } from '../lib/telemetry.js';
import { recordRecommendation } from '../lib/longitudinal.js';
import { runComparativeStudy } from '../lib/study.js';
import { studyArmFor } from '../lib/studyEnrollment.js';
import { POLICY_ORDER } from '../lib/progressionPolicies.js';
import { treatmentRecommendation } from '../lib/treatment.js';
import { restStartCue, restTickCue, restCompleteCue } from '../lib/audioCues.js';
import { speak, cancelSpeech, voiceSupported } from '../lib/voiceCoach.js';
import { haptic } from '../lib/haptics.js';
import { announce } from '../lib/a11y.js';
import { createWakeLock } from '../lib/wakeLock.js';
import { restPresetFor } from '../lib/gymMode.js';
import { predictSessionDuration, sessionPace } from '../lib/warmup.js';
import { RestDock, WeightInput } from './GymModePanel.jsx';
import { asUnit, fmtWeight, localizeWeightText } from '../lib/units.ts';
import ExerciseIllustration from './ExerciseIllustration.jsx';
const TeachingPanel = lazy(() => import('./TeachingPanel.jsx'));

// GuidedRunner — the guided workout mode: one set at a time, full-screen.
// Reuses the same draft persistence contract as SessionRunner (onDraftChange
// with { session, blocks, ... }), so crash recovery and cross-tab protection
// in App.jsx work identically for both modes.
export default function GuidedRunner({ session, history = [], availableEquipment = [], draft = null, measurementConsent = false, soundCues = true, onToggleSoundCues = null, voiceCoach = false, onToggleVoiceCoach = null, voiceRate = 1, wakeLock = false, gymPrefs = null, onSetRestPreset = null, studyEnrollment = null, participantId = null, plateConfig = null, appPrefs = null, onDraftChange, onSave, onCancel }){
  const unit = asUnit(appPrefs?.units);
  const startedAtRef=useRef(draft?.startedAt || new Date().toISOString());
  // Time of the last logged guided step (complete or skip), for per-step
  // elapsed times — the same "time since last logged action" contract as the
  // standard runner's set:complete elapsedMs.
  const lastStepAtRef=useRef(draft?.startedAt || startedAtRef.current);
  const setSeqRef=useRef(0);
  const makeSetId=()=> `${session.id}:set:${Date.now().toString(36)}:${(setSeqRef.current++).toString(36)}`;
  const [blocks,setBlocks]=useState(()=> initGuidedBlocks(session, history, draft?.blocks));
  const [note,setNote]=useState(()=> draft?.note || '');
  const [noteTags,setNoteTags]=useState(()=> draft?.noteTags || []);
  const [restEndsAt,setRestEndsAt]=useState(()=> draft?.restEndsAt || null);
  const [restLabel,setRestLabel]=useState(()=> draft?.restLabel || '');
  const [restExerciseId,setRestExerciseId]=useState(()=> draft?.restExerciseId || null);
  const [clock,setClock]=useState(()=> Date.now());
  const [celebrate,setCelebrate]=useState(false);
  const [soundOn,setSoundOn]=useState(soundCues);
  const [voiceOn,setVoiceOn]=useState(voiceCoach);
  const [announcement,setAnnouncement]=useState('');
  const restTickRef=useRef(null);
  const spokenStepRef=useRef(null);
  const wakeLockRef=useRef(null);
  const draftRef=useRef(null);
  const rootRef=useRef(null);
  const closeRef=useRef(null);
  // Randomised field study: the SAME frozen arm assignment the standard
  // runner enforces (shared studyArmFor + treatmentRecommendation), so
  // treatment follows the exercise and participant, never the workout mode.
  // Exercises never randomised resolve to null: normal product behaviour,
  // excluded from the study — never a silent default to Arise.
  const appPolicy = POLICY_ORDER.includes(appPrefs?.progressionPolicy) ? appPrefs.progressionPolicy : 'standard';
  const study = useMemo(()=>{
    try{ return runComparativeStudy(history); }catch{ return null; }
  },[history]);
  // Shown/exercised once per exercise across remounts: the set survives a
  // dev double-effect and is re-seeded from the draft, so a crash-recovery
  // resume never records a second prospective row for the same exercise.
  const shownRecommendationRef = useRef(new Set(Array.isArray(draft?.recordedExercises) ? draft.recordedExercises : []));
  // Mode-entry timing anchor for guided mode (value-free, same contract as
  // the standard runner's mount/toggle anchors). Guided sessions never
  // switch modes, so one entry covers the whole session; a genuine remount
  // (resume after reload) starts a new interval.
  const modeEnterEmittedRef=useRef(false);
  useEffect(()=>{
    if(modeEnterEmittedRef.current) return;
    modeEnterEmittedRef.current = true;
    try{ recordEvent('mode:enter', { sessionId: session.id, mode: 'guided' }); }catch{}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // Escape exits only via the guarded cancel path — never silently destroys
  // a workout with logged sets.
  useEffect(()=>{
    const onKey = (e)=>{
      if(e.key!=='Escape') return;
      onCancel();
    };
    window.addEventListener('keydown', onKey);
    return ()=> window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Dialog semantics: move focus in on mount, restore it on unmount.
  useEffect(()=>{
    const previous=document.activeElement;
    closeRef.current?.focus();
    return ()=> { try{ previous?.focus?.(); }catch{} };
  },[]);

  // Focus trap: aria-modal promises AT that background content is unreachable.
  const trapTab=(e)=>{
    if(e.key!=='Tab' || !rootRef.current) return;
    const focusables=[...rootRef.current.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter(el=> !el.disabled && el.offsetParent!==null);
    if(!focusables.length) return;
    const first=focusables[0], last=focusables[focusables.length-1];
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
  };

  // Session timer ticks every second while running; rest countdown ticks
  // faster for a smooth expiry check. Wall-clock based, so refresh/sleep safe.
  useEffect(()=>{
    const id=setInterval(()=> setClock(Date.now()), 500);
    return ()=> clearInterval(id);
  },[]);

  // Gym Mode: keep the screen awake for the whole guided session (opt-in).
  useEffect(()=>{
    if(!wakeLock) return undefined;
    const lock = createWakeLock();
    wakeLockRef.current = lock;
    lock.acquire();
    return ()=> { wakeLockRef.current = null; lock.release(); };
  }, [wakeLock]);

  const restLeft = restEndsAt ? Math.max(0, Math.ceil((restEndsAt-clock)/1000)) : null;

  // 3-2-1 ticks: one cue per remaining second, never repeated for the same second.
  useEffect(()=>{
    if(!restEndsAt){ restTickRef.current = null; return; }
    const left = Math.ceil((restEndsAt - Date.now())/1000);
    if(left >= 1 && left <= 3 && restTickRef.current !== left){
      restTickRef.current = left;
      if(soundOn) restTickCue();
      haptic('guidedStep');
    }
  },[clock, restEndsAt, soundOn]);

  // Rest expiry — clears the countdown, fires the completion cue and a
  // distinct triple-pulse haptic so the next set is unmissable.
  useEffect(()=>{
    if(restEndsAt && restEndsAt <= Date.now()){
      setRestEndsAt(null);
      setAnnouncement('Rest complete — next set.');
      if(soundOn) restCompleteCue();
      haptic('guidedFinish');
    }
  },[restEndsAt, clock, soundOn]);

  // Sound-cue toggle: flips the persisted preference when a callback is wired.
  const toggleSound = ()=>{
    const next = !soundOn;
    setSoundOn(next);
    onToggleSoundCues?.(next);
    try { recordEvent('guided:sound-cues', { enabled: next }); } catch {}
  };

  // Voice coach: speaks the exercise name, set number and rep target when a
  // new step starts. Toggling it on announces the current step immediately.
  // The same text is mirrored to the app's polite live region (marked spoken
  // so the SR doesn't double-read what TTS just said) when voice is OFF it is
  // a plain announcement — screen-reader users get step changes either way.
  const speakCurrentStep = (stepArg, blocksArg, on)=>{
    const block = stepArg ? blocksArg[stepArg.blockIndex] : null;
    if(!block) return;
    const set = block.sets[stepArg.setIndex];
    const name = EXERCISE_BY_ID[block.exerciseId]?.name || block.exerciseId;
    const reps = String(set?.reps || block.reps || '').trim();
    const load = String(set?.weightKg || '').trim();
    const parts = [`${name}.`, `Set ${stepArg.setIndex + 1} of ${block.sets.length}.`];
    if(reps) parts.push(`${reps} reps`);
    if(load) parts.push(`at ${fmtWeight(load, unit)}`);
    if(on){
      speak(parts.join(' '), voiceRate);
      announce(parts.join(' '), { key: 'guided-step', spoken: true });
    } else {
      announce(parts.join(' '), { key: 'guided-step' });
    }
  };

  const toggleVoice = ()=>{
    const next = !voiceOn;
    setVoiceOn(next);
    onToggleVoiceCoach?.(next);
    try { recordEvent('guided:voice-coach', { enabled: next }); } catch {}
    if(next) speakCurrentStep(step, blocks, true); else cancelSpeech();
  };

  // Leaving the runner (save/cancel/unmount) must stop any queued speech.
  useEffect(()=> ()=> cancelSpeech(), []);

  // Persist every meaningful interaction via the shared draft contract.
  useEffect(()=>{
    const nextDraft = {
      version: 1,
      runner: 'guided',
      session,
      blocks,
      note,
      noteTags,
      restEndsAt,
      restLabel,
      restExerciseId,
      startedAt: startedAtRef.current,
      // Which exercises' prospective evidence was already recorded — a resume
      // after crash/reload re-seeds shownRecommendationRef from this.
      recordedExercises: [...shownRecommendationRef.current],
      updatedAt: new Date().toISOString(),
    };
    draftRef.current = nextDraft;
    onDraftChange?.(nextDraft);
  }, [blocks, note, noteTags, restEndsAt, restLabel, restExerciseId, session, onDraftChange]);

  useEffect(()=>{
    const persistOnPageHide=()=>{
      if(draftRef.current) onDraftChange?.({ ...draftRef.current, updatedAt: new Date().toISOString() });
    };
    window.addEventListener('pagehide', persistOnPageHide);
    return ()=> window.removeEventListener('pagehide', persistOnPageHide);
  }, [onDraftChange]);

  const step = useMemo(()=> nextGuidedStep(blocks), [blocks]);
  const progress = useMemo(()=> guidedProgress(blocks), [blocks]);
  const volume = useMemo(()=> guidedVolumeKg(blocks), [blocks]);

  // Announce each new step exactly once (keyed by block/set, not object
  // identity — blocks re-created on every edit would re-speak).
  const stepKey = step ? `${step.blockIndex}:${step.setIndex}` : null;
  useEffect(()=>{
    if(!stepKey){ spokenStepRef.current = null; return; }
    if(spokenStepRef.current === stepKey) return;
    spokenStepRef.current = stepKey;
    speakCurrentStep(step, blocks, voiceOn);
  }, [stepKey, voiceOn]);
  // Per-exercise arm + treatment, computed once per change exactly like the
  // standard runner's blockMeta — the shown prescription, the frozen snapshot
  // and the recorded evidence all read from this single source.
  const guidedMeta = useMemo(()=>{
    const arms = new Map(), recs = new Map();
    for(const b of blocks){
      if(arms.has(b.exerciseId)) continue;
      const arm = studyArmFor(studyEnrollment, b.exerciseId);
      arms.set(b.exerciseId, arm);
      recs.set(b.exerciseId, treatmentRecommendation({ block: b, history, asOfDateISO: session.dateISO, plateConfig, study, assignedArm: arm, policy: appPolicy }));
    }
    return { arms, recs };
  },[blocks, history, session.dateISO, plateConfig, study, studyEnrollment, appPolicy]);

  // The guided runner shows one step at a time, so freeze a block's
  // prescription (and record its prospective evidence) the moment it becomes
  // the active step — not at session start, matching the deferred-capture
  // contract. Idempotent and array-stable, so a rerender that changes nothing
  // does not loop, and set/skip edits never re-stamp it.
  const activeBlockIndex = step ? step.blockIndex : null;
  useEffect(()=>{
    if(activeBlockIndex == null) return;
    const block = blocks[activeBlockIndex];
    if(!block) return;
    const arm = guidedMeta.arms.get(block.exerciseId) ?? null;
    const rec = guidedMeta.recs.get(block.exerciseId) || null;
    setBlocks(prev=> applyGuidedTreatment(
      withGuidedStepPrescription(session, prev, activeBlockIndex, new Date().toISOString(), makeSetId, rec, appPolicy),
      activeBlockIndex, arm, rec,
    ));
    if(rec && !shownRecommendationRef.current.has(block.exerciseId)){
      shownRecommendationRef.current.add(block.exerciseId);
      try{ recordEvent('recommendation:shown', { sessionId: session.id, exerciseId: block.exerciseId, assignedArm: arm ?? null, mode: 'guided' }); }catch{}
      try{
        recordRecommendation({
          exerciseId: block.exerciseId,
          recommendation: rec,
          history,
          dueDateISO: session.dateISO,
          programId: session.programId || null,
          programVersion: session.programVersion ?? null,
          targetReps: block.reps || undefined,
          assignedArm: arm ?? null,
          participantId,
          preferences: measurementConsent === true ? { telemetryEnabled: true } : null,
        });
      }catch{}
      // Carry the "already shown" markers into the draft so a resume after
      // reload or crash never records the same exercise twice.
      if(draftRef.current) onDraftChange?.({ ...draftRef.current, recordedExercises: [...shownRecommendationRef.current], updatedAt: new Date().toISOString() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[activeBlockIndex, session]);

  const elapsed = sessionElapsedMs(startedAtRef.current, clock);
  // The active step's arm/treatment, for honest on-screen disclosure when the
  // randomised assignment changes the target.
  const activeExerciseId = activeBlockIndex != null ? blocks[activeBlockIndex]?.exerciseId : null;
  const activeArm = activeExerciseId ? (guidedMeta.arms.get(activeExerciseId) ?? null) : null;
  const activeRec = activeExerciseId ? (guidedMeta.recs.get(activeExerciseId) || null) : null;
  // Live pace vs the pre-session plan — display-only, never telemetered.
  const pace = useMemo(()=>{
    try{
      const plannedMin = predictSessionDuration(blocks.map(b=> ({ sets: b.sets.length, restSec: b.restSec, warmups: b.warmups })));
      return sessionPace({ startedAtMs: Date.parse(startedAtRef.current), nowMs: clock, completedSets: progress.completed + progress.skipped, totalSets: progress.total, plannedMin });
    }catch{ return null; }
  },[blocks, clock, progress]);
  const paceLabel = pace ? `About ${pace.remainingMin} minutes left, estimated finish ${new Date(pace.etaMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${pace.aheadBehind === 'ahead' ? ', ahead of plan' : pace.aheadBehind === 'behind' ? ', behind plan' : ''}` : null;

  const currentBlock = step ? blocks[step.blockIndex] : null;
  const currentSet = currentBlock && step ? currentBlock.sets[step.setIndex] : null;
  const currentExercise = currentBlock ? EXERCISE_BY_ID[currentBlock.exerciseId] : null;

  const updateSet = (bi, si, patch)=> setBlocks(prev=> prev.map((b,i)=> i!==bi? b : { ...b, sets: b.sets.map((s,j)=> j!==si? s : { ...s, ...patch }) }));

  const startRest=(seconds,label,exerciseId=null)=>{
    const sec=Number(seconds)||0;
    if(sec<=0){ setRestEndsAt(null); return; }
    setRestLabel(label);
    setRestExerciseId(exerciseId);
    setRestEndsAt(Date.now() + sec*1000);
    setClock(Date.now());
    if(soundOn) restStartCue();
    haptic('setComplete');
  };

  // Complete the current step, auto-chain the rest timer, then announce.
  const completeStep=(skipped=false)=>{
    if(!step) return;
    const block=blocks[step.blockIndex];
    const set=block.sets[step.setIndex];
    if(skipped){
      updateSet(step.blockIndex, step.setIndex, { skipped: true, completed: false });
      try { recordEvent('set:skip', { sessionId: session.id, exerciseId: block.exerciseId, setIndex: step.setIndex, mode: 'guided' }); } catch {}
      lastStepAtRef.current = new Date().toISOString();
    } else {
      updateSet(step.blockIndex, step.setIndex, { completed: true });
      // Carry-forward within one exercise: the next step's empty load/reps
      // arrive prefilled from the set just logged, so steady-state guided
      // steps cost one tap (Done). Same-exercise only, empty-fields only —
      // the same safe prefill contract as the standard runner. No RIR field
      // exists in guided mode, so nothing effort-related is ever carried.
      // (Computed against post-completion state: the closure's blocks still
      // show the current step unfinished, which would resolve to itself.)
      const afterBlocks = blocks.map((b,bi)=> bi!==step.blockIndex ? b : { ...b, sets: b.sets.map((s,si)=> si!==step.setIndex ? s : { ...s, completed: true }) });
      const nxt = nextGuidedStep(afterBlocks);
      if(nxt && blocks[nxt.blockIndex]?.exerciseId === block.exerciseId){
        const ns = blocks[nxt.blockIndex].sets[nxt.setIndex];
        const carry = {};
        if(ns && String(ns.reps ?? '').trim()==='' && String(set.reps ?? '').trim()!=='') carry.reps = set.reps;
        if(ns && String(ns.weightKg ?? '').trim()==='' && String(set.weightKg ?? '').trim()!=='') carry.weightKg = set.weightKg;
        if(Object.keys(carry).length) updateSet(nxt.blockIndex, nxt.setIndex, carry);
      }
      const now=Date.now();
      try {
        recordEvent('complete-set', {
          sessionId: session.id,
          exerciseId: block.exerciseId,
          setIndex: step.setIndex,
          // Stable set identity (value-free id) so a re-completed step nets
          // against its completion instead of counting as a second set.
          ...(set?.setId ? { setId: set.setId } : {}),
          mode: 'guided',
          elapsedMs: Math.max(0, now - Date.parse(lastStepAtRef.current)),
          sessionElapsedMs: Math.max(0, now - Date.parse(startedAtRef.current)),
        });
      } catch {}
      lastStepAtRef.current = new Date(now).toISOString();
    }
    if(!skipped && block.restSec && nextGuidedStep(blocks)) startRest(restPresetFor(gymPrefs, block.exerciseId, block.restSec) || block.restSec, EXERCISE_BY_ID[block.exerciseId]?.name || block.exerciseId, block.exerciseId);
    haptic(skipped ? 'failedSet' : 'restComplete');
  };

  const toggleNoteTag=(id)=> setNoteTags(prev=> prev.includes(id) ? prev.filter(x=>x!==id) : [...prev,id]);

  const finish = ()=>{
    if(progress.pending > 0 && !window.confirm(`${progress.pending} set${progress.pending===1?'':'s'} not done yet. Save anyway? Unfinished sets are logged as skipped.`)) return;
    const labels=noteTags.map(id=> NOTE_PROMPTS.find(t=> t.id===id)?.label).filter(Boolean);
    const finalNote=[labels.join(', '), note.trim()].filter(Boolean).join(' · ');
    const payload = buildGuidedPayload({
      session,
      blocks,
      note: finalNote,
      noteTags,
      startedAtISO: startedAtRef.current,
      availableEquipment,
    });
    // buildGuidedPayload already carries the snapshot frozen at init (the
    // schedule row the guided runner walked). Save copies it unchanged — it
    // never rebuilds a prescription here.
    onSave(payload);
  };

  const canFinish = progress.completed > 0 || progress.skipped > 0;

  // All steps resolved → celebration screen before finishing.
  useEffect(()=>{
    if(progress.total > 0 && progress.pending === 0 && !celebrate) setCelebrate(true);
  }, [progress.total, progress.pending, celebrate]);

  return (
    <div ref={rootRef} onKeyDown={trapTab} className="fixed inset-0 z-40 bg-bg flex flex-col" role="dialog" aria-modal="true" aria-label={`Guided session — ${session.title}`}>
      <span className="sr-only" role="status" aria-live="polite">
        {/* Never interpolate the running countdown here — a per-second value in
            a live region queues every tick on screen readers. Rest progress is
            conveyed by the minute-mark announcer instead; this region carries
            step changes and completion. */}
        {announcement || (restLeft!==null ? `Rest started, ${restLabel || 'next exercise'} is next.` : step ? `Step ${progress.completed + progress.skipped + 1} of ${progress.total}: ${currentExercise?.name || currentBlock?.exerciseId}, set ${step.setIndex + 1}.` : 'All sets resolved. Ready to save.')}
      </span>

      {/* Header: session identity + live elapsed timer + overall progress bar */}
      <div className="relative shrink-0 flex items-center gap-3 px-4 py-3 border-b border-line bg-surface">
        <button ref={closeRef} onClick={onCancel} className="w-11 h-11 grid place-items-center rounded-full border border-line bg-surface2" aria-label="Close guided session">✕</button>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">Guided session</p>
          <p className="font-bold truncate">{session.title} • {session.dateISO}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button onClick={toggleSound} aria-pressed={soundOn} aria-label={soundOn ? 'Sound cues on' : 'Sound cues off'} title={soundOn ? 'Sound cues on' : 'Sound cues off'} className={`min-h-11 min-w-11 px-1.5 grid place-items-center rounded-full border text-sm leading-none ${soundOn ? 'border-ink bg-ink text-bg' : 'border-line bg-surface2 text-ink3'}`}>{soundOn ? '🔊' : '🔇'}</button>
          {voiceSupported() && (
            <button onClick={toggleVoice} aria-pressed={voiceOn} aria-label={voiceOn ? 'Voice coach on' : 'Voice coach off'} title={voiceOn ? 'Voice coach on' : 'Voice coach off'} className={`min-h-11 min-w-11 px-1.5 grid place-items-center rounded-full border text-sm leading-none ${voiceOn ? 'border-ink bg-ink text-bg' : 'border-line bg-surface2 text-ink3'}`}>🗣️</button>
          )}
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-surface2 border border-line tabular-nums" aria-label={`Elapsed time ${formatElapsed(elapsed)}`}>⏱ {formatElapsed(elapsed)}</span>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-surface2 border border-line tabular-nums">{progress.completed + progress.skipped}/{progress.total} sets • {fmtWeight(volume, unit)} volume</span>
          {pace && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-surface2 border border-line tabular-nums" aria-label={paceLabel} title={paceLabel}>🏁 ≈{pace.remainingMin} min</span>
          )}
        </div>
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-surface2">
          <div className="h-full bg-success bar-anim" style={{ width: `${progress.pct}%` }} />
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 pt-5 pb-6 max-w-3xl w-full mx-auto">
        {celebrate || !step ? (
          <section className="rounded-3xl border border-success/30 bg-successsoft p-6 space-y-4 text-center" aria-label="Workout complete">
            <p className="text-5xl" aria-hidden>🎉</p>
            <p className="text-xl font-black">Workout complete</p>
            <p className="text-sm text-ink2 tabular-nums">
              {progress.completed}/{progress.total} sets • {fmtWeight(volume, unit)} volume • {formatElapsed(elapsed)}
            </p>
            <section className="rounded-2xl border border-line bg-surface p-3 space-y-2 text-left">
              <p className="text-xs font-semibold">Session notes</p>
              <div className="flex flex-wrap gap-1.5">
                {NOTE_PROMPTS.map(prompt=> (
                  <button key={prompt.id} onClick={()=> toggleNoteTag(prompt.id)} aria-pressed={noteTags.includes(prompt.id)} className={`text-xs font-semibold px-2.5 py-1.5 rounded-full border ${noteTags.includes(prompt.id)?'bg-ink text-bg border-ink':'bg-surface2 border-line'}`}>{prompt.label}</button>
                ))}
              </div>
              <textarea value={note} onChange={e=> setNote(e.target.value)} rows={2} placeholder="How did it go? Sleep, pain, technique, ROM, load…" className="w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm" />
            </section>
          </section>
        ) : (
          <>
            {/* Step progress dots */}
            <div className="flex flex-wrap gap-2 justify-center pb-4" aria-hidden>
              {blocks.flatMap((b,bi)=> b.sets.map((s,si)=> (
                <span key={`${bi}-${si}`} className={`w-3.5 h-3.5 rounded-full transition-colors ${s.completed ? 'bg-success' : s.skipped ? 'bg-review' : (step.blockIndex===bi && step.setIndex===si) ? 'bg-ink ring-2 ring-ink/30' : 'bg-surface2 border border-line'}`} />
              )))}
            </div>

            {/* THE current step — one exercise, one set, big and unmissable */}
            <section className="rounded-3xl border border-line bg-surface p-5 space-y-4" aria-label="Current step">
              <div className="flex items-start justify-between gap-3">
                <ExerciseIllustration exerciseId={currentBlock.exerciseId} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">Step {progress.completed + progress.skipped + 1} of {progress.total} · Set {step.setIndex + 1} of {currentBlock.sets.length}</p>
                  <p className="text-xl font-black tracking-tight">{currentExercise?.name || currentBlock.exerciseId}{currentBlock.unilateral ? <span className="text-xs font-semibold text-ink3"> (per side — {currentSet?.side || 'L'} first)</span> : null}</p>
                  <div className="mt-1"><Suspense fallback={null}><TeachingPanel exerciseId={currentBlock.exerciseId} variant="inline" /></Suspense></div>
                  <p className="text-sm text-ink2 mt-1 tabular-nums">
                    <span className="font-black text-ink">{currentSet?.weightKg?.trim() ? fmtWeight(currentSet.weightKg, unit) : (currentExercise?.supportsWeighted ? 'log load' : 'bodyweight')}</span>
                    {' × '}
                    <span className="font-black text-ink">{currentSet?.reps?.trim() || '—'}</span> reps
                    {currentBlock.loadHint ? <span className="text-ink3"> · {localizeWeightText(currentBlock.loadHint, unit)}</span> : null}
                  </p>
                  {currentExercise?.cues?.[0] && <p className="text-[11px] text-ink3 mt-1">Cue: {currentExercise.cues[0]}</p>}
                  {activeArm && activeRec && (
                    <p className="text-[11px] text-ink3 mt-1">
                      Study policy — {activeArm === 'double-progression' ? 'double progression' : 'Arise'}: {activeRec.reps ?? '—'} reps{activeRec.load ? ` at ${fmtWeight(activeRec.load, unit)}` : ''}{activeRec.assistKg != null ? ` (assisted ${fmtWeight(activeRec.assistKg, unit)})` : ''}.
                    </p>
                  )}
                  {currentBlock.why && <p className="text-[11px] text-ink3 italic mt-0.5">Prescribed: {currentBlock.why}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px]">Load {unit}
                  <WeightInput type="text" inputMode="decimal" value={currentSet?.weightKg || ''} unit={unit} onChange={v=> updateSet(step.blockIndex, step.setIndex, { weightKg: v })} onFocus={trackFieldFocus} onBlur={(e)=> { if(fieldCommitted(e)){ try{ recordEvent('load-field-commit', { sessionId: session.id, exerciseId: currentBlock.exerciseId, setIndex: step.setIndex, mode: 'guided' }); }catch{} } }} placeholder={currentExercise?.supportsWeighted ? (unit === 'lb' ? '50' : '22') : 'bw'} aria-label={`Load in ${unit === 'lb' ? 'pounds' : 'kilograms'}`} className="mt-1 w-full rounded-xl border border-line bg-surface2 px-2 py-3 text-2xl font-black tabular-nums text-center" />
                </label>
                <label className="text-[11px]">Reps
                  <input type="number" min="0" step="1" inputMode="numeric" value={currentSet?.reps || ''} onChange={e=> updateSet(step.blockIndex, step.setIndex, { reps: e.target.value })} onFocus={trackFieldFocus} onBlur={(e)=> { if(fieldCommitted(e)){ try{ recordEvent('reps-field-commit', { sessionId: session.id, exerciseId: currentBlock.exerciseId, setIndex: step.setIndex, mode: 'guided' }); }catch{} } }} placeholder="9" aria-label="Reps" className="mt-1 w-full rounded-xl border border-line bg-surface2 px-2 py-3 text-2xl font-black tabular-nums text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                </label>
              </div>
              {currentBlock.unilateral && (
                <div className="flex gap-1.5" role="group" aria-label="Side">
                  {['L','R'].map(side=> (
                    <button key={side} onClick={()=> updateSet(step.blockIndex, step.setIndex, { side })} aria-pressed={(currentSet?.side||'L')===side} className={`min-h-9 px-4 rounded-full border text-xs font-bold ${(currentSet?.side||'L')===side ? 'bg-ink text-bg border-ink' : 'bg-surface2 border-line'}`}>{side}</button>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={()=> completeStep(false)} className="btn btn-primary flex-1 min-h-14 rounded-xl text-base">Done — next</button>
                <button onClick={()=> completeStep(true)} className="btn btn-secondary min-h-14 rounded-xl px-4">Skip</button>
              </div>
            </section>

            {/* Upcoming steps preview */}
            <details className="mt-4 rounded-2xl border border-line bg-surface px-3 py-2">
              <summary className="text-xs font-bold cursor-pointer">Up next ({progress.pending - 1} after this)</summary>
              <ul className="mt-2 space-y-1">
                {blocks.flatMap((b,bi)=> b.sets.map((s,si)=> ({ b, bi, s, si })))
                  .filter(item=> !item.s.completed && !item.s.skipped && !(item.bi===step.blockIndex && item.si===step.setIndex))
                  .slice(0, 6)
                  .map(item=> (
                    <li key={`${item.bi}-${item.si}`} className="text-[11px] text-ink3 flex gap-2">
                      <span className="tabular-nums w-12 shrink-0">{item.b.sets.length ? `${item.si+1}×` : ''}</span>
                      <span className="truncate">{EXERCISE_BY_ID[item.b.exerciseId]?.name || item.b.exerciseId} · {item.s.reps || '—'} reps{item.s.weightKg ? ` @ ${fmtWeight(item.s.weightKg, unit)}` : ''}</span>
                    </li>
                  ))}
              </ul>
            </details>
          </>
        )}
      </div>

      {/* Rest countdown + finish action live outside the scroll area */}
      <div className="shrink-0 border-t border-line bg-surface px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] space-y-2">
        <div className="max-w-3xl w-full mx-auto space-y-2">
          {restLeft!==null && (
            <RestDock
              endsAt={restEndsAt}
              clock={clock}
              label={restLabel}
              onChange={setRestEndsAt}
              exerciseId={restExerciseId}
              exerciseName={restExerciseId ? EXERCISE_BY_ID[restExerciseId]?.name || restExerciseId : ''}
              presetSeconds={restPresetFor(gymPrefs, restExerciseId, null)}
              gymPrefs={gymPrefs}
              onSetRestPreset={onSetRestPreset}
              voiceRate={voiceRate}
            />
          )}
          <div className="flex gap-2">
            <button onClick={onCancel} className="btn btn-secondary min-h-11 rounded-xl px-4">Cancel</button>
            <button onClick={finish} disabled={!canFinish} className="btn btn-primary flex-1 min-h-11 rounded-xl disabled:opacity-40">Save session</button>
          </div>
        </div>
      </div>
    </div>
  );
}
