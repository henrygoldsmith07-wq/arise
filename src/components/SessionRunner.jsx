import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { EXERCISE_BY_ID } from '../lib/data.js';
import { lastExerciseSets } from '../lib/store.js';
import { buildPrescriptionSnapshot, attachPrescription, carryPrescription, freezePrescriptionBlock, applySwapToBlocks, attributePrescribedSets, userAddedSet, removeSetAt, isSetPerformed, personalCalibrationFromHistory } from '../lib/progression.js';
import { recommendNextWithPolicy, POLICY_ORDER } from '../lib/progressionPolicies.js';
import { runComparativeStudy, doubleProgressionRec } from '../lib/study.js';
import { assignmentFor } from '../lib/studyEnrollment.js';
import { recommendNextWithModel } from '../lib/progressionModel.js';
import { formatPlateStack } from '../lib/plates.js';
import { substitutionOptions } from '../lib/substitutions.js';
import { recordEvent, trackFieldFocus, fieldCommitted } from '../lib/telemetry.js';
import { recordRecommendation, markRecommendationOverride } from '../lib/longitudinal.js';
import { quickJumps, applyQuickJump, skipTo, restPresetFor, visiblePrescriptionIndexes } from '../lib/gymMode.js';
import { SESSION_QUALITY_OPTIONS, sessionQualityLabel } from '../lib/gymMode.js';
import { predictSessionDuration, sessionPace } from '../lib/warmup.js';
import { createWakeLock } from '../lib/wakeLock.js';
import { announce } from '../lib/a11y.js';
import { restStartCue, restCompleteCue } from '../lib/audioCues.js';
import { speak, cancelSpeech } from '../lib/voiceCoach.js';
import { LoadNumpad, RestDock, swipeRowHandlers } from './GymModePanel.jsx';
import ExerciseIllustration from './ExerciseIllustration.jsx';
import StepperButton from './StepperButton.jsx';
import { tracePhase, traceStart, traceEnd } from '../lib/perfTrace.js';
import { haptic } from '../lib/haptics.js';
import { painAftercareFor, techniquePromptFor, maxEffortWarning } from '../lib/safety.js';
import { createVoiceInput, parseSetPhrase } from '../lib/voiceInput.js';

const NOTE_PROMPTS = [
  { id: 'felt-strong', label: 'Felt strong' },
  { id: 'felt-heavy', label: 'Felt heavy' },
  { id: 'poor-sleep', label: 'Poor sleep' },
  { id: 'short-on-time', label: 'Short on time' },
  { id: 'form-focus', label: 'Form focus' },
  { id: 'pain-discomfort', label: 'Pain / discomfort' },
];

function parseNum(v){ const n=Number(v); return Number.isFinite(n)? n : 0; }
// Sets are persisted as RPE (engine + history schema), but logged as RIR:
// "2 RIR" ↔ rpe 8. Blank stays blank.
function rirFromRpe(rpe){ const t=String(rpe ?? '').trim(); if(t==='') return ''; const n=Number(t); if(!Number.isFinite(n)) return ''; return String(Math.max(0, Math.min(10, Math.round((10-n)*2)/2))); }
function rpeFromRir(rir){ const t=String(rir ?? '').trim(); if(t==='') return ''; const n=Number(t); if(!Number.isFinite(n)) return ''; return String(Math.max(0, Math.min(10, Math.round((10-n)*2)/2))); }
// Step a suggested RIR value by whole points, clamped to the 0–10 scale.
// Pure — the suggestion bar adjusts without ever reading entered values.
function stepRir(rir, delta){ const n=Number(rir); if(!Number.isFinite(n)) return rir; return String(Math.max(0, Math.min(10, Math.round((n+delta)*2)/2))); }
function fmtRest(s){ const m=Math.floor(s/60); const r=s%60; return m? `${m}:${String(r).padStart(2,'0')}` : `${r}s`; }
function firstInt(reps){ const m=String(reps).match(/\d+/); return m? m[0] : ''; }

function newSet(reps, unilateral, previous = null){
  return {
    reps: previous?.reps != null ? String(previous.reps) : firstInt(reps),
    weightKg: previous?.weightKg != null ? String(previous.weightKg) : '',
    rpe: '',
    side: unilateral ? (previous?.side || 'L') : '',
    rom: previous?.rom || '',
    assistedKg: previous?.assistedKg || '',
    tempo: '',
    completed: false,
  };
}

function normaliseBlock(block, history, draftBlock, planIndex = 0){
  const source = draftBlock || block;
  const unilateral = !!source.unilateral || !!EXERCISE_BY_ID[source.exerciseId]?.unilateral;
  const previous = draftBlock ? null : lastExerciseSets(history, source.exerciseId);
  const count = Math.max(1, Number(source.sets) || source.sets?.length || 1);
  const sets = Array.isArray(source.sets)
    ? source.sets.map(s=> ({ ...newSet(source.reps, unilateral), ...s, completed: !!s.completed }))
    : Array.from({ length: count }, (_, i)=> newSet(source.reps, unilateral, previous?.sets?.[i] || previous?.sets?.[previous.sets.length-1]));
  return freezePrescriptionBlock({
    exerciseId: source.exerciseId,
    reps: source.reps || '',
    sets,
    restSec: Number(source.restSec) || 0,
    unilateral,
    warmups: source.warmups || [],
    loadHint: source.loadHint || '',
    why: source.why || '',
    substitutionFrom: source.substitutionFrom || '',
    substitutionReason: source.substitutionReason || '',
    // Which scheduled row this block came from. A partial swap inserts a block,
    // so later blocks shift array position — planIndex keeps the first-visible
    // capture pointed at the right prescription of record regardless.
    planIndex: Number.isInteger(source.planIndex) ? source.planIndex : planIndex,
    governedSlots: Array.isArray(source.governedSlots) ? source.governedSlots : null,
    removedSlots: Array.isArray(source.removedSlots) ? source.removedSlots : null,
    prescriptionOverridden: source.prescriptionOverridden === true,
    prescription: source.prescription || null,
    prescriptionHistory: Array.isArray(source.prescriptionHistory) ? source.prescriptionHistory : null,
  });
}

// The ONE clear target shown big on the block: load × reps for this session.
function clearTargetParts(rec, block){
  const reps = rec?.reps != null && String(rec.reps).trim() !== '' ? rec.reps : (firstInt(block.reps) || null);
  if(rec?.assistKg != null) return { text: `${reps ?? '—'} reps @ ${rec.assistKg} kg assist` };
  let load = null;
  if(rec?.load != null && Number(rec.load) > 0) load = `${rec.load} kg`;
  else if(block.loadHint && /\d/.test(String(block.loadHint))) load = block.loadHint;
  const text = [load, reps ? `× ${reps}` : null].filter(Boolean).join(' ');
  return { text: text || 'working set' };
}

// Previous performance, summarised: "22 kg × 10, 9, 8" + total reps for the goal.
function previousSummary(prev){
  if(!prev?.sets?.length) return null;
  const firstW = prev.sets.find(s => s.weightKg != null && String(s.weightKg).trim() !== '')?.weightKg || null;
  const detail = prev.sets.map(s=> `${s.reps}${s.side?` ${s.side}`:''}${s.assistedKg?` (-${s.assistedKg})`:''}`).join(', ');
  const totalReps = prev.sets.reduce((n, s)=> n + parseNum(s.reps), 0);
  const bestKg = prev.sets.reduce((n, s)=> Math.max(n, parseNum(s.weightKg)), 0);
  const maxReps = prev.sets.reduce((n, s)=> Math.max(n, parseNum(s.reps)), 0);
  return { summary: firstW ? `${firstW} kg × ${detail}` : detail, totalReps, bestKg, maxReps, dateISO: prev.dateISO };
}

// What changed vs last time — the arrow chip above the engine's explanation.
function transitionChip(rec, prevSummary){
  if(!rec || !prevSummary) return null;
  const recLoad = Number(rec.load) > 0 ? Number(rec.load) : null;
  const recReps = rec.reps != null && String(rec.reps).trim() !== '' ? parseNum(rec.reps) : null;
  if(recLoad != null && prevSummary.bestKg > 0){
    if(recLoad > prevSummary.bestKg) return `↑ ${prevSummary.bestKg} → ${recLoad} kg`;
    if(recLoad < prevSummary.bestKg) return `↓ ${prevSummary.bestKg} → ${recLoad} kg`;
    return `holds ${recLoad} kg`;
  }
  if(recReps != null && prevSummary.maxReps > 0){
    if(recReps > prevSummary.maxReps) return `↑ ${prevSummary.maxReps} → ${recReps} reps`;
    if(recReps < prevSummary.maxReps) return `↓ ${prevSummary.maxReps} → ${recReps} reps`;
    return `holds ${recReps} reps`;
  }
  return null;
}

function getRecommendation(block, history, asOfDateISO, plateConfig = null, study = null, assignedArm = null, policy = 'standard', explanationMode = 'standard'){
  try{
    // ── Randomised trial enforcement ──
    // A double-progression assignment IS the treatment: the product displays
    // and logs the DP prescription. Arise never runs for that exercise, so
    // the comparison is between policies actually followed.
    if(assignedArm === 'double-progression'){
      const visible = history.filter(h=> String(h?.dateISO || '') <= String(asOfDateISO || '9999'));
      const rec = doubleProgressionRec({ history: visible, exerciseId: block.exerciseId, targetReps: block.reps || '8–12' });
      return {
        load: rec.load ?? null,
        reps: rec.reps,
        assistKg: null,
        reason: 'Study policy — double progression (randomised).',
        __studyArm: 'double-progression',
      };
    }
    // Evidence-gated model: recommendNextWithModel derives the progression
    // model from history + study; capabilities stay inert unless their sample
    // gates AND a proven baseline weakness open them. Falls back to the plain
    // engine on any error.
    if(study){
      const modelled = recommendNextWithModel({ exerciseId:block.exerciseId, history, targetReps:block.reps || '8–12', asOfDateISO, plateConfig, study });
      if(modelled) return modelled;
    }
    // plateConfig is safe for every equipment type: the engine dispatches
    // barbells through plates and dumbbells/machines through their own
    // achievable increments. The policy layer wraps the modelled/plain engine
    // with the user's chosen policy, confidence scoring and explanations.
    // A conservative personal stance is learned from this lifter's OWN logged
    // history (frozen prescription snapshots), never the evaluation ledger.
    const personalCalibration = personalCalibrationFromHistory(history, { exerciseId: block.exerciseId, asOfDateISO });
    return recommendNextWithPolicy({ exerciseId:block.exerciseId, history, targetReps:block.reps || '8–12', asOfDateISO, plateConfig, study, policy, personalCalibration: personalCalibration.active ? personalCalibration : null });
  }catch{ return null; }
}

