// templates.js — programme template engine.
// Templates are reusable blueprints (data.js PROGRAM_TEMPLATES) that point at a
// program. This module turns one into a dated, equipment-honest schedule:
// exercises the user's kit can't do are swapped via rankedSubstitutions, and
// template versioning is reported alongside the linked program's changelog.
// Pure + deterministic — offline, no AI.

import { PROGRAM_TEMPLATES, PROGRAM_BY_ID, programHistory, templateHistory, exerciseAvailable, scheduleProgram, EXERCISE_BY_ID } from "./data.js";
import { rankedSubstitutions } from "./substitutions.js";

export function listTemplates(){
  return PROGRAM_TEMPLATES.map(t=> ({
    ...t,
    program: PROGRAM_BY_ID[t.programId] ? {
      name: PROGRAM_BY_ID[t.programId].name,
      level: PROGRAM_BY_ID[t.programId].level,
      daysPerWeek: PROGRAM_BY_ID[t.programId].daysPerWeek,
      version: PROGRAM_BY_ID[t.programId].version || 1,
      weeks: (PROGRAM_BY_ID[t.programId].weeks || []).length,
      mesocycle: PROGRAM_BY_ID[t.programId].mesocycle || null,
    } : null,
  }));
}

export function templateById(templateId){
  return listTemplates().find(t=> t.id===templateId) || null;
}

// Bodyweight moves are always doable (matching availablePrograms' grace) — a
// user selecting "barbell" kit shouldn't be told they can't do a push-up.
function kitWithBodyweight(availableEquipment){
  const kit = new Set(availableEquipment || []);
  kit.add('bodyweight');
  return kit;
}

// Swap any block whose exercise can't be done with the user's kit for the best
// ranked substitution (history-aware when history is supplied). Returns the new
// sessions plus a log of every swap so the UI can explain the change.
export function applyEquipmentSubstitutions(sessions, availableEquipment=null, history=null){
  if(!availableEquipment || !availableEquipment.length) return { sessions: sessions || [], substitutions: [] };
  const has = kitWithBodyweight(availableEquipment);
  const kit = [...has];
  const subs = [];
  const out = (sessions||[]).map(s=> ({
    ...s,
    blocks: (s.blocks||[]).map(b=>{
      if(exerciseAvailable(b.exerciseId, kit)) return b;
      const [candidate] = rankedSubstitutions(b.exerciseId, kit, 1, history);
      if(!candidate) return b; // no viable sub — keep the plan; user can still attempt or skip
      subs.push({ sessionId: s.id, from: b.exerciseId, to: candidate.id, reason: `${b.exerciseId} needs kit you don't have — swapped for ${candidate.name}.` });
      return { ...b, exerciseId: candidate.id, loadHint: candidate.equipment.length===1 && candidate.equipment[0]==='bodyweight' && /light|moderate|dumbbell|barbell/.test(b.loadHint||'') ? 'bodyweight' : b.loadHint };
    }),
  }));
  return { sessions: out, substitutions: subs };
}

// Instantiate a template into a dated schedule for the user's kit. Every block
// the kit can't support gets an honest substitution; versioning is carried
// through (block.version = program version, templateVersion from the template).
export function instantiateTemplate({ templateId, startDateISO, availableEquipment=null, history=null }){
  const tpl = PROGRAM_TEMPLATES.find(t=> t.id===templateId);
  if(!tpl) throw new Error(`Unknown template ${templateId}`);
  const program = PROGRAM_BY_ID[tpl.programId];
  if(!program) throw new Error(`Template ${templateId} references unknown program ${tpl.programId}`);
  const base = scheduleProgram({ programId: tpl.programId, startDateISO });
  const { sessions, substitutions } = applyEquipmentSubstitutions(base.sessions, availableEquipment, history);
  return {
    templateId,
    programId: tpl.programId,
    name: tpl.name,
    startDateISO,
    sessions,
    substitutions,
    templateVersion: tpl.version || 1,
    programVersion: base.programVersion || program.version || 1,
  };
}

