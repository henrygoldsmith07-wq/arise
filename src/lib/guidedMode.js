// guidedMode.js — guided workout mode: one set at a time, step by step.
// Pure logic only (no DOM, no storage) so it stays fully unit-testable. The
// GuidedRunner component consumes this; the save payload matches the standard
// SessionRunner history schema with mode: 'guided'.

import { EXERCISE_BY_ID } from './data.js';
import { lastExerciseSets } from './store.js';

// Kept in sync with SessionRunner's NOTE_PROMPTS (same ids, same labels) so
// guided and standard sessions produce comparable note tags.
export const NOTE_PROMPTS = [
  { id: 'felt-strong', label: 'Felt strong' },
  { id: 'felt-heavy', label: 'Felt heavy' },
  { id: 'poor-sleep', label: 'Poor sleep' },
  { id: 'short-on-time', label: 'Short on time' },
  { id: 'form-focus', label: 'Form focus' },
  { id: 'pain-discomfort', label: 'Pain / discomfort' },
];

function parseNum(v){ const n=Number(v); return Number.isFinite(n)? n : 0; }
function firstInt(reps){ const m=String(reps).match(/\d+/); return m? m[0] : ''; }

export function fmtRest(s){
  const m=Math.floor(s/60); const r=s%60;
  return m? `${m}:${String(r).padStart(2,'0')}` : `${r}s`;
}

export function newGuidedSet(reps, unilateral, previous = null){
  return {
    reps: previous?.reps != null ? String(previous.reps) : firstInt(reps),
    weightKg: previous?.weightKg != null ? String(previous.weightKg) : '',
    rpe: '',
    side: unilateral ? (previous?.side || 'L') : '',
    rom: previous?.rom || '',
    assistedKg: previous?.assistedKg || '',
    tempo: '',
    completed: false,
    skipped: false,
  };
}

// Flatten a scheduled session into guided blocks. Draft blocks (crash
// recovery) win over fresh initialisation; otherwise sets are prefilled from
// the most recent history for the same exercise, matching SessionRunner.
export function initGuidedBlocks(session, history = [], draftBlocks = null){
  return (session?.blocks || []).map((block, i)=>{
    const source = draftBlocks?.[i] || block;
    const unilateral = !!source.unilateral || !!EXERCISE_BY_ID[source.exerciseId]?.unilateral;
    const previous = draftBlocks ? null : lastExerciseSets(history, source.exerciseId);
    const count = Math.max(1, Number(source.sets) || source.sets?.length || 1);
    const sets = Array.isArray(source.sets)
      ? source.sets.map(s=> ({ ...newGuidedSet(source.reps, unilateral), ...s, completed: !!s.completed }))
      : Array.from({ length: count }, (_, j)=> newGuidedSet(source.reps, unilateral, previous?.sets?.[j] || previous?.sets?.[previous.sets.length-1]));
    return {
      exerciseId: source.exerciseId,
      reps: source.reps || '',
      sets,
      restSec: Number(source.restSec) || 0,
      unilateral,
      loadHint: source.loadHint || '',
      why: source.why || '',
      substitutionFrom: source.substitutionFrom || '',
      substitutionReason: source.substitutionReason || '',
    };
  });
}

// The current step: the first set that is neither completed nor skipped.
export function nextGuidedStep(blocks){
  for(let bi=0; bi<(blocks||[]).length; bi++){
    const sets = blocks[bi]?.sets || [];
    for(let si=0; si<sets.length; si++){
      const s = sets[si];
      if(!s.completed && !s.skipped) return { blockIndex: bi, setIndex: si };
    }
  }
  return null;
}

export function guidedProgress(blocks){
  let total=0, completed=0, skipped=0;
  for(const b of blocks||[]) for(const s of b.sets||[]){
    total++;
    if(s.completed) completed++;
    else if(s.skipped) skipped++;
  }
  const pending = total - completed - skipped;
  const pct = total ? Math.round(((completed + skipped) / total) * 100) : 0;
  return { total, completed, skipped, pending, pct };
}

export function guidedVolumeKg(blocks){
  let total=0;
  for(const b of blocks||[]) for(const s of b.sets||[]){
    if(!s.completed) continue;
    total += parseNum(s.reps) * Math.max(0, parseNum(s.weightKg) - parseNum(s.assistedKg));
  }
  return Math.round(total);
}

export function sessionElapsedMs(startedAtISO, now = Date.now()){
  const start = Date.parse(startedAtISO);
  if(!Number.isFinite(start)) return 0;
  return Math.max(0, now - start);
}

export function formatElapsed(ms){
  const total = Math.max(0, Math.floor(ms/1000));
  const m = Math.floor(total/60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2,'0')}`;
}

// Save payload — identical schema to SessionRunner's, with mode: 'guided'.
export function buildGuidedPayload({ session, blocks, note = '', noteTags = [], startedAtISO, availableEquipment = [] }){
  const nowISO = new Date().toISOString();
  const started = Date.parse(startedAtISO);
  const durationMinutes = Number.isFinite(started) ? Math.max(1, Math.round((Date.parse(nowISO) - started) / 60000)) : 1;
  const painDiscomfort = noteTags.includes('pain-discomfort');
  const substitutions = blocks.filter(b=> b.substitutionFrom).map(b=> ({ from: b.substitutionFrom, to: b.exerciseId, reason: b.substitutionReason }));
  const exerciseOrder = blocks.map(b=> b.exerciseId);
  return {
    id: session.id,
    dateISO: session.dateISO,
    programId: session.programId,
    programVersion: session.programVersion || null,
    templateVersion: session.templateVersion || null,
    week: session.week,
    day: session.day,
    title: session.title,
    mode: 'guided',
    targetMinutes: session.targetMinutes || null,
    originalDurationMin: session.originalDurationMin || null,
    rescheduledFrom: session.rescheduledFrom || null,
    durationMinutes,
    startedAt: startedAtISO,
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
        const skipped = !!s.skipped;
        const out = { reps: String(s.reps||'').trim(), weightKg: String(s.weightKg||'').trim(), rpe: String(s.rpe||'').trim(), completed, skipped, failed: !!s.failed };
        if(painDiscomfort) out.pain = true;
        if(b.unilateral && s.side) out.side = s.side;
        if(s.rom && String(s.rom).trim()) out.rom = String(s.rom).trim();
        if(s.assistedKg && String(s.assistedKg).trim()) out.assistedKg = String(s.assistedKg).trim();
        if(s.tempo && String(s.tempo).trim()) out.tempo = String(s.tempo).trim();
        return out;
      }),
    })),
    skippedSetsCount: blocks.reduce((n,b)=> n + b.sets.filter(s=> !s.completed).length, 0),
    note: note.trim() || undefined,
    noteTags: noteTags.length ? noteTags : undefined,
    sessionDuration: durationMinutes,
  };
}