function hasUnfinishedSet(blocks, bi, si){
  for(let i=bi;i<blocks.length;i++){
    const start = i===bi ? si+1 : 0;
    if(blocks[i].sets.slice(start).some(s=> !s.completed)) return true;
  }
  return false;
}

export default function SessionRunner({ session, history = [], availableEquipment = [], plateConfig = null, draft = null, measurementConsent = false, preferences = null, appPrefs = null, gymPrefs = null, onSetRestPreset = null, studyEnrollment = null, participantId = null, onDraftChange, onSave, onCancel }){
  const [blocks,setBlocks]=useState(()=> session.blocks.map((b,i)=> normaliseBlock(b, history, draft?.blocks?.[i], i)));
  // Transient confirmation for the one-tap "apply all" fast-log path.
  const [applyAllNote,setApplyAllNote]=useState(null);
  const [note,setNote]=useState(()=> draft?.note || '');
  const [noteTags,setNoteTags]=useState(()=> draft?.noteTags || []);
  const [restEndsAt,setRestEndsAt]=useState(()=> draft?.restEndsAt || null);
  const [restLabel,setRestLabel]=useState(()=> draft?.restLabel || '');
  const [restExerciseId,setRestExerciseId]=useState(()=> draft?.restExerciseId || null);
  const [clock,setClock]=useState(()=> Date.now());
  const [swapOpen,setSwapOpen]=useState(null);
  // RIR suggestion (never a silent observation): { bi, si, value, exerciseId }
  // set when a set completes with a measured RIR and the next row has none.
  // The suggestion writes NOTHING until the user confirms (Same/stepper) or
  // types in the field — Done alone never confirms it.
  const [rirSuggest,setRirSuggest]=useState(null);
  const [discardConfirmOpen,setDiscardConfirmOpen]=useState(false);
  const [restAnnouncement,setRestAnnouncement]=useState('');
  const [qualityRating,setQualityRating]=useState(()=> draft?.quality || null);
  const [skipQuery,setSkipQuery]=useState('');
  // ── Gym Mode state ──
  // gymMode: focus mode (one block at a time). focusIdx drives it and resets
  // whenever the focused block completes. keypadOpen: which set row's load
  // numpad is open (null = closed) — long-press or the field's ✛ opens it.
  // Persisted choice wins (resume), else the More → Gym mode default.
  const [gymMode,setGymMode]=useState(()=> draft?.gymMode != null ? draft.gymMode === true : appPrefs?.focusDefault === true);
  // Mode-entry timing anchor (value-free: session/mode/timestamp only — no
  // loads, reps, RIR, targets or exercise content). Emitted on mount for the
  // starting mode and on every gym toggle, so per-mode first-set timing
  // measures from when THAT mode started, never from workout start. The
  // ref guard collapses StrictMode's dev double-mount into one anchor; a
  // genuine remount (e.g. resume after reload) is a new interval and emits.
  // Like session:start this needs only master telemetry consent — the
  // DERIVED interval additionally requires sessionTimings durations, so
  // nothing timed leaks when that refinement is off.
  const modeEnterEmittedRef=useRef(false);
  useEffect(()=>{
    if(modeEnterEmittedRef.current) return;
    modeEnterEmittedRef.current = true;
    try{ recordEvent('mode:enter', { sessionId: session.id, mode: gymMode ? 'gym' : 'standard' }); }catch{}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  // Voice dictation (hands-free logging): one shared recognizer; the block it
  // targets lives in a ref so results apply to the set being logged.
  const [dictating,setDictating]=useState(null);
  const dictatingRef=useRef(null);
  const voiceCtlRef=useRef(null);
  const blocksRef=useRef(blocks); blocksRef.current = blocks;
  const voiceSupportedInput = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const toggleDictation = (bi)=>{
    if(!voiceSupportedInput) return;
    if(!voiceCtlRef.current){
      voiceCtlRef.current = createVoiceInput({
        onResult: (parsed)=>{
          const target = dictatingRef.current;
          const b = target != null ? blocksRef.current[target] : null;
          if(!b) return;
          if(!parsed){ announce('Could not read that. Say the load, then the reps — for example: sixty for eight.'); return; }
          const si = b.sets.findIndex(x=> !x.completed);
          const idx = si === -1 ? b.sets.length - 1 : si;
          const patch = {};
          if(parsed.weightKg != null) patch.weightKg = String(parsed.weightKg);
          if(parsed.reps != null) patch.reps = String(parsed.reps);
          if(Object.keys(patch).length) updateSet(target, idx, patch);
          announce(`Set ${idx + 1} ${patch.weightKg != null ? `${patch.weightKg} kilograms ` : ''}${patch.reps != null ? `${patch.reps} reps` : ''}`.trim());
        },
        onEnd: ()=> { dictatingRef.current = null; setDictating(null); },
        onError: ()=> { dictatingRef.current = null; setDictating(null); },
      });
    }
    if(dictatingRef.current === bi){ voiceCtlRef.current.stop(); dictatingRef.current = null; setDictating(null); return; }
    dictatingRef.current = bi;
    setDictating(bi);
    voiceCtlRef.current.start();
  };
  const [focusIdx,setFocusIdx]=useState(0);
  const [keypadOpen,setKeypadOpen]=useState(null);
  const wakeLockRef=useRef(null);
  const announcedRestRef=useRef(null);
  const draftRef=useRef(null);
  const rootRef=useRef(null);
  const closeRef=useRef(null);
  const keepEditingRef=useRef(null);
  const startedAtRef=useRef(draft?.startedAt || new Date().toISOString());
  const lastSetAtRef=useRef(draft?.lastSetAt || startedAtRef.current);
  const shownRecommendationRef=useRef(new Set());
  const dismissedRecommendationRef=useRef(new Set());
  // Exercises whose SHOWN prescription the user has since overwritten by hand.
  // Seeded from a restored draft so a reload keeps the flag, and used both to
  // stamp `prescriptionOverridden` on the saved block (history attribution) and
  // to suppress grading/personalisation on that exposure.
  const overrideRef=useRef(new Set((draft?.blocks || []).filter(b=> b?.prescriptionOverridden).map(b=> b.exerciseId)));
  // Stable per-set ids, unique within this runner instance and across reloads
  // (restored sets keep their own id; new ones use a fresh timestamp base).
  const setSeqRef=useRef(0);
  const makeSetId=()=> `${session.id}:set:${Date.now().toString(36)}:${(setSeqRef.current++).toString(36)}`;
  // When the substitution sheet was opened (for swap-time measurement). Stamp
  // on open; read + clear on commit. A commit without a stamp is still logged
  // (elapsedMs omitted) so the swap itself is never lost to a race.
  const swapOpenedAtRef=useRef(null);
  // Post-swap resume target: the REPLACEMENT block's index in the committed
  // array. A partial swap splits bi into [performed-original, replacement],
  // so resuming by the old index would focus the finished original block.
  // Resolved from the committed array by the swap's own stamp, never by
  // assuming the replacement landed at bi or bi+1.
  const swapResumeRef=useRef(null);
  // Load-keypad baseline: the keypad edits per keystroke without blur, so the
  // commit is measured at close against the value at open — still value-free.
  const keypadBaselineRef=useRef(null);
  // Load-keypad commit: the keypad edits per keystroke with no blur, so the
  // commit is measured at close against the value stashed at open.
  const openKeypad = (bi, si)=>{
    keypadBaselineRef.current = { bi, si, value: String(blocks[bi]?.sets?.[si]?.weightKg ?? '') };
    setKeypadOpen(`${bi}:${si}`);
  };
  const closeKeypad = ()=>{
    const base = keypadBaselineRef.current;
    keypadBaselineRef.current = null;
    setKeypadOpen(null);
    if(!base) return;
    const nowValue = String(blocks[base.bi]?.sets?.[base.si]?.weightKg ?? '');
    if(nowValue !== base.value){
      try{ recordEvent('load-field-commit', { sessionId:session.id, exerciseId:blocks[base.bi]?.exerciseId, setIndex:base.si, mode: gymMode ? 'gym' : 'standard' }); }catch{}
    }
  };

  // Escape dismisses only the topmost layer — a stray Esc must never silently
  // destroy a workout with logged sets (a11y baseline: dialogs confirm before
  // destructive action).
  useEffect(()=>{
    const onKey = (e)=>{
      if(e.key!=='Escape') return;
      if(swapOpen!==null){ setSwapOpen(null); return; }
      if(discardConfirmOpen){ setDiscardConfirmOpen(false); return; }
      const progressed = blocks.some(b=> b.sets.some(s=> s.completed || String(s.reps).trim()!==''));
      if(progressed){ setDiscardConfirmOpen(true); return; }
      onCancel();
    };
    window.addEventListener('keydown', onKey);
    return ()=> window.removeEventListener('keydown', onKey);
  }, [onCancel, swapOpen, discardConfirmOpen, blocks]);

  // Leaving the runner stops any queued speech.
  useEffect(()=> ()=> { try{ cancelSpeech(); }catch{} }, []);

  // Dialog semantics: move focus in on mount, restore it on unmount.
  useEffect(()=>{
    tracePhase('session-runner:open', ()=> {}, 'mount');
    const previous=document.activeElement;
    closeRef.current?.focus();
    return ()=> { try{ previous?.focus?.(); }catch{} };
  },[]);

  // Focus trap: aria-modal promises AT that background content is unreachable;
  // Tab cycling keeps that promise true for keyboard users too.
  const trapTab=(e)=>{
    if(e.key!=='Tab' || !rootRef.current) return;
    const focusables=[...rootRef.current.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter(el=> !el.disabled && el.offsetParent!==null);
    if(!focusables.length) return;
    const first=focusables[0], last=focusables[focusables.length-1];
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
  };
  useEffect(()=>{
    if(discardConfirmOpen) keepEditingRef.current?.focus();
  },[discardConfirmOpen]);

  // Derive remaining time from a wall-clock expiry rather than decrementing a
  // counter. That keeps the timer correct after a refresh, sleep or tab switch.
  useEffect(()=>{
    if(!restEndsAt) return;
    const id=setInterval(()=> setClock(Date.now()), 500);
    return ()=> clearInterval(id);
  }, [restEndsAt]);

  // Gym Mode: keep the screen awake for the whole session. Opt-in preference,
  // always released on unmount; the handle re-acquires across tab switches.
  useEffect(()=>{
    if(appPrefs?.wakeLock !== true) return undefined;
    const lock = createWakeLock();
    wakeLockRef.current = lock;
    lock.acquire();
    return ()=> { wakeLockRef.current = null; lock.release(); };
  }, [appPrefs?.wakeLock]);

  const restLeft = restEndsAt ? Math.max(0, Math.ceil((restEndsAt-clock)/1000)) : null;
  useEffect(()=>{
    if(restEndsAt && restEndsAt <= Date.now()){
      setRestEndsAt(null);
      setRestAnnouncement('Rest complete — next set.');
      announce('Rest complete — next set.', { key: 'rest-timer', spoken: preferences?.voiceCoach === true });
      haptic('restComplete');
      if(appPrefs?.soundCues !== false) restCompleteCue();
    }
  }, [restEndsAt, clock, appPrefs?.soundCues]);

  // Persist every meaningful interaction. localStorage is synchronous, so the
  // latest set is available even if the page crashes before React unmounts.
  useEffect(()=>{
    const nextDraft = {
      version: 1,
      session,
      blocks,
      note,
      noteTags,
      gymMode,
      restEndsAt,
      restLabel,
      restExerciseId,
      startedAt:startedAtRef.current,
      lastSetAt:lastSetAtRef.current,
      quality: qualityRating || undefined,
      updatedAt: new Date().toISOString(),
    };
    draftRef.current = nextDraft;
    onDraftChange?.(nextDraft);
  }, [blocks, note, noteTags, gymMode, restEndsAt, restLabel, restExerciseId, qualityRating, session, onDraftChange]);

  useEffect(()=>{
    const persistOnPageHide=()=>{
      if(draftRef.current) onDraftChange?.({ ...draftRef.current, updatedAt: new Date().toISOString() });
    };
    window.addEventListener('pagehide', persistOnPageHide);
    return ()=> window.removeEventListener('pagehide', persistOnPageHide);
  }, [onDraftChange]);

  // The comparative study runs once per history — it feeds the evidence
  // gates that decide whether any progression-model capability may apply.
  const study = useMemo(()=>{
    try{ return runComparativeStudy(history); }catch{ return null; }
  }, [history]);

  const startRest=(seconds,label,exerciseId=null)=>{
    const sec=Number(seconds)||0;
    if(sec<=0){ setRestEndsAt(null); return; }
    setRestLabel(label);
    setRestExerciseId(exerciseId);
    setRestEndsAt(Date.now() + sec*1000);
    setClock(Date.now());
    // Announce once, politely — the ticking countdown itself must not flood
    // screen readers (a11y baseline: live regions announce without flooding).
    setRestAnnouncement(`Rest started for ${label}: ${fmtRest(sec)}.`);
    if(appPrefs?.soundCues !== false) restStartCue();
    haptic('setComplete');
    if(appPrefs?.voiceCoach === true) speak(`Rest ${fmtRest(sec)} for ${label}.`, Number(appPrefs?.voiceRate) || 1);
  };

  // ── Preferences. Two sources, two jobs: ──
  // appPrefs (store.preferences) owns session-wide behaviour: progression
  // policy, explanation mode, auto-rest, sound cues, voice coach, wake lock.
  // preferences (the onboarding payload) owns programme taste: liked/disliked
  // movements for substitutions.
  // NOTE: policy and explanation mode previously read `preferences` here —
  // the onboarding object — so the More → Training settings never reached
  // standard sessions. Fixed by reading appPrefs.
  const appPolicy = POLICY_ORDER.includes(appPrefs?.progressionPolicy) ? appPrefs.progressionPolicy : 'standard';
  const appExplanationMode = ['simple', 'standard', 'advanced'].includes(appPrefs?.explanationMode) ? appPrefs.explanationMode : 'standard';
  // Gym Mode preference: auto-rest on completion (default on) and audio set
  // cues honour their own switches; gymMode defaults to the persisted opt-in.
  const audioCueOn = appPrefs?.soundCues !== false;

  // Recommendations and previous-performance lookups scan the full history;
  // compute them once per change instead of once per block per keystroke.
  const blockMeta = useMemo(()=>{
    const recs=new Map(), prevs=new Map(), assigned=new Map();
    for(const b of blocks){
      if(recs.has(b.exerciseId)) continue;
      // Randomised trial: the assigned arm decides which policy runs.
      const arm = assignmentFor(studyEnrollment, b.exerciseId);
      assigned.set(b.exerciseId, arm);
      recs.set(b.exerciseId, getRecommendation(b,history,session.dateISO,plateConfig,study,arm, appPolicy, appExplanationMode));
      prevs.set(b.exerciseId, lastExerciseSets(history,b.exerciseId));
    }
    return { recs, prevs, assigned };
  },[blocks,history,session.dateISO,plateConfig,studyEnrollment,appPolicy,appExplanationMode]);

  // Prospective evaluation record: persist the EXACT recommendation the user is
  // shown — the same blockMeta.recs value rendered on screen, carrying its
  // policy, confidence, uncertainty, evidence, study arm and any personal-
  // calibration adjustment — never a recomputed default-policy one. Recorded
  // once per exercise before the workout; consent-gated; stored separately from
  // training history. The ledger therefore always matches what was displayed.
  useEffect(()=>{
    for(const block of blocks){
      if(shownRecommendationRef.current.has(block.exerciseId)) continue;
      const recommendation = blockMeta.recs.get(block.exerciseId) || null;
      if(!recommendation) continue;
      shownRecommendationRef.current.add(block.exerciseId);
      const arm = blockMeta.assigned.get(block.exerciseId);
      recordEvent('recommendation:shown', { sessionId:session.id, exerciseId:block.exerciseId, assignedArm:arm || 'arise' });
      try{
        recordRecommendation({
          exerciseId: block.exerciseId,
          recommendation,
          history,
          dueDateISO: session.dateISO,
          programId: session.programId || null,
          programVersion: session.programVersion ?? null,
          targetReps: block.reps || undefined,
          assignedArm: arm || 'arise',
          participantId,
          preferences: measurementConsent === true ? { telemetryEnabled: true } : null,
        });
      }catch{}
    }
  },[blocks, blockMeta, history, session.id, session.dateISO, session.programId, session.programVersion, measurementConsent, participantId]);

  // First-visible capture. A prescription is frozen only when its block's
  // target is actually PRESENTED — every block in the standard runner (all are
  // on screen), or just the focused block in Gym Mode (later blocks are not
  // rendered yet). It is attached to the block and rides through the draft into
  // the saved history. Created at most once per block identity
  // (attachPrescription is a no-op when that prescriptionId is already there),
  // so set edits, rest timers, refresh and crash recovery cannot re-stamp it,
  // and a later engine/policy change cannot silently rewrite what was shown.
  // Only an explicit supersede (a swap) changes it.
  const visibleBlockIndexes = visiblePrescriptionIndexes({ gymMode, focusIdx, blockCount: blocks.length });
  useEffect(()=>{
    const visible = new Set(visibleBlockIndexes);
    setBlocks(prev=>{
      let changed = false;
      const shownAt = new Date().toISOString();
      const next = prev.map((b, index)=>{
        if(b.prescription || !visible.has(index)) return b;
        const plan = Number.isInteger(b.planIndex) ? b.planIndex : index;
        const planned = session.blocks?.[plan] || {};
        const snapshot = buildPrescriptionSnapshot({
          session,
          block: { ...planned, exerciseId: b.exerciseId, sets: b.sets },
          blockIndex: plan,
          recommendation: blockMeta.recs.get(b.exerciseId) || null,
          shownAt,
          policy: appPolicy,
        });
        if(!snapshot) return b;
        changed = true;
        // Bind each planned slot to this revision with a stable id, then attach
        // the immutable snapshot. Done once (guarded by b.prescription above).
        return attachPrescription(attributePrescribedSets(b, snapshot.prescriptionId, makeSetId), snapshot);
      });
      return changed ? next : prev;
    });
  },[visibleBlockIndexes.join(','), blockMeta, session, appPolicy]);

  // Safety: aftercare after a painful exposure and technique/ROM cues read
  // from the last logged sets of each exercise. One memo for all blocks.
  // The max-effort check derives the target's proximity to failure from the
  // last logged RPE of that exercise (same prescription ≈ same proximity),
  // and only fires when the user opted in (maxEffortWarnings).
  const safetyMeta = useMemo(()=>{
    const aftercare=new Map(), technique=new Map(), maxEffort=new Map();
    for(const b of blocks){
      if(aftercare.has(b.exerciseId)) continue;
      const ac = painAftercareFor(b.exerciseId, history, { today: session.dateISO });
      const tp = techniquePromptFor(b.exerciseId, history);
      if(ac) aftercare.set(b.exerciseId, ac);
      if(tp) technique.set(b.exerciseId, tp);
      if(appPrefs?.maxEffortWarnings === true){
        const prev = lastExerciseSets(history, b.exerciseId);
        const rpes = (prev?.sets || []).map(s => Number(s.rpe)).filter(n => Number.isFinite(n) && n > 0);
        if(rpes.length){
          const targetRir = 10 - Math.max(...rpes);
          const warn = maxEffortWarning(targetRir, { enabled: true });
          if(warn) maxEffort.set(b.exerciseId, warn);
        }
      }
    }
    return { aftercare, technique, maxEffort };
  },[blocks,history,session.dateISO,appPrefs?.maxEffortWarnings]);

  const volume = useMemo(()=>{
    let total=0;
    for(const b of blocks) for(const s of b.sets){
      if(!s.completed) continue;
      total += parseNum(s.reps) * Math.max(0, parseNum(s.weightKg) - parseNum(s.assistedKg));
    }
    return Math.round(total);
  },[blocks]);
  const totalSets = blocks.reduce((n,b)=> n+b.sets.length, 0);
  const completedSets = blocks.reduce((n,b)=> n+b.sets.filter(s=> s.completed).length, 0);
  // Live pace vs the pre-session plan: estimated minutes left and finish time
  // from actual logging speed. Display-only — never telemetered.
  const pace = useMemo(()=>{
    try{
      const plannedMin = predictSessionDuration(blocks.map(b=> ({ sets: b.sets.length, restSec: b.restSec, warmups: b.warmups })));
      return sessionPace({ startedAtMs: Date.parse(startedAtRef.current), nowMs: clock, completedSets, totalSets, plannedMin });
    }catch{ return null; }
  },[blocks, clock, completedSets, totalSets]);
  const paceLabel = pace ? `About ${pace.remainingMin} minutes left, estimated finish ${new Date(pace.etaMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${pace.aheadBehind === 'ahead' ? ', ahead of plan' : pace.aheadBehind === 'behind' ? ', behind plan' : ''}` : null;

  // Gym Mode skip-to: index into the full block list for the first match.
  const skipTarget = useMemo(()=> skipTo(blocks, skipQuery), [blocks, skipQuery]);

  // "Apply all" is offered while at least one block is still un-started and
  // carries a usable engine prescription. Applying fills reps/loads, so the
  // strip retires itself — the confirmation note lives on its own line.
  const applyAllAvailable = useMemo(()=> blocks.some(b=>{
    if(b.sets.some(s=> s.completed || s.failed || String(s.reps).trim() !== '')) return false;
    const r = blockMeta.recs.get(b.exerciseId);
    return Boolean(r && ((r.load != null && r.load > 0) || (r.reps != null && String(r.reps).trim() !== '')));
  }), [blocks, blockMeta]);

  const updateSet = (bi, si, patch, { userEdit = true } = {})=>{
    // Guard against the rare stale-closure path (gesture completion after a
    // reorder): a set row that no longer exists must not resurrect as an edit
    // of the wrong row.
    if(!blocks[bi]?.sets?.[si]) return;
    const exerciseId = blocks[bi].exerciseId;
    if(userEdit && (patch.reps!==undefined || patch.weightKg!==undefined)){
      if(!dismissedRecommendationRef.current.has(bi)){
        dismissedRecommendationRef.current.add(bi);
        recordEvent('recommendation:dismissed', { sessionId:session.id, exerciseId, reason:'manual set edit' });
      }
      // A manual override is specifically replacing the SHOWN load, not merely
      // logging fewer reps against it (that is an honest attempt that may only
      // later grade as too-aggressive). Only a deviating weight marks the
      // prescription overridden so it is excluded from grading + personalising.
      if(patch.weightKg !== undefined){
        const shown = blockMeta.recs.get(exerciseId);
        const shownLoad = shown?.load != null && Number(shown.load) > 0 ? Number(shown.load) : null;
        const nextW = Number(String(patch.weightKg).match(/[\d.]+/)?.[0] ?? patch.weightKg) || 0;
        if(shownLoad != null && Math.abs(nextW - shownLoad) > Math.max(0.5, shownLoad * 0.02)){
          overrideRef.current.add(exerciseId);
          // Policy versioning: the ledger must know this transition was
          // USER-decided, not engine-decided, so studies can separate the two.
          try{ markRecommendationOverride({ exerciseId, dueDateISO: session.dateISO }); }catch{}
        }
      }
    }
    const flagged = overrideRef.current.has(exerciseId);
    setBlocks(prev=> prev.map((b,i)=> i!==bi? b : {
      ...b,
      ...(flagged ? { prescriptionOverridden: true } : {}),
      sets: b.sets.map((s,j)=> j!==si? s : { ...s, ...patch }),
    }));
  };
  // Value-free field commits: one event per committed edit (blur-and-changed),
  // never keystrokes, never entered values — session/exercise/set ids and
  // mode only.
  const logFieldCommit = (kind, exerciseId, setIndex)=>{
    try{ recordEvent(kind, { sessionId:session.id, exerciseId, setIndex, mode: gymMode ? 'gym' : 'standard' }); }catch{}
  };
  const commitProps = (kind, exerciseId, setIndex)=> ({
    onFocus: trackFieldFocus,
    onBlur: (e)=> { if(fieldCommitted(e)) logFieldCommit(kind, exerciseId, setIndex); },
  });
  // Explicit RIR confirmation: writes the suggested (or stepped) value as a
  // genuine user edit. This is the ONLY path by which a suggestion becomes
  // an observation — typing in the field is the other, via the normal
  // onChange. Steppers adjust AND confirm in one tap (the user acted on the
  // value deliberately); Done never calls this.
  const confirmRirSuggestion = (rirValue)=>{
    if(!rirSuggest) return;
    const { bi, si, exerciseId } = rirSuggest;
    const rpe = rpeFromRir(rirValue);
    if(rpe === '') return;
    updateSet(bi, si, { rpe }, { userEdit: true });
    try{ recordEvent('rir-suggestion-confirmed', { sessionId:session.id, exerciseId, setIndex:si, mode: gymMode ? 'gym' : 'standard' }); }catch{}
    setRirSuggest(null);
  };
  const completeSet = (bi,si)=>{
    const block=blocks[bi];
    const set=block?.sets?.[si];
    if(!set) return;
    const completing=!set.completed;
    updateSet(bi,si,{ completed: completing });
    if(completing){
      const now=Date.now();
      recordEvent('complete-set', {
        sessionId:session.id,
        exerciseId:block.exerciseId,
        setIndex:si,
        // Stable set identity (value-free id, never workout content) so
        // friction metrics can tell a re-completed set from a new one.
        ...(set?.setId ? { setId: set.setId } : {}),
        mode: gymMode ? 'gym' : 'standard',
        elapsedMs:Math.max(0,now-Date.parse(lastSetAtRef.current)),
        sessionElapsedMs:Math.max(0,now-Date.parse(startedAtRef.current)),
      });
      lastSetAtRef.current=new Date(now).toISOString();
      if(audioCueOn){ try{ const ctx=new (window.AudioContext||window.webkitAudioContext)(); const o=ctx.createOscillator(); const g=ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.frequency.value=880; g.gain.setValueAtTime(0.08, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.18); o.start(); o.stop(ctx.currentTime+0.2); setTimeout(()=> ctx.close(), 300); }catch{} }
      // Carry-forward: prefill the next unfinished row with what you just did,
      // so between-set logging stays one tap (Done) per set for load and
      // reps — both flagged as non-user edits, exactly as before.
      // RIR is deliberately NOT carried: a carried RIR is a SUGGESTION, not
      // an observation, and silently persisting it would feed unmeasured
      // effort into progression, grading and coaching. Instead the next row
      // gets a one-tap suggestion bar (Same / − / +); only an explicit
      // confirm or a typed edit writes rpe. Done alone never confirms.
      const nextIdx = block.sets.findIndex((s,j)=> j>si && !s.completed && (String(s.reps).trim()==='' || String(s.weightKg).trim()===''));
      if(nextIdx !== -1){
        const carry = {};
        if(String(block.sets[nextIdx].reps).trim()==='') carry.reps = set.reps;
        if(String(block.sets[nextIdx].weightKg).trim()==='') carry.weightKg = set.weightKg;
        if(Object.keys(carry).length) updateSet(bi,nextIdx,carry,{ userEdit: false });
      }
      const nextRpeEmpty = nextIdx !== -1 && rirFromRpe(block.sets[nextIdx].rpe).trim()==='' && !block.sets[nextIdx].completed;
      const suggested = nextRpeEmpty && String(set.rpe ?? '').trim()!=='';
      if(suggested){
        const suggestion = rirFromRpe(set.rpe);
        setRirSuggest({ bi, si: nextIdx, value: suggestion, exerciseId: block.exerciseId });
        try{ recordEvent('rir-suggestion-shown', { sessionId:session.id, exerciseId:block.exerciseId, setIndex:nextIdx, mode: gymMode ? 'gym' : 'standard' }); }catch{}
      }
      // One-thumb flow: the field you edit between sets is the NEXT set's
      // reps — with one exception. When that row is fully prefilled AND just
      // gained an RIR suggestion, there is nothing to type: auto-focusing
      // would pop the keyboard open only for the user to dismiss it before
      // tapping Same + Done. So the keyboard stays down and both actions are
      // one tap away; if the row still needs typing, focus lands as before.
      const nextSet = blocks[bi]?.sets?.findIndex((s,j)=> j>si && !s.completed);
      if(nextSet !== -1 && nextSet != null){
        const target = blocks[bi].sets[nextSet];
        // `blocks` is pre-carry state here: account for the prefill applied
        // above, or a carried row would still read as needing typing.
        const effReps = (nextSet===nextIdx && String(target.reps).trim()==='') ? set.reps : target.reps;
        const effLoad = (nextSet===nextIdx && String(target.weightKg).trim()==='') ? set.weightKg : target.weightKg;
        const needsTyping = String(effReps ?? '').trim()==='' || String(effLoad ?? '').trim()==='';
        const suggestionPending = suggested && nextSet === nextIdx;
        if(needsTyping || !suggestionPending){
          requestAnimationFrame(()=> {
            const el = rootRef.current?.querySelector(`input[aria-label="Reps set ${nextSet + 1}"]`);
            el?.focus({ preventScroll: false });
            el?.select?.();
          });
        }else if(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)){
          document.activeElement.blur();
        }
      }
      // Auto-start the rest countdown unless the user turned it off
      // (preferences.autoRest, default on). Manual Start rest stays as override.
      if(preferences?.autoRest !== false && appPrefs?.autoRest !== false && hasUnfinishedSet(blocks,bi,si)) startRest(restPresetFor(gymPrefs, block.exerciseId, block.restSec) || block.restSec, EXERCISE_BY_ID[block.exerciseId]?.name || block.exerciseId, block.exerciseId);
    }else{
      // Undoing a completion is a correction, recorded as its own fact so
      // friction metrics can count undos without guessing from missing rows.
      // Carries the same stable set identity so the undo nets against the
      // completion instead of looking like a different set.
      try{ recordEvent('undo-set', { sessionId:session.id, exerciseId:block.exerciseId, setIndex:si, ...(block.sets?.[si]?.setId ? { setId: block.sets[si].setId } : {}), mode: gymMode ? 'gym' : 'standard' }); }catch{}
    }
  };
  const addSet = (bi)=>{
    try{ recordEvent('add-set', { sessionId:session.id, exerciseId:blocks[bi]?.exerciseId, mode: gymMode ? 'gym' : 'standard' }); }catch{}
    setBlocks(prev=> prev.map((b,i)=> i!==bi? b : { ...b, sets: [...b.sets, userAddedSet(newSet('', b.unilateral, b.sets[b.sets.length-1]), makeSetId)] }));
  };
  // One-thumb adjustment for the set being logged: reps move in whole reps,
  // clamped at zero. The stepper carries the tap; the input stays typable.
  const adjustReps = (bi, si, delta)=>{
    const current = parseNum(blocks[bi]?.sets?.[si]?.reps);
    updateSet(bi, si, { reps: String(Math.max(0, current + delta)) });
  };
  const duplicateUnilateral = (bi)=>{
    try{ recordEvent('add-set', { sessionId:session.id, exerciseId:blocks[bi]?.exerciseId, mode: gymMode ? 'gym' : 'standard' }); }catch{}
    setBlocks(prev=> prev.map((b,i)=>{
    if(i!==bi || !b.unilateral) return b;
    const last=b.sets[b.sets.length-1]; if(!last) return b;
    return { ...b, sets: [...b.sets, userAddedSet({ ...last, side:last.side==='L'?'R':'L', completed:false, failed:false, skipped:false }, makeSetId)] };
  }));};
  const removeSet = (bi,si)=>{
    const set = blocks[bi]?.sets?.[si];
    if(!set) return;
    // A removed row is a correction too — record which kind vanished so the
    // friction stats can count deletions without inspecting content (which the
    // sanitizer would strip anyway).
    try{ recordEvent('remove-set', { sessionId:session.id, exerciseId:blocks[bi].exerciseId, setIndex:si, kind: set.origin==='user-added' ? 'user-added' : 'prescribed', mode: gymMode ? 'gym' : 'standard' }); }catch{}
    setRirSuggest(null); // row indexes shift — never point a suggestion at the wrong row
    setBlocks(prev=> prev.map((b,i)=> i!==bi? b : removeSetAt(b, si).block));
  };
  // Gym Mode: mark a set failed (attempted, didn't get the reps). Persisted as
  // `failed: true`, which the store already normalises.
  const markFailed = (bi,si)=>{
    if(!blocks[bi]?.sets?.[si]) return;
    updateSet(bi,si,{ failed: true, completed: false });
    try{ recordEvent('set:failed', { sessionId:session.id, exerciseId:blocks[bi].exerciseId, setIndex:si, ...(blocks[bi]?.sets?.[si]?.setId ? { setId: blocks[bi].sets[si].setId } : {}), mode: gymMode ? 'gym' : 'standard' }); }catch{}
    haptic('failedSet');
  };

  // Focus mode navigation: next block with an unfinished set, wrapping once.
  // Returns false when everything is done — the runner then shows all blocks.
  const focusModeNext = ()=>{
    setFocusIdx(idx=>{
      for(let step=1; step<=blocks.length; step++){
        const j = (idx + step) % blocks.length;
        if(blocks[j]?.sets.some(s=> !s.completed && !s.failed)) return j;
      }
      return idx;
    });
  };
  // Reset to the first actionable block whenever focus mode turns on or the
  // focused block finishes (last set completed/failed).
  useEffect(()=>{
    if(!gymMode) return;
    const b = blocks[focusIdx];
    if(!b || b.sets.every(s=> s.completed || s.failed)) focusModeNext();
  }, [gymMode, focusIdx, blocks]);

  const swapBlock = (bi, option)=>{
    const startedChoosing = swapOpenedAtRef.current;
    swapOpenedAtRef.current = null;
    const fromExerciseId = blocks[bi]?.exerciseId || null;
    // Identity stamp for THIS swap: buildBlock freezes substitutedAt from
    // nowISO, so the replacement is findable in the committed array even
    // after a partial split reshuffles indexes. Millisecond precision is
    // unique per human tap; the match also requires the new exercise id.
    const swapNowISO = new Date().toISOString();
    setBlocks(prev=>{
      const target = prev[bi];
      if(!target || !option?.id || option.id === target.exerciseId){ swapResumeRef.current = null; return prev; }
      const plan = Number.isInteger(target.planIndex) ? target.planIndex : bi;
      const recommendation = getRecommendation({ exerciseId: option.id, reps: target.reps || session.blocks?.[plan]?.reps }, history, session.dateISO, plateConfig, study, assignmentFor(studyEnrollment, option.id), appPolicy, appExplanationMode);
      // applySwapToBlocks splits a partially-completed block so done work keeps
      // its original exercise + prescription, or replaces it in place if nothing
      // has been performed yet. Either way the swap stays a single tap.
      const next = applySwapToBlocks({
        blocks: prev,
        index: bi,
        option,
        session,
        recommendation: recommendation || null,
        priorSets: lastExerciseSets(history, option.id)?.sets || [],
        planIndex: plan,
        policy: appPolicy,
        nowISO: swapNowISO,
        newSet,
        makeId: makeSetId,
      });
      const replacementIdx = next.findIndex(b=> b && b.exerciseId === option.id && b.substitutedAt === swapNowISO);
      swapResumeRef.current = replacementIdx !== -1 ? replacementIdx : null;
      return next;
    });
    setSwapOpen(null);
    setRirSuggest(null); // swapped exercise, fresh rows — stale suggestions must not linger
    // Resume inside the REPLACEMENT block (never the old index: a partial
    // split leaves the performed original at bi). Falls back to bi only when
    // no replacement was created (no-op or freeze-only swap). The index is
    // read INSIDE the frame callback: setBlocks updaters run at commit time,
    // so only post-paint is the committed array guaranteed visible.
    requestAnimationFrame(()=>{
      const resumeIdx = swapResumeRef.current;
      swapResumeRef.current = null;
      const focusIdx = Number.isInteger(resumeIdx) ? resumeIdx : bi;
      const container = rootRef.current?.querySelector(`#block-${focusIdx}`);
      container?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      // React keeps input values on the property, not the attribute — read
      // .value so a prefilled-then-cleared field still counts as empty.
      const inputs = [...(container?.querySelectorAll('input[aria-label^="Reps set"]') || [])];
      const target = inputs.find(i=> String(i.value ?? '').trim()==='') || inputs[0];
      target?.focus({ preventScroll: true });
      target?.select?.();
    });
    // Swap time = sheet-open to commit; commit-without-open still logs the swap
    // itself (elapsedMs omitted) so the substitution is never lost to a race.
    try{
      recordEvent('swap-commit', {
        sessionId: session.id,
        from: fromExerciseId,
        to: option?.id || null,
        mode: gymMode ? 'gym' : 'standard',
        ...(startedChoosing != null ? { elapsedMs: Math.max(0, Date.now() - startedChoosing) } : {}),
      });
    }catch{}
  };

  const applyRecommendation=(bi,recommendation)=>{
    const block=blocks[bi];
    if(!block || !recommendation) return;
    setBlocks(prev=> prev.map((b,i)=> i!==bi ? b : {
      ...b,
      sets:b.sets.map(s=> s.completed ? s : {
        ...s,
        reps: recommendation.reps != null ? String(recommendation.reps) : s.reps,
        weightKg: recommendation.load != null && recommendation.load > 0 ? String(recommendation.load) : s.weightKg,
        assistedKg: recommendation.assistKg != null ? String(recommendation.assistKg) : s.assistedKg,
      }),
    }));
    dismissedRecommendationRef.current.add(bi);
    recordEvent('recommendation:accepted', { sessionId:session.id, exerciseId:block.exerciseId, via:'single' });
  };

  // One-tap "apply all": stamp every un-started block with its engine
  // prescription so the <20s logging path is zero extra taps. Deliberately
  // explicit rather than silent prefill — each acceptance still reaches the
  // recommendation ledger (same event shape as the per-block Use button),
  // so acceptance metrics stay honest. Blocks with sets already completed
  // or manually edited keep their values; blocks with no recommendation
  // (bodyweight baselines, insufficient evidence) are left untouched.
  const applyAllRecommendations=()=>{
    let applied=0;
    setBlocks(prev=> prev.map((b,i)=>{
      if(b.sets.some(s=> s.completed || s.failed || String(s.reps).trim()!=='')) return b;
      const recommendation=blockMeta.recs.get(b.exerciseId);
      if(!recommendation) return b;
      const hasTarget = recommendation.load != null && recommendation.load > 0;
      const hasReps = recommendation.reps != null && String(recommendation.reps).trim() !== '';
      if(!hasTarget && !hasReps) return b;
      applied++;
      dismissedRecommendationRef.current.add(i);
      recordEvent('apply-all', { sessionId:session.id, exerciseId:b.exerciseId });
      return {
        ...b,
        sets:b.sets.map(s=> ({
          ...s,
          reps: hasReps ? String(recommendation.reps) : s.reps,
          weightKg: hasTarget ? String(recommendation.load) : s.weightKg,
          assistedKg: recommendation.assistKg != null ? String(recommendation.assistKg) : s.assistedKg,
        })),
      };
    }));
    if(applied>0){
      setApplyAllNote(`Applied to ${applied} exercise${applied===1?'':'s'} — targets are a starting point, adjust freely.`);
      window.setTimeout(()=> setApplyAllNote(null), 6000);
    }
  };

  const toggleNoteTag=(id)=> setNoteTags(prev=> prev.includes(id) ? prev.filter(x=>x!==id) : [...prev,id]);
  const canSave = blocks.length>0 && blocks.every(b=> b.sets.length>0 && b.sets.every(s=> String(s.reps).trim()!=='')) && completedSets > 0;
  const pendingSets = totalSets-completedSets;
  // Name the real blocker: reps missing, sets not marked done, or no sets at
  // all — the old copy always blamed "Done".
  const saveBlocker = (()=>{
    if(canSave) return null;
    const missingReps = blocks.reduce((n,b)=> n + b.sets.filter(s=> String(s.reps).trim()==='').length, 0);
    if(missingReps) return `Enter reps for ${missingReps} remaining set${missingReps===1?'':'s'}.`;
    if(pendingSets) return `Tap Done for ${pendingSets} set${pendingSets===1?'':'s'} you completed — Save logs unfinished sets as skipped.`;
    return 'Add at least one set to each exercise.';
  })();

  const save = ()=>{
    if(!canSave) return;
    tracePhase('session-runner:save', ()=> {}, 'begin');
    const labels=noteTags.map(id=> NOTE_PROMPTS.find(t=> t.id===id)?.label).filter(Boolean);
    const finalNote=[labels.join(', '), note.trim()].filter(Boolean).join(' · ');
    const nowISO = new Date().toISOString();
    const startedAt = startedAtRef.current;
    const durationMinutes = Math.max(1, Math.round((Date.parse(nowISO) - Date.parse(startedAt)) / 60000));
    const painDiscomfort = noteTags.includes('pain-discomfort');
    const substitutions = blocks.filter(b=> b.substitutionFrom).map(b=> ({ from: b.substitutionFrom, to: b.exerciseId, reason: b.substitutionReason }));
    const exerciseOrder = blocks.map(b=> b.exerciseId);
    const payload = {
      id: session.id,
      dateISO: session.dateISO,
      programId: session.programId,
      programVersion: session.programVersion || null,
      templateVersion: session.templateVersion || null,
      week: session.week,
      day: session.day,
      title: session.title,
      mode: session.mode || 'standard',
      targetMinutes: session.targetMinutes || null,
      originalDurationMin: session.originalDurationMin || null,
      rescheduledFrom: session.rescheduledFrom || null,
      durationMinutes,
      startedAt,
      finishedAt: nowISO,
      savedAt: nowISO,
      equipmentSnapshot: [...(availableEquipment || [])],
      substitutions: substitutions.length ? substitutions : undefined,
      exerciseOrder,
      painDiscomfort,
      blocks: blocks.map((b, index)=> {
        // Copy the snapshot frozen when this block's target was shown. The save
        // never re-runs the engine to restamp historical truth.
        return {
          exerciseId: b.exerciseId,
          exerciseOrder: index,
          ...(b.substitutionFrom ? { substitutionFrom: b.substitutionFrom, substitutionReason: b.substitutionReason } : {}),
          ...(Array.isArray(b.governedSlots) && b.governedSlots.length ? { governedSlots: b.governedSlots } : {}),
          ...(Array.isArray(b.removedSlots) && b.removedSlots.length ? { removedSlots: b.removedSlots } : {}),
          ...(b.prescriptionOverridden ? { prescriptionOverridden: true } : {}),
          ...carryPrescription(b),
          equipment: EXERCISE_BY_ID[b.exerciseId]?.equipment || null,
          sets: b.sets.map(s=>{
            const completed = !!s.completed;
            const skipped = !completed && String(s.reps).trim() !== '';
            const failed = !!s.failed;
            const out={ reps:String(s.reps).trim(), weightKg:String(s.weightKg).trim(), rpe:String(s.rpe).trim(), completed, skipped, failed };
            // Stable identity travels with the set so history never depends on
            // the current array position (plannedSlot, not the index).
            if(s.setId) out.setId = s.setId;
            if(s.origin) out.origin = s.origin;
            if(Number.isInteger(s.plannedSlot)) out.plannedSlot = s.plannedSlot;
            else if(s.origin === 'user-added') out.plannedSlot = null;
            if(s.governingPrescriptionId) out.governingPrescriptionId = s.governingPrescriptionId;
            else if(s.origin === 'user-added') out.governingPrescriptionId = null;
            if(painDiscomfort) out.pain = true;
            if(b.unilateral && s.side) out.side=s.side;
            if(s.rom && String(s.rom).trim()) out.rom=String(s.rom).trim();
            if(s.assistedKg && String(s.assistedKg).trim()) out.assistedKg=String(s.assistedKg).trim();
            if(s.tempo && String(s.tempo).trim()) out.tempo=String(s.tempo).trim();
            return out;
          }),
        };
      }),
      skippedSetsCount: blocks.reduce((n,b)=> n + b.sets.filter(s=> !s.completed).length, 0),
      note: finalNote || undefined,
      noteTags: noteTags.length ? noteTags : undefined,
      sessionDuration: durationMinutes,
      quality: qualityRating || undefined,
    };
    traceEnd('session-runner:save', 'payload built');
    onSave(payload);
  };

  return (
    <div ref={rootRef} onKeyDown={trapTab} className="fixed inset-0 z-40 bg-bg flex flex-col" role="dialog" aria-modal="true" aria-label={`Session — ${session.title}`}>
      <span className="sr-only" role="status" aria-live="polite">{restAnnouncement || `${completedSets} of ${totalSets} sets completed`}</span>
      {/* App-level announcer output lives in App's <LiveAnnouncer/>; this
          span keeps the in-runner completion notice. Rest minute marks are
          routed through the throttled announcer instead of per-second state. */}
      <div className="relative shrink-0 flex items-center gap-3 px-4 py-3 border-b border-line bg-surface">
        <button ref={closeRef} onClick={onCancel} className="w-11 h-11 grid place-items-center rounded-full border border-line bg-surface2" aria-label="Close session">✕</button>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">{session.mode === 'short' ? 'Short session' : 'Session'}</p>
          <p className="font-bold truncate">{session.title} • {session.dateISO}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            onClick={()=> {
              const next = !gymMode;
              setGymMode(next);
              try{ recordEvent('mode:enter', { sessionId: session.id, mode: next ? 'gym' : 'standard' }); }catch{}
            }}
            aria-pressed={gymMode}
            title={gymMode ? 'Gym mode: focus on — one exercise at a time' : 'Gym mode: focus off'}
            className={`min-h-11 min-w-11 grid place-items-center rounded-full border text-base ${gymMode ? 'bg-ink text-bg border-ink' : 'border-line bg-surface2'}`}
          >🏋️</button>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-surface2 border border-line tabular-nums">{completedSets}/{totalSets} sets • {volume} kg</span>
          {pace && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-surface2 border border-line tabular-nums" aria-label={paceLabel} title={paceLabel}>🏁 ≈{pace.remainingMin} min</span>
          )}
        </div>
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-surface2">
          <div className="h-full bg-success bar-anim" style={{ width: `${totalSets ? Math.round(completedSets/totalSets*100) : 0}%` }} />
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 pt-5 pb-6 space-y-4 max-w-3xl w-full mx-auto">
        {gymMode && (
          <div className="rounded-2xl border border-line bg-surface2 px-3 py-2 flex items-center gap-2">
            <span className="text-base" aria-hidden>🎯</span>
            <span className="text-xs"><strong>Focus mode:</strong> one exercise at a time. Swipe a row right to complete it, left to mark it failed, or long-press it to open the load keypad.</span>
          </div>
        )}

        {!gymMode && (
        <div className="rounded-2xl border border-line bg-surface2 px-3 py-2.5 text-xs flex items-center gap-2">
          <span className="text-base" aria-hidden>⚡</span>
          <span><strong>Fast logging:</strong> previous reps and load are prefilled. Edit them directly, then tap <strong>Done</strong> once the set is complete.</span>
        </div>
        )}

        {/* One-tap engine targets: the <20s logging path — one tap stamps the
            whole session with the prescription, still counted as explicit
            acceptances in the evidence ledger. Hidden once any set is logged. */}
        {applyAllAvailable && (
          <div className="rounded-2xl border border-line bg-surface px-3 py-2 flex items-center gap-2">
            <span className="text-base" aria-hidden>🎯</span>
            <span className="text-xs flex-1 min-w-0"><strong>Engine targets ready</strong> — one tap fills every un-started exercise with this week's prescription.</span>
            <button onClick={applyAllRecommendations} className="btn btn-primary shrink-0 min-h-11 rounded-xl px-3 text-xs font-bold">Apply all</button>
          </div>
        )}
        {applyAllNote && <p role="status" className="text-[11px] font-semibold text-success px-1 -mt-2">✓ {applyAllNote}</p>}

        {gymMode && (
          <div role="search">
            <input
              type="search"
              value={skipQuery}
              onChange={e=> setSkipQuery(e.target.value)}
              placeholder="Skip to exercise…"
              aria-label="Skip to exercise"
              className="w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm"
            />
            {skipQuery && (
              skipTarget ? (
                <button
                  onClick={()=>{ setSkipQuery(''); setFocusIdx(skipTarget.blockIndex); document.getElementById(`block-${skipTarget.blockIndex}`)?.scrollIntoView({ behavior:'smooth', block:'start' }); }}
                  className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2 text-left text-xs hover:border-ink3"
                >
                  Jump to <strong>{EXERCISE_BY_ID[blocks[skipTarget.blockIndex]?.exerciseId]?.name || blocks[skipTarget.blockIndex]?.exerciseId}</strong>
                  {skipTarget.blockIndex !== focusIdx ? ' (next unfinished set highlighted)' : ''}
                </button>
              ) : (
                <p className="mt-1.5 text-[11px] text-ink3 px-1">No exercise in this session matches “{skipQuery}”.</p>
              )
            )}
          </div>
        )}

        {blocks.map((b,bi)=>{
          const ex=EXERCISE_BY_ID[b.exerciseId];
          if(gymMode && bi !== focusIdx) return null;
          const prev=blockMeta.prevs.get(b.exerciseId) || null;
          const supportsWeighted=ex?.supportsWeighted;
          const supportsAssisted=ex?.supportsAssisted;
          const recommendation=blockMeta.recs.get(b.exerciseId) || null;
          const clearTarget = clearTargetParts(recommendation, b);
          const prevSummary = prev ? previousSummary(prev) : null;
          const goalText = prevSummary && prevSummary.totalReps > 0 ? `beat ${prevSummary.totalReps} total reps` : 'set your baseline';
          const changeChip = transitionChip(recommendation, prevSummary);
          // Swap sheet honours the user's liked/disliked movements, and never
          // offers a swap back to the original lift — A→B→A loops would erase
          // the substitution audit trail.
          const swapOrigin = b.substitutionFrom || null;
          const options = swapOpen===bi ? substitutionOptions(b.exerciseId,{
            availableEquipment, history, limit:5,
            preferredExerciseIds: preferences?.preferredExerciseIds || [],
            dislikedExerciseIds: preferences?.dislikedExerciseIds || [],
          }).filter(o=> o.id && o.id!==swapOrigin) : [];
          return (
            <div key={`${b.exerciseId}-${bi}`} id={`block-${bi}`} className={`rounded-2xl border bg-surface p-3 space-y-3 ${gymMode && skipQuery && skipTarget?.blockIndex === bi ? 'border-ink ring-2 ring-ink/30' : 'border-line'}`}>
              <div className="flex items-start justify-between gap-3">
                <ExerciseIllustration exerciseId={b.exerciseId} size="md" />
                <div className="min-w-0">
                  <p className="text-sm font-bold">{ex?.name || b.exerciseId} {b.unilateral ? <span className="text-xs font-semibold text-ink3">(per side — L/R)</span> : null}</p>

                  {/* One clear target */}
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <span className="text-xl font-black tabular-nums leading-none">{clearTarget.text}</span>
                    {recommendation && <button onClick={()=> applyRecommendation(bi,recommendation)} className="relative text-[10px] font-bold underline underline-offset-2 shrink-0 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']">Use</button>}
                  </div>
                  {(changeChip || recommendation?.reason) && (
                    <p className="text-[11px] mt-1 leading-snug">
                      {changeChip && <span className="font-bold text-success">{changeChip}</span>}
                      {recommendation ? <span className="text-ink2">{changeChip ? ' — ' : ''}{recommendation.explanation?.[explanationMode] || recommendation.reason}</span> : null}
                    </p>
                  )}
                  {recommendation?.confidence && (
                    <p className="text-[10px] mt-0.5 text-ink3">
                      Confidence {recommendation.confidence.band} ({Math.round((recommendation.confidence.score || 0) * 100)}%) · uncertainty {recommendation.uncertainty?.label || '—'} · {recommendation.evidence?.sessions ?? 0} logged sessions{recommendation.guard ? ` · ${recommendation.guard} guard active` : ''}
                    </p>
                  )}
                  {safetyMeta.aftercare.get(b.exerciseId) && (
                    <p role="status" className="text-[11px] mt-1 rounded-lg border border-review/40 bg-reviewsoft px-2 py-1.5 text-ink2 leading-snug">
                      ⚠️ {safetyMeta.aftercare.get(b.exerciseId).message}
                    </p>
                  )}
                  {!safetyMeta.aftercare.get(b.exerciseId) && safetyMeta.technique.get(b.exerciseId) && (
                    <p className="text-[11px] mt-1 text-ink3 leading-snug">
                      🎯 {safetyMeta.technique.get(b.exerciseId).message}
                    </p>
                  )}
                  {safetyMeta.maxEffort.get(b.exerciseId) && (
                    <p role="status" className="text-[11px] mt-1 rounded-lg border border-line bg-surface2 px-2 py-1.5 text-ink2 leading-snug">
                      💪 {safetyMeta.maxEffort.get(b.exerciseId).title}. {safetyMeta.maxEffort.get(b.exerciseId).action}
                    </p>
                  )}
                  <p className="text-[11px] text-ink3 mt-1.5">
                    Previous: {prevSummary ? `${prevSummary.summary}` : 'none logged'}
                    {prevSummary ? <span> · {prev.dateISO}</span> : ' — start light and record a baseline'}
                  </p>
                  <p className="text-[11px]"><span className="font-bold text-ink">Goal:</span> {goalText}</p>

                  <details className="mt-1.5">
                    <summary className="text-[11px] text-ink3 cursor-pointer select-none">Details & rationale</summary>
                    <div className="mt-1 space-y-0.5 text-[11px] text-ink3">
                      {ex?.cues?.[0] && <p>Cue: {ex.cues[0]}</p>}
                      {b.warmups?.length ? <p>Warm-ups: {b.warmups.map(w=> `${w.reps}×${w.weightKg||'bw'}${w.note?` (${w.note})`:''}`).join(' • ')}</p> : null}
                      {b.restSec ? <p>Rest {fmtRest(b.restSec)} · load hint: {b.loadHint || '—'}</p> : null}
                      {b.why && <p className="italic">Prescribed: {b.why}</p>}
                      {recommendation?.plateLoad && <p>Plate check · {recommendation.plateLoad.exact ? `${recommendation.plateLoad.loadKg}kg exact` : `${recommendation.plateLoad.targetKg}kg → ${recommendation.plateLoad.loadKg}kg ${recommendation.plateLoad.direction}`} · per side: {formatPlateStack(recommendation.plateLoad.platesPerSide)}</p>}
                      {b.substitutionReason && <p className="italic">Swap rationale: {b.substitutionReason}</p>}
                    </div>
                  </details>
                </div>
                <div className="flex gap-1.5 shrink-0 flex-wrap justify-end max-w-[190px]">
                  {b.restSec ? <button onClick={()=> startRest(restPresetFor(gymPrefs, b.exerciseId, b.restSec) || b.restSec, ex?.name || b.exerciseId, b.exerciseId)} className="relative text-xs font-bold px-3 py-1.5 rounded-full border border-line bg-surface2 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']">Start rest</button> : null}
                  {voiceSupportedInput && (
                    <button onClick={()=> toggleDictation(bi)} aria-pressed={dictating===bi} title="Dictate a set — say the load, then the reps"
                      className={`relative text-xs font-bold px-3 py-1.5 rounded-full border before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] ${dictating===bi ? 'bg-ink text-bg border-ink' : 'border-line bg-surface2'}`}>🎙️</button>
                  )}
                  <button onClick={()=> { if(swapOpen!==bi){ swapOpenedAtRef.current = Date.now(); try{ recordEvent('swap-open', { sessionId:session.id, exerciseId:blocks[bi]?.exerciseId, mode: gymMode ? 'gym' : 'standard' }); }catch{} } setSwapOpen(swapOpen===bi ? null : bi); }} aria-expanded={swapOpen===bi} className="text-xs font-bold px-3 py-1.5 rounded-full border border-line bg-surface2 min-h-11">Swap</button>
                  <button onClick={()=> addSet(bi)} className="text-xs font-bold px-3 py-1.5 rounded-full bg-ink text-bg min-h-11">+ Set</button>
                  {b.unilateral ? <button onClick={()=> duplicateUnilateral(bi)} className="text-xs font-bold px-3 py-1.5 rounded-full border border-line bg-surface2 min-h-11">+ other side</button> : null}
                </div>
              </div>

              {swapOpen===bi && (
                <div className="rounded-xl border border-line bg-surface2 p-2.5 space-y-2" aria-label="Exercise substitutions">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold">Equipment-aware alternatives</p>
                    <button onClick={()=> setSwapOpen(null)} className="text-xs text-ink3 underline">Close</button>
                  </div>
                  <p className="text-[11px] text-ink3">Choose a close movement that matches your kit. Unfinished rows use the alternative’s previous performance when available.</p>
                  {options.length ? options.map(option=> (
                    <button key={option.id} onClick={()=> swapBlock(bi,option)} className="w-full text-left rounded-xl border border-line bg-surface px-3 py-2 flex items-center gap-2 hover:border-ink3">
                      <span className="min-w-0"><span className="block text-xs font-bold truncate">{option.name}</span><span className="block text-[11px] text-ink3 truncate">{option.reason} · {option.equipment.join(', ')}</span></span>
                      <span className="ml-auto text-[10px] font-bold text-ink3 shrink-0">Use</span>
                    </button>
                  )) : <p className="text-xs text-ink3">No matching alternative for the selected kit.</p>}
                </div>
              )}

              <div className="space-y-2.5">
                <div className="grid grid-cols-[26px_minmax(0,1fr)_minmax(0,1fr)] gap-1 text-[10px] font-bold uppercase tracking-widest text-ink3 px-1 sm:hidden" aria-hidden>
                  <span>#</span><span>Load kg</span><span>Reps</span>
                </div>
                <div className="hidden sm:grid grid-cols-[26px_minmax(0,1fr)_minmax(0,1fr)_64px_42px_auto_26px] gap-1.5 text-[10px] font-bold uppercase tracking-widest text-ink3 px-1">
                  <span>#</span><span>Load kg</span><span>Reps</span><span>RIR</span><span>{b.unilateral?'L/R':''}</span><span>Done</span><span></span>
                </div>
                {b.sets.map((s,si)=> {
                  const activeSetIdx = b.sets.findIndex(x=> !x.completed);
                  const isActive = si === activeSetIdx; // the row being logged now
                  // Gym Mode row gestures: right = complete, left = failed,
                  // long-press = load keypad. Buttons/inputs stay exclusive.
                  const gestures = gymMode && !s.completed ? swipeRowHandlers({
                    onComplete: ()=> completeSet(bi,si),
                    onFail: ()=> markFailed(bi,si),
                    onLongPress: ()=> openKeypad(bi,si),
                  }) : null;
                  return (
                  <Fragment key={si}>
                  <div {...(gestures ? { onPointerDown:gestures.onPointerDown, onPointerMove:gestures.onPointerMove, onPointerUp:gestures.onPointerUp, onPointerLeave:gestures.onPointerLeave, onPointerCancel:gestures.onPointerCancel } : {})} style={gestures?.style}
                    className={`grid grid-cols-[26px_minmax(0,1fr)_minmax(0,1fr)] gap-1 sm:grid-cols-[26px_minmax(0,1fr)_minmax(0,1fr)_64px_42px_auto_26px] sm:gap-1.5 items-center rounded-xl ${s.failed ? 'bg-reviewsoft border border-review/30' : ''}`}>
                    <span className={`w-7 h-7 grid place-items-center rounded-full border text-xs font-bold tabular-nums ${s.completed?'bg-success text-bg border-success':s.failed?'bg-review text-bg border-review':'bg-surface2 border-line'}`}>{si+1}</span>
                    <div className="min-w-0 flex items-center gap-1">
                      <input type="number" min="0" step="0.5" inputMode="decimal" value={s.weightKg} onChange={e=> updateSet(bi,si,{weightKg:e.target.value})} {...commitProps('load-field-commit', b.exerciseId, si)} placeholder={supportsWeighted?'22':'bw'} aria-label={`Load set ${si+1} in kilograms`} className={`min-w-0 w-full rounded-xl border border-line bg-surface2 px-2 py-3 text-2xl font-black tabular-nums text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${s.completed?'opacity-60':''}`} />
                      {supportsWeighted && !s.completed && (
                        <button onClick={()=> openKeypad(bi,si)} aria-label={`Open load keypad for set ${si+1}`} title="Load keypad" className="shrink-0 w-11 h-11 grid place-items-center rounded-xl border border-line bg-surface2 text-sm font-black">✛</button>
                      )}
                    </div>
                    {isActive ? (
                      <div className="flex items-center gap-1 min-w-0">
                        <StepperButton label="−" ariaLabel={`Decrease reps set ${si+1}`} onStep={()=> adjustReps(bi,si,-1)} className="min-w-11 px-0" />
                        <input type="number" min="0" step="1" inputMode="numeric" value={s.reps} onChange={e=> updateSet(bi,si,{reps:e.target.value})} {...commitProps('reps-field-commit', b.exerciseId, si)} placeholder="9" aria-label={`Reps set ${si+1}`} className={`min-w-0 flex-1 rounded-xl border border-line bg-surface2 px-1 py-2 text-xl font-black tabular-nums text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${s.completed?'opacity-60':''}`} />
                        <StepperButton label="+" ariaLabel={`Increase reps set ${si+1}`} onStep={()=> adjustReps(bi,si,1)} className="min-w-11 px-0" />
                      </div>
                    ) : (
                    <input type="number" min="0" step="1" inputMode="numeric" value={s.reps} onChange={e=> updateSet(bi,si,{reps:e.target.value})} {...commitProps('reps-field-commit', b.exerciseId, si)} placeholder="9" aria-label={`Reps set ${si+1}`} className={`min-w-0 rounded-xl border border-line bg-surface2 px-2 py-3 text-2xl font-black tabular-nums text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${s.completed?'opacity-60':''}`} />
                    )}
                    {/* Second line on narrow screens (RIR + side + actions); on
                        sm+ this wrapper dissolves (display:contents) so the
                        children join the single 7-column desktop grid in DOM
                        order — desktop layout is pixel-identical. */}
                    <div className="col-span-3 row-start-2 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-1 items-center sm:contents sm:col-auto sm:row-auto">
                    <input type="number" min="0" max="10" step="1" inputMode="numeric" value={rirFromRpe(s.rpe)} onChange={e=> updateSet(bi,si,{rpe:rpeFromRir(e.target.value)})} {...commitProps('rir-field-commit', b.exerciseId, si)} placeholder="—" aria-label={`Reps in reserve set ${si+1}`} className={`min-w-0 rounded-xl border border-line bg-surface2 px-1 py-3 text-2xl font-black tabular-nums text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${s.completed?'opacity-60':''}`} />
                    {b.unilateral ? (
                      <select value={s.side||'L'} onChange={e=> updateSet(bi,si,{side:e.target.value})} aria-label={`Side set ${si+1}`} className="min-w-0 rounded-xl border border-line bg-surface2 px-1 py-3 text-xs font-bold"><option value="L">L</option><option value="R">R</option></select>
                    ) : <span />}
                    <span className="flex items-center gap-1">
                      <button onClick={()=> completeSet(bi,si)} aria-pressed={s.completed} className={`min-h-12 px-2.5 rounded-xl border text-[11px] font-bold whitespace-nowrap ${s.completed?'bg-success text-bg border-success':'bg-surface2 border-line'}`}>{s.completed?'✓':'Done'}</button>
                      {/* Gesture parity: the swipe-left "failed" action and the
                          long-press keypad both exist as buttons, so touch-only
                          gestures never gate an action (WCAG 2.5.6 / 2.1.1). */}
                      {gymMode && !s.completed && (
                        <button
                          onClick={()=> { if(s.failed){ try{ recordEvent('undo-set', { sessionId:session.id, exerciseId:b.exerciseId, setIndex:si, ...(s.setId ? { setId: s.setId } : {}), mode: gymMode ? 'gym' : 'standard' }); }catch{} updateSet(bi,si,{ failed:false }); } else markFailed(bi,si); }}
                          aria-pressed={s.failed}
                          aria-label={s.failed ? `Unmark set ${si+1} failed` : `Mark set ${si+1} failed`}
                          className={`min-h-12 w-9 grid place-items-center rounded-xl border text-[11px] font-bold ${s.failed?'bg-review text-bg border-review':'bg-surface2 border-line'}`}>{s.failed?'↺':'✗'}</button>
                      )}
                      {/* Standard mode gets the same one-tap failure log: a
                          failed attempt stays a failed attempt in history
                          instead of being deleted or faked as completed. */}
                      {!gymMode && !s.completed && (
                        <button
                          onClick={()=> { if(s.failed){ try{ recordEvent('undo-set', { sessionId:session.id, exerciseId:b.exerciseId, setIndex:si, ...(s.setId ? { setId: s.setId } : {}), mode: 'standard' }); }catch{} updateSet(bi,si,{ failed:false }); } else markFailed(bi,si); }}
                          aria-pressed={s.failed}
                          aria-label={s.failed ? `Unmark set ${si+1} failed` : `Mark set ${si+1} failed`}
                          className={`min-h-12 min-w-11 grid place-items-center rounded-xl border text-[11px] font-bold ${s.failed?'bg-review text-bg border-review':'bg-surface2 border-line'}`}>{s.failed?'↺':'✗'}</button>
                      )}
                    </span>
                    {isSetPerformed(s) ? (
                      <span className="w-9 h-9 grid place-items-center text-ink3" title="Already performed — undo it before removing" aria-label={`Set ${si+1} performed`}>·</span>
                    ) : (
                      <button onClick={()=> removeSet(bi,si)} aria-label={`Remove set ${si+1}`} className="relative w-9 h-9 grid place-items-center rounded-full border border-line text-ink3 before:absolute before:-inset-1.5 before:rounded-full before:content-['']">×</button>
                    )}
                    </div>
                  </div>
                  {/* RIR suggestion: the previous set's RIR offered for one-tap
                      confirm — never written until confirmed or typed. Hidden
                      once the row carries any RIR (confirmed, edited) or is
                      done: Done alone must never persist a suggestion. */}
                  {rirSuggest && rirSuggest.bi===bi && rirSuggest.si===si && !s.completed && rirFromRpe(s.rpe).trim()==='' && (
                    <div role="group" aria-label={`Suggested RIR ${rirSuggest.value} for set ${si+1}`} className="flex items-center gap-1.5 rounded-xl border border-dashed border-line bg-surface2 px-2.5 py-1.5 -mt-1">
                      <span className="text-[11px] text-ink3 flex-1 min-w-0">RIR {rirSuggest.value} suggested from last set</span>
                      <button onClick={()=> confirmRirSuggestion(rirSuggest.value)} aria-label={`Use suggested RIR ${rirSuggest.value} for set ${si+1}`} className="min-h-11 px-3 rounded-full bg-ink text-bg text-xs font-bold">Same</button>
                      <button onClick={()=> confirmRirSuggestion(stepRir(rirSuggest.value,-1))} aria-label={`Decrease suggested RIR for set ${si+1}`} className="min-h-11 min-w-11 grid place-items-center rounded-full border border-line bg-surface text-sm font-black">−</button>
                      <span aria-hidden className="text-xs font-black tabular-nums w-6 text-center">{rirSuggest.value}</span>
                      <button onClick={()=> confirmRirSuggestion(stepRir(rirSuggest.value,1))} aria-label={`Increase suggested RIR for set ${si+1}`} className="min-h-11 min-w-11 grid place-items-center rounded-full border border-line bg-surface text-sm font-black">+</button>
                    </div>
                  )}
                  </Fragment>
                  );
                })}
                {(supportsAssisted || b.unilateral) && b.sets.length>0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {supportsAssisted && <label className="text-[11px]">Assisted kg off (all sets) <input value={b.sets[0]?.assistedKg||''} onChange={e=> { const v=e.target.value; setBlocks(prev=> prev.map((blk,idx)=> idx!==bi?blk:{...blk, sets: blk.sets.map(x=> ({...x, assistedKg:v}))})); }} placeholder="e.g. 10" className="ml-1 rounded-lg border border-line bg-surface2 px-2 py-1 text-xs w-20" /></label>}
                    <label className="text-[11px]">ROM (all sets) <input value={b.sets[0]?.rom||''} onChange={e=> { const v=e.target.value; setBlocks(prev=> prev.map((blk,idx)=> idx!==bi?blk:{...blk, sets: blk.sets.map(x=> ({...x, rom:v}))})); }} placeholder="full / partial" className="ml-1 rounded-lg border border-line bg-surface2 px-2 py-1 text-xs w-24" /></label>
                  </div>
                )}
                {!b.sets.length && <p className="text-xs text-ink3">No sets — add one.</p>}
              </div>

              {keypadOpen && keypadOpen.startsWith(`${bi}:`) && (
                <LoadNumpad
                  value={b.sets[Number(keypadOpen.split(':')[1])]?.weightKg || ''}
                  onChange={(v)=> updateSet(bi, Number(keypadOpen.split(':')[1]), { weightKg: v })}
                  onClose={closeKeypad}
                  equipment={ex?.equipment?.[0] || 'barbell'}
                  plateConfig={plateConfig}
                  exerciseName={ex?.name || b.exerciseId}
                />
              )}
            </div>
          );
        })}

        {gymMode && (
          <div className="flex gap-2">
            <button onClick={focusModeNext} className="btn btn-secondary flex-1 min-h-12 rounded-xl">Next exercise →</button>
            {!blocks[focusIdx] || blocks[focusIdx].sets.every(s=> s.completed || s.failed) ? null : (
              <button onClick={()=>{ const act = blocks[focusIdx].sets.findIndex(s=> !s.completed && !s.failed); if(act !== -1) completeSet(focusIdx, act); }} className="btn btn-primary min-h-12 rounded-xl px-4">Complete next set</button>
            )}
          </div>
        )}

        <section className="rounded-2xl border border-line bg-surface p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold">Session notes</span>
            <span className="text-[11px] text-ink3">Optional, useful for next targets</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {NOTE_PROMPTS.map(prompt=> <button key={prompt.id} onClick={()=> toggleNoteTag(prompt.id)} aria-pressed={noteTags.includes(prompt.id)} className={`text-xs font-semibold px-2.5 py-1.5 rounded-full border ${noteTags.includes(prompt.id)?'bg-ink text-bg border-ink':'bg-surface2 border-line'}`}>{prompt.label}</button>)}
          </div>
          <div role="group" aria-label="How did the session feel?" className="flex flex-wrap gap-1.5">
            <span className="text-[11px] text-ink3 self-center mr-1">Session quality:</span>
            {SESSION_QUALITY_OPTIONS.map(opt=> (
              <button key={opt.id} onClick={()=> setQualityRating(q=> q===opt.id ? null : opt.id)} aria-pressed={qualityRating===opt.id}
                className={`text-xs font-semibold px-2.5 py-1.5 rounded-full border ${qualityRating===opt.id?'bg-ink text-bg border-ink':'bg-surface2 border-line'}`}>
                {opt.emoji} {opt.label}
              </button>
            ))}
          </div>
          <textarea value={note} onChange={e=> setNote(e.target.value)} rows={2} placeholder="What should change next time? Mention sleep, pain, technique, ROM, time or load." className="w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm" />
        </section>

      </div>

      {/* Rest countdown and the save action live outside the scroll area: in a
          long session both used to sit below the fold, so finishing a workout
          meant scrolling past every block to find Save. */}
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
              voiceRate={Number(appPrefs?.voiceRate) || 1}
            />
          )}
          {saveBlocker && <p className="text-xs text-review bg-reviewsoft border border-review/30 rounded-xl px-3 py-2">{saveBlocker}</p>}
          <div className="flex gap-2">
            {/* Cancel routes through the in-app discard confirm once any set is
                logged — window.confirm is a jarring dead-end on mobile and the
                dialog below already exists for the Escape path. */}
            <button onClick={()=> blocks.some(b=> b.sets.some(s=> s.completed || String(s.reps).trim()!=='')) ? setDiscardConfirmOpen(true) : onCancel()} className="btn btn-secondary min-h-11 rounded-xl px-4">Cancel</button>
            <button onClick={save} disabled={!canSave} className="btn btn-primary flex-1 min-h-11 rounded-xl disabled:opacity-40">Save session</button>
          </div>
        </div>
      </div>

      {discardConfirmOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-desc">
          <div className="w-full max-w-sm rounded-3xl bg-surface border border-line p-4 space-y-3">
            <p id="discard-title" className="text-base font-bold">Discard this workout?</p>
            <p id="discard-desc" className="text-xs text-ink3">{completedSets}/{totalSets} sets logged. Discarding cannot be undone.</p>
            <div className="flex gap-2">
              <button ref={keepEditingRef} onClick={()=> setDiscardConfirmOpen(false)} className="btn btn-primary flex-1 min-h-11 rounded-xl">Keep editing</button>
              <button onClick={onCancel} className="btn btn-secondary flex-1 min-h-11 rounded-xl text-danger">Discard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