// Version report: template changelog + linked program changelog, so a user can
// see exactly what changed when a plan's numbers shift between updates.
export function templateVersionInfo(templateId){
  const tpl = templateById(templateId);
  if(!tpl) return null;
  return {
    templateId,
    name: tpl.name,
    templateVersion: tpl.version || 1,
    templateChanges: templateHistory(templateId),
    programVersion: tpl.program?.version || null,
    programChanges: tpl.program ? programHistory(tpl.programId) : [],
  };
}

// ── Recommendation ─────────────────────────────────────────────────────
// Deterministic profile scoring: equipment honesty dominates, then level/goal
// match, then days-per-week fit. Everything explains itself in `reasons`.
const GOAL_AFFINITY = {
  strength: ['strength'],
  muscle: ['muscle', 'general'],
  endurance: ['endurance', 'fat-loss', 'general'],
  'fat-loss': ['fat-loss', 'endurance', 'general'],
  general: ['general', 'muscle', 'endurance'],
};

function equipmentCoverage(program, availableEquipment){
  if(!program) return 0;
  const has = kitWithBodyweight(availableEquipment);
  const kit = [...has];
  const blocks = program.weeks.flatMap(w=> w.workouts.flatMap(wk=> wk.blocks||[]));
  if(!blocks.length) return 1;
  let ok = 0;
  for(const b of blocks){
    if(exerciseAvailable(b.exerciseId, kit)) { ok++; continue; }
    // declared substitutions that fit the kit count as covered (honest swap)
    const declared = (EXERCISE_BY_ID[b.exerciseId]?.substitution || []).map(id=> EXERCISE_BY_ID[id]).filter(Boolean);
    const covered = declared.some(c=> c.equipment.every(eq=> has.has(eq) || (c.equipment.length===1 && c.equipment[0]==='bodyweight')));
    if(covered) ok++;
  }
  return ok/blocks.length;
}

export function recommendTemplate({ goal='general', level='Beginner', availableEquipment=[], daysPerWeek=null }={}){
  const kit = kitWithBodyweight(availableEquipment);
  const ranked = listTemplates().map(t=>{
    const reasons = [];
    let score = 0;
    if(!t.program){ return { ...t, score: -100, reasons: ['unknown program'] }; }
    const coverage = equipmentCoverage(PROGRAM_BY_ID[t.programId], availableEquipment);
    score += coverage * 8;
    if(coverage >= 1) reasons.push('full equipment fit — no swaps needed');
    else if(coverage >= 0.75) reasons.push('mostly doable — a few honest swaps');
    else reasons.push('several exercises will need swapping');

    const declared = PROGRAM_BY_ID[t.programId].equipment || [];
    const fit = declared.filter(eq=> kit.has(eq)).length;
    const missing = declared.length - fit;
    score += fit * 3;
    if(missing){ score -= missing * 2; reasons.push(`needs ${missing} piece(s) of kit you don't have — swaps will cover it`); }
    if(t.level === level) { score += 3; reasons.push(`matches ${level} level`); }
    else { score += 1; reasons.push(`close to ${t.level} level`); }

    if(GOAL_AFFINITY[goal]?.includes(t.goal)) { score += 3; reasons.push(`suits your ${goal} goal`); }
    else if(t.goal === 'general') { score += 1; reasons.push('general-purpose'); }

    if(daysPerWeek){
      if(t.daysPerWeek === daysPerWeek) { score += 2; reasons.push(`${daysPerWeek}×/week exactly`); }
      else if(Math.abs(t.daysPerWeek - daysPerWeek) <= 1) { score += 1; reasons.push(`${t.daysPerWeek}×/week — close to your ${daysPerWeek}`); }
    }
    return { ...t, score: Math.round(score*100)/100, reasons };
  }).sort((a,b)=> b.score - a.score);
  return { top: ranked[0] || null, ranked };
}
