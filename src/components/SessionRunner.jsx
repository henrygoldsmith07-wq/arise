import { useEffect, useMemo, useRef, useState } from 'react';
import { EXERCISE_BY_ID } from '../lib/data.js';
import { lastExerciseSets } from '../lib/store.js';
import { recommendNext } from '../lib/progression.js';
import { runComparativeStudy } from '../lib/study.js';
import { recommendNextWithModel } from '../lib/progressionModel.js';
import { formatPlateStack } from '../lib/plates.js';
import { substitutionOptions } from '../lib/substitutions.js';
import { recordEvent } from '../lib/telemetry.js';
import { recordRecommendation } from '../lib/longitudinal.js';
import ExerciseIllustration from './ExerciseIllustration.jsx';

const NOTE_PROMPTS = [
  { id: 'felt-strong', label: 'Felt strong' },
  { id: 'felt-heavy', label: 'Felt heavy' },
  { id: 'poor-sleep', label: 'Poor sleep' },
  { id: 'short-on-time', label: 'Short on time' },
  { id: 'form-focus', label: 'Form focus' },
  { id: 'pain-discomfort', label: 'Pain / discomfort' },
];

function parseNum(v){ const n=Number(v); return Number.isFinite(n)? n : 0; }
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

function normaliseBlock(block, history, draftBlock){
  const source = draftBlock || block;
  const unilateral = !!source.unilateral || !!EXERCISE_BY_ID[source.exerciseId]?.unilateral;
  const previous = draftBlock ? null : lastExerciseSets(history, source.exerciseId);
  const count = Math.max(1, Number(source.sets) || source.sets?.length || 1);
  const sets = Array.isArray(source.sets)
    ? source.sets.map(s=> ({ ...newSet(source.reps, unilateral), ...s, completed: !!s.completed }))
    : Array.from({ length: count }, (_, i)=> newSet(source.reps, unilateral, previous?.sets?.[i] || previous?.sets?.[previous.sets.length-1]));
  return {
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
  };
}

