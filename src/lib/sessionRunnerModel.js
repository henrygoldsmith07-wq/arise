// Deterministic state/payload logic for SessionRunner.
// React owns rendering and side effects; this module owns the pure transitions
// that are easiest to regression-test and most dangerous to duplicate inline.

import { EXERCISE_BY_ID } from './data.js';
import { lastExerciseSets } from './store.js';
import {
  carryPrescription,
  freezePrescriptionBlock,
  removeSetAt,
  userAddedSet,
} from './progression.js';
import { NOTE_PROMPTS } from './sessionNotes.js';
import { fmtWeight, weightInputValue } from './units.ts';

export function parseRunnerNumber(value){
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function rirFromRpe(rpe){
  const text = String(rpe ?? '').trim();
  if(text === '') return '';
  const number = Number(text);
  if(!Number.isFinite(number)) return '';
  return String(Math.max(0, Math.min(10, Math.round((10 - number) * 2) / 2)));
}

export function rpeFromRir(rir){
  const text = String(rir ?? '').trim();
  if(text === '') return '';
  const number = Number(text);
  if(!Number.isFinite(number)) return '';
  return String(Math.max(0, Math.min(10, Math.round((10 - number) * 2) / 2)));
}

export function stepRir(rir, delta){
  const number = Number(rir);
  if(!Number.isFinite(number)) return rir;
  return String(Math.max(0, Math.min(10, Math.round((number + delta) * 2) / 2)));
}

export function formatRest(seconds){
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${remainder}s`;
}

export function firstRep(reps){
  const match = String(reps).match(/\d+/);
  return match ? match[0] : '';
}

export function newRunnerSet(reps, unilateral, previous = null){
  return {
    reps: previous?.reps != null ? String(previous.reps) : firstRep(reps),
    weightKg: previous?.weightKg != null ? String(previous.weightKg) : '',
    rpe: '',
    side: unilateral ? (previous?.side || 'L') : '',
    rom: previous?.rom || '',
    assistedKg: previous?.assistedKg || '',
    tempo: '',
    completed: false,
  };
}

export function normaliseRunnerBlock(block, history, draftBlock, planIndex = 0){
  const source = draftBlock || block;
  const unilateral = !!source.unilateral || !!EXERCISE_BY_ID[source.exerciseId]?.unilateral;
  const previous = draftBlock ? null : lastExerciseSets(history, source.exerciseId);
  const count = Math.max(1, Number(source.sets) || source.sets?.length || 1);
  const sets = Array.isArray(source.sets)
    ? source.sets.map(set=> ({ ...newRunnerSet(source.reps, unilateral), ...set, completed: !!set.completed }))
    : Array.from({ length:count }, (_, index)=> newRunnerSet(
      source.reps,
      unilateral,
      previous?.sets?.[index] || previous?.sets?.[previous.sets.length - 1],
    ));

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
    planIndex: Number.isInteger(source.planIndex) ? source.planIndex : planIndex,
    governedSlots: Array.isArray(source.governedSlots) ? source.governedSlots : null,
    removedSlots: Array.isArray(source.removedSlots) ? source.removedSlots : null,
    prescriptionOverridden: source.prescriptionOverridden === true,
    prescription: source.prescription || null,
    prescriptionHistory: Array.isArray(source.prescriptionHistory) ? source.prescriptionHistory : null,
  });
}

export function clearTargetParts(recommendation, block, unit = 'kg'){
  const reps = recommendation?.reps != null && String(recommendation.reps).trim() !== ''
    ? recommendation.reps
    : (firstRep(block.reps) || null);
  if(recommendation?.assistKg != null) return { text:`${reps ?? '—'} reps @ ${fmtWeight(recommendation.assistKg, unit)} assist` };
  let load = null;
  if(recommendation?.load != null && Number(recommendation.load) > 0) load = fmtWeight(recommendation.load, unit);
  else if(block.loadHint && /\d/.test(String(block.loadHint))) load = block.loadHint;
  const text = [load, reps ? `× ${reps}` : null].filter(Boolean).join(' ');
  return { text:text || 'working set' };
}

export function previousPerformanceSummary(previous, unit = 'kg'){
  if(!previous?.sets?.length) return null;
  const firstWeight = previous.sets.find(set=> set.weightKg != null && String(set.weightKg).trim() !== '')?.weightKg || null;
  const detail = previous.sets
    .map(set=> `${set.reps}${set.side ? ` ${set.side}` : ''}${set.assistedKg ? ` (-${weightInputValue(set.assistedKg, unit)} ${unit})` : ''}`)
    .join(', ');
  const totalReps = previous.sets.reduce((total, set)=> total + parseRunnerNumber(set.reps), 0);
  const bestKg = previous.sets.reduce((best, set)=> Math.max(best, parseRunnerNumber(set.weightKg)), 0);
  const maxReps = previous.sets.reduce((best, set)=> Math.max(best, parseRunnerNumber(set.reps)), 0);
  return {
    summary:firstWeight ? `${fmtWeight(firstWeight, unit)} × ${detail}` : detail,
    totalReps,
    bestKg,
    maxReps,
    dateISO:previous.dateISO,
  };
}

export function transitionChip(recommendation, previousSummary, unit = 'kg'){
  if(!recommendation || !previousSummary) return null;
  const recommendedLoad = Number(recommendation.load) > 0 ? Number(recommendation.load) : null;
  const recommendedReps = recommendation.reps != null && String(recommendation.reps).trim() !== ''
    ? parseRunnerNumber(recommendation.reps)
    : null;
  if(recommendedLoad != null && previousSummary.bestKg > 0){
    if(recommendedLoad > previousSummary.bestKg) return `↑ ${fmtWeight(previousSummary.bestKg, unit)} → ${fmtWeight(recommendedLoad, unit)}`;
    if(recommendedLoad < previousSummary.bestKg) return `↓ ${fmtWeight(previousSummary.bestKg, unit)} → ${fmtWeight(recommendedLoad, unit)}`;
    return `holds ${fmtWeight(recommendedLoad, unit)}`;
  }
  if(recommendedReps != null && previousSummary.maxReps > 0){
    if(recommendedReps > previousSummary.maxReps) return `↑ ${previousSummary.maxReps} → ${recommendedReps} reps`;
    if(recommendedReps < previousSummary.maxReps) return `↓ ${previousSummary.maxReps} → ${recommendedReps} reps`;
    return `holds ${recommendedReps} reps`;
  }
  return null;
}

export function hasUnfinishedSet(blocks, blockIndex, setIndex){
  for(let index = blockIndex; index < blocks.length; index++){
    const start = index === blockIndex ? setIndex + 1 : 0;
    if(blocks[index].sets.slice(start).some(set=> !set.completed)) return true;
  }
  return false;
}

export function patchRunnerSet(blocks, blockIndex, setIndex, patch, { prescriptionOverridden = false } = {}){
  if(!blocks[blockIndex]?.sets?.[setIndex]) return blocks;
  return blocks.map((block, index)=> index !== blockIndex ? block : {
    ...block,
    ...(prescriptionOverridden ? { prescriptionOverridden:true } : {}),
    sets:block.sets.map((set, innerIndex)=> innerIndex !== setIndex ? set : { ...set, ...patch }),
  });
}

export function isManualLoadOverride(value, recommendation){
  const shownLoad = recommendation?.load != null && Number(recommendation.load) > 0 ? Number(recommendation.load) : null;
  if(shownLoad == null) return false;
  const nextWeight = Number(String(value).match(/[\d.]+/)?.[0] ?? value) || 0;
  return Math.abs(nextWeight - shownLoad) > Math.max(0.5, shownLoad * 0.02);
}

export function carryForwardPlan(block, setIndex){
  const set = block?.sets?.[setIndex];
  if(!set) return { nextIndex:-1, carry:{}, rirSuggestion:null };
  const nextIndex = block.sets.findIndex((candidate, index)=>
    index > setIndex
      && !candidate.completed
      && (String(candidate.reps).trim() === '' || String(candidate.weightKg).trim() === '')
  );
  if(nextIndex === -1) return { nextIndex, carry:{}, rirSuggestion:null };
  const next = block.sets[nextIndex];
  const carry = {};
  if(String(next.reps).trim() === '') carry.reps = set.reps;
  if(String(next.weightKg).trim() === '') carry.weightKg = set.weightKg;
  const rirSuggestion = rirFromRpe(next.rpe).trim() === ''
    && !next.completed
    && String(set.rpe ?? '').trim() !== ''
    ? rirFromRpe(set.rpe)
    : null;
  return { nextIndex, carry, rirSuggestion };
}

export function addUserSetToBlock(block, makeId){
  const previous = block.sets[block.sets.length - 1] || null;
  return {
    ...block,
    sets:[...block.sets, userAddedSet(newRunnerSet('', block.unilateral, previous), makeId)],
  };
}

export function duplicateUnilateralSetInBlock(block, makeId){
  if(!block?.unilateral) return block;
  const last = block.sets[block.sets.length - 1];
  if(!last) return block;
  return {
    ...block,
    sets:[...block.sets, userAddedSet({
      ...last,
      side:last.side === 'L' ? 'R' : 'L',
      completed:false,
      failed:false,
      skipped:false,
    }, makeId)],
  };
}

export function removeRunnerSet(block, setIndex){
  return removeSetAt(block, setIndex).block;
}

export function nextActionableBlockIndex(blocks, currentIndex){
  if(!blocks.length) return currentIndex;
  for(let step = 1; step <= blocks.length; step++){
    const next = (currentIndex + step) % blocks.length;
    if(blocks[next]?.sets.some(set=> !set.completed && !set.failed)) return next;
  }
  return currentIndex;
}

export function applyRecommendationToBlock(block, recommendation){
  if(!block || !recommendation) return block;
  return {
    ...block,
    sets:block.sets.map(set=> set.completed ? set : {
      ...set,
      reps:recommendation.reps != null ? String(recommendation.reps) : set.reps,
      weightKg:recommendation.load != null && recommendation.load > 0 ? String(recommendation.load) : set.weightKg,
      assistedKg:recommendation.assistKg != null ? String(recommendation.assistKg) : set.assistedKg,
    }),
  };
}

export function applyAllRecommendations(blocks, recommendations){
  const applied = [];
  const nextBlocks = blocks.map((block, index)=>{
    if(block.sets.some(set=> set.completed || set.failed || String(set.reps).trim() !== '')) return block;
    const recommendation = recommendations.get(block.exerciseId);
    if(!recommendation) return block;
    const hasLoad = recommendation.load != null && recommendation.load > 0;
    const hasReps = recommendation.reps != null && String(recommendation.reps).trim() !== '';
    if(!hasLoad && !hasReps) return block;
    applied.push({ index, exerciseId:block.exerciseId });
    return applyRecommendationToBlock(block, recommendation);
  });
  return { blocks:nextBlocks, applied };
}

export function sessionSaveState(blocks){
  const totalSets = blocks.reduce((total, block)=> total + block.sets.length, 0);
  const completedSets = blocks.reduce((total, block)=> total + block.sets.filter(set=> set.completed).length, 0);
  const canSave = blocks.length > 0
    && blocks.every(block=> block.sets.length > 0 && block.sets.every(set=> String(set.reps).trim() !== ''))
    && completedSets > 0;
  const pendingSets = totalSets - completedSets;
  if(canSave) return { totalSets, completedSets, pendingSets, canSave, blocker:null };
  const missingReps = blocks.reduce((total, block)=> total + block.sets.filter(set=> String(set.reps).trim() === '').length, 0);
  let blocker;
  if(missingReps) blocker = `Enter reps for ${missingReps} remaining set${missingReps === 1 ? '' : 's'}.`;
  else if(pendingSets) blocker = `Tap Done for ${pendingSets} set${pendingSets === 1 ? '' : 's'} you completed — Save logs unfinished sets as skipped.`;
  else blocker = 'Add at least one set to each exercise.';
  return { totalSets, completedSets, pendingSets, canSave, blocker };
}

export function buildSessionHistoryPayload({
  session,
  blocks,
  availableEquipment = [],
  note = '',
  noteTags = [],
  quality = null,
  startedAt,
  nowISO,
}){
  const labels = noteTags.map(id=> NOTE_PROMPTS.find(tag=> tag.id === id)?.label).filter(Boolean);
  const finalNote = [labels.join(', '), String(note).trim()].filter(Boolean).join(' · ');
  const durationMinutes = Math.max(1, Math.round((Date.parse(nowISO) - Date.parse(startedAt)) / 60000));
  const painDiscomfort = noteTags.includes('pain-discomfort');
  const substitutions = blocks
    .filter(block=> block.substitutionFrom)
    .map(block=> ({ from:block.substitutionFrom, to:block.exerciseId, reason:block.substitutionReason }));

  return {
    id:session.id,
    dateISO:session.dateISO,
    programId:session.programId,
    programVersion:session.programVersion || null,
    templateVersion:session.templateVersion || null,
    week:session.week,
    day:session.day,
    title:session.title,
    mode:session.mode || 'standard',
    targetMinutes:session.targetMinutes || null,
    originalDurationMin:session.originalDurationMin || null,
    rescheduledFrom:session.rescheduledFrom || null,
    durationMinutes,
    startedAt,
    finishedAt:nowISO,
    savedAt:nowISO,
    equipmentSnapshot:[...(availableEquipment || [])],
    substitutions:substitutions.length ? substitutions : undefined,
    exerciseOrder:blocks.map(block=> block.exerciseId),
    painDiscomfort,
    blocks:blocks.map((block, index)=> ({
      exerciseId:block.exerciseId,
      exerciseOrder:index,
      ...(block.substitutionFrom ? { substitutionFrom:block.substitutionFrom, substitutionReason:block.substitutionReason } : {}),
      ...(Array.isArray(block.governedSlots) && block.governedSlots.length ? { governedSlots:block.governedSlots } : {}),
      ...(Array.isArray(block.removedSlots) && block.removedSlots.length ? { removedSlots:block.removedSlots } : {}),
      ...(block.prescriptionOverridden ? { prescriptionOverridden:true } : {}),
      ...carryPrescription(block),
      equipment:EXERCISE_BY_ID[block.exerciseId]?.equipment || null,
      sets:block.sets.map(set=>{
        const completed = !!set.completed;
        const skipped = !completed && String(set.reps).trim() !== '';
        const failed = !!set.failed;
        const out = {
          reps:String(set.reps).trim(),
          weightKg:String(set.weightKg).trim(),
          rpe:String(set.rpe).trim(),
          completed,
          skipped,
          failed,
        };
        if(set.setId) out.setId = set.setId;
        if(set.origin) out.origin = set.origin;
        if(Number.isInteger(set.plannedSlot)) out.plannedSlot = set.plannedSlot;
        else if(set.origin === 'user-added') out.plannedSlot = null;
        if(set.governingPrescriptionId) out.governingPrescriptionId = set.governingPrescriptionId;
        else if(set.origin === 'user-added') out.governingPrescriptionId = null;
        if(painDiscomfort) out.pain = true;
        if(block.unilateral && set.side) out.side = set.side;
        if(set.rom && String(set.rom).trim()) out.rom = String(set.rom).trim();
        if(set.assistedKg && String(set.assistedKg).trim()) out.assistedKg = String(set.assistedKg).trim();
        if(set.tempo && String(set.tempo).trim()) out.tempo = String(set.tempo).trim();
        return out;
      }),
    })),
    skippedSetsCount:blocks.reduce((total, block)=> total + block.sets.filter(set=> !set.completed).length, 0),
    note:finalNote || undefined,
    noteTags:noteTags.length ? noteTags : undefined,
    sessionDuration:durationMinutes,
    quality:quality || undefined,
  };
}