function suggestedTarget(rec, block){
  const reps = rec?.reps || firstInt(block.reps) || 'working reps';
  if(rec?.assistKg != null) return `${reps} reps @ ${rec.assistKg}kg assist`;
  if(rec?.load != null && rec.load > 0) return `${reps} reps @ ${rec.load}kg`;
  if(block.loadHint) return `${reps} reps @ ${block.loadHint}`;
  return `${reps} reps`;
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

function getRecommendation(block, history, asOfDateISO, plateConfig = null, study = null){
  try{
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
    // achievable increments.
    return recommendNext({ exerciseId:block.exerciseId, history, targetReps:block.reps || '8–12', asOfDateISO, plateConfig });
  }catch{ return null; }
}

function hasUnfinishedSet(blocks, bi, si){
  for(let i=bi;i<blocks.length;i++){
    const start = i===bi ? si+1 : 0;
    if(blocks[i].sets.slice(start).some(s=> !s.completed)) return true;
  }
  return false;
}

export default function SessionRunner({ session, history = [], availableEquipment = [], plateConfig = null, draft = null, measurementConsent = false, preferences = null, onDraftChange, onSave, onCancel }){
  const [blocks,setBlocks]=useState(()=> session.blocks.map((b,i)=> normaliseBlock(b, history, draft?.blocks?.[i])));
  const [note,setNote]=useState(()=> draft?.note || '');
  const [noteTags,setNoteTags]=useState(()=> draft?.noteTags || []);
  const [restEndsAt,setRestEndsAt]=useState(()=> draft?.restEndsAt || null);
  const [restLabel,setRestLabel]=useState(()=> draft?.restLabel || '');
  const [clock,setClock]=useState(()=> Date.now());
  const [swapOpen,setSwapOpen]=useState(null);
  const [discardConfirmOpen,setDiscardConfirmOpen]=useState(false);
  const [restAnnouncement,setRestAnnouncement]=useState('');
  const draftRef=useRef(null);
  const rootRef=useRef(null);
  const closeRef=useRef(null);
  const keepEditingRef=useRef(null);
  const startedAtRef=useRef(draft?.startedAt || new Date().toISOString());
  const lastSetAtRef=useRef(draft?.lastSetAt || startedAtRef.current);
  const shownRecommendationRef=useRef(new Set());
  const dismissedRecommendationRef=useRef(new Set());

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

  // Dialog semantics: move focus in on mount, restore it on unmount.
  useEffect(()=>{
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

  const restLeft = restEndsAt ? Math.max(0, Math.ceil((restEndsAt-clock)/1000)) : null;
  useEffect(()=>{
    if(restEndsAt && restEndsAt <= Date.now()){
      setRestEndsAt(null);
      setRestAnnouncement('Rest complete — next set.');
      try{ navigator.vibrate?.(180); }catch{}
    }
  }, [restEndsAt, clock]);

  // Persist every meaningful interaction. localStorage is synchronous, so the
  // latest set is available even if the page crashes before React unmounts.
  useEffect(()=>{
    const nextDraft = {
      version: 1,
      session,
      blocks,
      note,
      noteTags,
      restEndsAt,
      restLabel,
      startedAt:startedAtRef.current,
      lastSetAt:lastSetAtRef.current,
      updatedAt: new Date().toISOString(),
    };
    draftRef.current = nextDraft;
    onDraftChange?.(nextDraft);
  }, [blocks, note, noteTags, restEndsAt, restLabel, session, onDraftChange]);

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

  useEffect(()=>{
    for(const block of blocks){
      if(shownRecommendationRef.current.has(block.exerciseId)) continue;
      const recommendation=getRecommendation(block,history,session.dateISO,plateConfig,study);
      shownRecommendationRef.current.add(block.exerciseId);
      recordEvent('recommendation:shown', { sessionId:session.id, exerciseId:block.exerciseId, target:suggestedTarget(recommendation,block) });
      // Prospective evaluation record: snapshot the recommendation BEFORE the
      // workout. Consent-gated; stored separately from training history.
      try{
        recordRecommendation({
          exerciseId: block.exerciseId,
          recommendation,
          history,
          dueDateISO: session.dateISO,
          programId: session.programId || null,
          programVersion: session.programVersion ?? null,
          preferences: measurementConsent === true ? { telemetryEnabled: true } : null,
        });
      }catch{}
    }
  }, [blocks, history, session.id, session.dateISO, plateConfig, measurementConsent, study]);

  const startRest=(seconds,label)=>{
    const sec=Number(seconds)||0;
    if(sec<=0){ setRestEndsAt(null); return; }
    setRestLabel(label);
    setRestEndsAt(Date.now() + sec*1000);
    setClock(Date.now());
    // Announce once, politely — the ticking countdown itself must not flood
    // screen readers (a11y baseline: live regions announce without flooding).
    setRestAnnouncement(`Rest started for ${label}: ${fmtRest(sec)}.`);
  };

  // Recommendations and previous-performance lookups scan the full history;
  // compute them once per change instead of once per block per keystroke.
  const blockMeta = useMemo(()=>{
    const recs=new Map(), prevs=new Map();
    for(const b of blocks){
      if(recs.has(b.exerciseId)) continue;
      recs.set(b.exerciseId, getRecommendation(b,history,session.dateISO,plateConfig,study));
      prevs.set(b.exerciseId, lastExerciseSets(history,b.exerciseId));
    }
    return { recs, prevs };
  },[blocks,history,session.dateISO,plateConfig]);

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

  const updateSet = (bi, si, patch)=>{
    if((patch.reps!==undefined || patch.weightKg!==undefined) && !dismissedRecommendationRef.current.has(bi)){
      dismissedRecommendationRef.current.add(bi);
      recordEvent('recommendation:dismissed', { sessionId:session.id, exerciseId:blocks[bi]?.exerciseId, reason:'manual set edit' });
    }
    setBlocks(prev=> prev.map((b,i)=> i!==bi? b : { ...b, sets: b.sets.map((s,j)=> j!==si? s : { ...s, ...patch }) }));
  };
  const completeSet = (bi,si)=>{
    const block=blocks[bi];
    const set=block?.sets?.[si];
    if(!set) return;
    const completing=!set.completed;
    updateSet(bi,si,{ completed: completing });
    if(completing){
      const now=Date.now();
      recordEvent('set:complete', {
        sessionId:session.id,
        exerciseId:block.exerciseId,
        setIndex:si,
        elapsedMs:Math.max(0,now-Date.parse(lastSetAtRef.current)),
        sessionElapsedMs:Math.max(0,now-Date.parse(startedAtRef.current)),
      });
      lastSetAtRef.current=new Date(now).toISOString();
      // Auto-start the rest countdown unless the user turned it off
      // (preferences.autoRest, default on). Manual Start rest stays as override.
      if(preferences?.autoRest !== false && hasUnfinishedSet(blocks,bi,si)) startRest(block.restSec, EXERCISE_BY_ID[block.exerciseId]?.name || block.exerciseId);
    }
  };
  const addSet = (bi)=> setBlocks(prev=> prev.map((b,i)=> i!==bi? b : { ...b, sets: [...b.sets, newSet('', b.unilateral, b.sets[b.sets.length-1])] }));
  const duplicateUnilateral = (bi)=> setBlocks(prev=> prev.map((b,i)=>{
    if(i!==bi || !b.unilateral) return b;
    const last=b.sets[b.sets.length-1]; if(!last) return b;
    return { ...b, sets: [...b.sets, { ...last, side:last.side==='L'?'R':'L', completed:false }] };
  }));
  const removeSet = (bi,si)=> setBlocks(prev=> prev.map((b,i)=> i!==bi? b : { ...b, sets: b.sets.filter((_,j)=> j!==si) }));

  const swapBlock = (bi, option)=>{
    setBlocks(prev=> prev.map((b,i)=>{
      if(i!==bi) return b;
      const prior=lastExerciseSets(history, option.id);
      const unilateral=!!option.unilateral;
      return {
        ...b,
        exerciseId: option.id,
        unilateral,
        warmups: [],
        loadHint: option.supportsWeighted ? 'use a controlled load' : 'bodyweight',
        substitutionFrom: b.substitutionFrom || b.exerciseId,
        substitutionReason: option.reason,
        sets: b.sets.map((s,si)=>{
          if(s.completed) return { ...s, side: unilateral ? (s.side || 'L') : '', completed:true };
          const old=prior?.sets?.[si] || prior?.sets?.[prior.sets.length-1];
          return { ...newSet(b.reps, unilateral, old), completed:false };
        }),
      };
    }));
    setSwapOpen(null);
  };

  const applyRecommendation=(bi,recommendation)=>{
    const block=blocks[bi];
    if(!block || !recommendation) return;
    const target=suggestedTarget(recommendation,block);
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
    recordEvent('recommendation:accepted', { sessionId:session.id, exerciseId:block.exerciseId, target });
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
      blocks: blocks.map((b, index)=> ({
        exerciseId: b.exerciseId,
        exerciseOrder: index,
        ...(b.substitutionFrom ? { substitutionFrom: b.substitutionFrom, substitutionReason: b.substitutionReason } : {}),
        equipment: EXERCISE_BY_ID[b.exerciseId]?.equipment || null,
        sets: b.sets.map(s=>{
          const completed = !!s.completed;
          const skipped = !completed && String(s.reps).trim() !== '';
          const failed = !!s.failed;
          const out={ reps:String(s.reps).trim(), weightKg:String(s.weightKg).trim(), rpe:String(s.rpe).trim(), completed, skipped, failed };
          if(painDiscomfort) out.pain = true;
          if(b.unilateral && s.side) out.side=s.side;
          if(s.rom && String(s.rom).trim()) out.rom=String(s.rom).trim();
          if(s.assistedKg && String(s.assistedKg).trim()) out.assistedKg=String(s.assistedKg).trim();
          if(s.tempo && String(s.tempo).trim()) out.tempo=String(s.tempo).trim();
          return out;
        }),
      })),
      skippedSetsCount: blocks.reduce((n,b)=> n + b.sets.filter(s=> !s.completed).length, 0),
      note: finalNote || undefined,
      noteTags: noteTags.length ? noteTags : undefined,
      sessionDuration: durationMinutes,
    };
    onSave(payload);
  };

  return (
    <div ref={rootRef} onKeyDown={trapTab} className="fixed inset-0 z-40 bg-bg flex flex-col" role="dialog" aria-modal="true" aria-label={`Session — ${session.title}`}>
      <span className="sr-only" role="status" aria-live="polite">{restAnnouncement || `${completedSets} of ${totalSets} sets completed`}</span>
      <div className="relative shrink-0 flex items-center gap-3 px-4 py-3 border-b border-line bg-surface">
        <button ref={closeRef} onClick={onCancel} className="w-11 h-11 grid place-items-center rounded-full border border-line bg-surface2" aria-label="Close session">✕</button>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">{session.mode === 'short' ? 'Short session' : 'Session'}</p>
          <p className="font-bold truncate">{session.title} • {session.dateISO}</p>
        </div>
        <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-surface2 border border-line tabular-nums">{completedSets}/{totalSets} sets • {volume} kg</span>
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-surface2">
          <div className="h-full bg-success bar-anim" style={{ width: `${totalSets ? Math.round(completedSets/totalSets*100) : 0}%` }} />
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 pt-5 pb-6 space-y-4 max-w-3xl w-full mx-auto">
        <div className="rounded-2xl border border-line bg-surface2 px-3 py-2.5 text-xs flex items-center gap-2">
          <span className="text-base" aria-hidden>⚡</span>
          <span><strong>Fast logging:</strong> previous reps and load are prefilled. Edit them directly, then tap <strong>Done</strong> once the set is complete.</span>
        </div>

        {blocks.map((b,bi)=>{
          const ex=EXERCISE_BY_ID[b.exerciseId];
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
            <div key={`${b.exerciseId}-${bi}`} className="rounded-2xl border border-line bg-surface p-3 space-y-3">
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
                      {recommendation?.reason ? <span className="text-ink2">{changeChip ? ` — ${recommendation.reason}` : recommendation.reason}</span> : null}
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
                  {b.restSec ? <button onClick={()=> startRest(b.restSec, ex?.name || b.exerciseId)} className="relative text-xs font-bold px-3 py-1.5 rounded-full border border-line bg-surface2 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']">Start rest</button> : null}
                  <button onClick={()=> setSwapOpen(swapOpen===bi ? null : bi)} aria-expanded={swapOpen===bi} className="relative text-xs font-bold px-3 py-1.5 rounded-full border border-line bg-surface2 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']">Swap</button>
                  <button onClick={()=> addSet(bi)} className="relative min-h-[32px] text-xs font-bold px-3 py-1.5 rounded-full bg-ink text-bg before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']">+ Set</button>
                  {b.unilateral ? <button onClick={()=> duplicateUnilateral(bi)} className="relative text-xs font-bold px-3 py-1.5 rounded-full border border-line bg-surface2 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']">+ other side</button> : null}
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

              <div className="space-y-2">
                <div className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_48px_42px_auto_28px] gap-1.5 text-[10px] font-bold uppercase tracking-widest text-ink3 px-1">
                  <span>#</span><span>Reps</span><span>Load</span><span>RPE</span><span>{b.unilateral?'Side':''}</span><span>Done</span><span></span>
                </div>
                {b.sets.map((s,si)=> (
                  <div key={si} className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_48px_42px_auto_28px] gap-1.5 items-center">
                    <span className={`w-7 h-7 grid place-items-center rounded-full border text-xs font-bold tabular-nums ${s.completed?'bg-success text-bg border-success':'bg-surface2 border-line'}`}>{si+1}</span>
                    <input type="number" min="0" step="1" inputMode="numeric" value={s.reps} onChange={e=> updateSet(bi,si,{reps:e.target.value})} placeholder="8" aria-label={`Reps set ${si+1}`} className="min-w-0 rounded-xl border border-line bg-surface2 px-2 py-2.5 text-sm tabular-nums" />
                    <input type="number" min="0" step="0.5" inputMode="decimal" value={s.weightKg} onChange={e=> updateSet(bi,si,{weightKg:e.target.value})} placeholder={supportsWeighted?'kg':'bodyweight'} aria-label={`Load set ${si+1}`} className="min-w-0 rounded-xl border border-line bg-surface2 px-2 py-2.5 text-sm tabular-nums" />
                    <input type="number" min="1" max="10" step="0.5" inputMode="decimal" value={s.rpe} onChange={e=> updateSet(bi,si,{rpe:e.target.value})} placeholder="—" aria-label={`RPE set ${si+1}`} className="min-w-0 rounded-xl border border-line bg-surface2 px-2 py-2.5 text-sm tabular-nums" />
                    {b.unilateral ? (
                      <select value={s.side||'L'} onChange={e=> updateSet(bi,si,{side:e.target.value})} aria-label={`Side set ${si+1}`} className="min-w-0 rounded-xl border border-line bg-surface2 px-1 py-2.5 text-xs font-bold"><option value="L">L</option><option value="R">R</option></select>
                    ) : <span />}
                    <button onClick={()=> completeSet(bi,si)} aria-pressed={s.completed} className={`min-h-11 px-2 rounded-xl border text-[11px] font-bold whitespace-nowrap ${s.completed?'bg-success text-bg border-success':'bg-surface2 border-line'}`}>Done</button>
                    <button onClick={()=> removeSet(bi,si)} aria-label={`Remove set ${si+1}`} className="relative w-9 h-9 grid place-items-center rounded-full border border-line text-ink3 before:absolute before:-inset-1.5 before:rounded-full before:content-['']">×</button>
                  </div>
                ))}
                {(supportsAssisted || b.unilateral) && b.sets.length>0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {supportsAssisted && <label className="text-[11px]">Assisted kg off (all sets) <input value={b.sets[0]?.assistedKg||''} onChange={e=> { const v=e.target.value; setBlocks(prev=> prev.map((blk,idx)=> idx!==bi?blk:{...blk, sets: blk.sets.map(x=> ({...x, assistedKg:v}))})); }} placeholder="e.g. 10" className="ml-1 rounded-lg border border-line bg-surface2 px-2 py-1 text-xs w-20" /></label>}
                    <label className="text-[11px]">ROM (all sets) <input value={b.sets[0]?.rom||''} onChange={e=> { const v=e.target.value; setBlocks(prev=> prev.map((blk,idx)=> idx!==bi?blk:{...blk, sets: blk.sets.map(x=> ({...x, rom:v}))})); }} placeholder="full / partial" className="ml-1 rounded-lg border border-line bg-surface2 px-2 py-1 text-xs w-24" /></label>
                  </div>
                )}
                {!b.sets.length && <p className="text-xs text-ink3">No sets — add one.</p>}
              </div>
            </div>
          );
        })}

        <section className="rounded-2xl border border-line bg-surface p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold">Session notes</span>
            <span className="text-[11px] text-ink3">Optional, useful for next targets</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {NOTE_PROMPTS.map(prompt=> <button key={prompt.id} onClick={()=> toggleNoteTag(prompt.id)} aria-pressed={noteTags.includes(prompt.id)} className={`text-xs font-semibold px-2.5 py-1.5 rounded-full border ${noteTags.includes(prompt.id)?'bg-ink text-bg border-ink':'bg-surface2 border-line'}`}>{prompt.label}</button>)}
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
            <div className="rounded-2xl bg-ink text-bg px-3 py-2.5 flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest opacity-80 min-w-0 truncate">Rest · {restLabel}</span>
              <div className="ml-auto flex items-center gap-1.5 shrink-0">
                <button onClick={()=> setRestEndsAt(v=> Math.max(Date.now()+5000, (v||Date.now())-15000))} aria-label="Rest 15 seconds less" className="min-h-11 min-w-11 px-2 rounded-full bg-bg/15 text-xs font-bold tabular-nums">−15s</button>
                <span aria-hidden className="text-lg font-black tabular-nums w-14 text-center">{fmtRest(restLeft)}</span>
                <button onClick={()=> setRestEndsAt(v=> (v||Date.now())+30000)} aria-label="Rest 30 seconds more" className="min-h-11 min-w-11 px-2 rounded-full bg-bg/15 text-xs font-bold tabular-nums">+30s</button>
                <button onClick={()=> setRestEndsAt(null)} aria-label="Skip rest" className="min-h-11 px-3 rounded-full bg-bg text-ink text-xs font-bold">Skip</button>
              </div>
            </div>
          )}
          {saveBlocker && <p className="text-xs text-review bg-reviewsoft border border-review/30 rounded-xl px-3 py-2">{saveBlocker}</p>}
          <div className="flex gap-2">
            <button onClick={onCancel} className="btn btn-secondary min-h-11 rounded-xl px-4">Cancel</button>
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
