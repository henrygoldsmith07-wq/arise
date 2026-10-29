import { PROGRAMS, PROGRAM_BY_ID, scheduleProgram } from '../lib/data.js';
import { markSoftDeleted, unDelete, makeTombstone } from '../lib/domain.js';
import { startProgram } from '../lib/schedule.js';
import { adaptScheduleForEquipment, recordProgramStart } from '../lib/programming.js';
import { generateProgramme } from '../lib/programmeGenerator.js';
import { buildEditorTemplate, duplicateEditorTemplate } from '../lib/templateEditor.js';
import { localDateISO } from '../lib/dateOnly.js';
import { decodeShareCode } from '../lib/shareCodes.js';
import { editsAsTemplateInput } from '../lib/programmeEditor.js';

export function generateProgrammeFromProfile(store){
  if(!store?.onboarding) return { store, programId:null };
  const generated = generateProgramme({
    ...store.onboarding,
    availableEquipment:store.onboarding.equipment || [],
    history:store.history || [],
    customTemplates:store.customTemplates || [],
    startDateISO:localDateISO(),
  });
  return {
    programId:generated.programId,
    store:{
      ...store,
      activeSchedule:generated,
      programHistory:recordProgramStart(store.programHistory || [], {
        programId:generated.programId,
        version:generated.programVersion || 1,
        startDateISO:generated.startDateISO,
      }),
    },
  };
}

export function startProgramme({ store, programId, availableEquipment = [] }){
  const custom = (store.customTemplates || []).find(t=> !t.deletedAt && t.id === programId);
  const startDateISO = localDateISO();
  const scheduledStore = custom
    ? { ...store, activeSchedule:scheduleProgram({ programId, startDateISO, program:custom.program }) }
    : startProgram(store, programId);
  const programme = custom ? custom.program : PROGRAM_BY_ID[programId];
  if(!programme || !scheduledStore?.activeSchedule) return { store, started:false };
  const adapted = adaptScheduleForEquipment(scheduledStore.activeSchedule, availableEquipment, store.history || []);
  const history = recordProgramStart(store.programHistory || [], {
    programId,
    version:programme.version || 1,
    startDateISO:scheduledStore.activeSchedule.startDateISO,
    endDateISO:null,
  });
  return {
    started:true,
    store:{ ...scheduledStore, activeSchedule:adapted.schedule, programHistory:history },
  };
}

export function saveCustomTemplate({ store, form, editingId = null }){
  if(!form?.name?.trim() || (form.days || []).some(day=> !day.exercises?.some(ex=> ex.exerciseId))){
    throw new Error('Give the template a name and at least one exercise per day.');
  }
  const current = (store.customTemplates || []).filter(t=> !t.deletedAt);
  const existing = editingId ? current.find(t=> t.id === editingId) : null;
  const template = buildEditorTemplate(form, existing);
  const customTemplates = editingId
    ? (store.customTemplates || []).map(t=> t.id === editingId ? template : t)
    : [...(store.customTemplates || []), template];
  return { template, store:{ ...store, customTemplates } };
}

// "Save as my template" from the programme editor: the edited days of the
// active programme become a custom template (repeated for every week of the
// source block). Returns { template, store }; throws a readable error.
export function saveEditsAsTemplate({ store, name }){
  const schedule = store?.activeSchedule;
  if(!schedule?.sessions?.length) throw new Error('No active programme to save.');
  const source = (store.customTemplates || []).find(t=> t.id === schedule.programId)?.program || PROGRAM_BY_ID[schedule.programId] || null;
  const input = editsAsTemplateInput(schedule, { name, level: source?.level || store.onboarding?.level || 'Beginner', goal: store.onboarding?.goal || 'general' });
  if(!input.days.length) throw new Error('This programme has no days to save.');
  const built = buildEditorTemplate(input);
  const workouts = built.program.weeks[0].workouts;
  const weeks = Array.from({ length: input.weeks }, (_, i)=> ({ week: i + 1, workouts: workouts.map(w=> ({ ...w, blocks: w.blocks.map(b=> ({ ...b })) })) }));
  const template = {
    ...built,
    savedFromProgrammeId: schedule.programId || null,
    program: { ...built.program, weeks, mesocycle: { ...built.program.mesocycle, weeks: input.weeks } },
  };
  return { template, store: { ...store, customTemplates: [...(store.customTemplates || []), template] } };
}

// "Start next block from my edits": save the edits as a template, then start
// it through the normal programme-start path (equipment adaptation and the
// programme-history record included).
export function startNextBlockFromEdits({ store, name, availableEquipment = [] }){
  const saved = saveEditsAsTemplate({ store, name });
  const started = startProgramme({ store: saved.store, programId: saved.template.id, availableEquipment });
  return { template: saved.template, started: started.started, store: started.started ? started.store : saved.store };
}

export function softDeleteCustomTemplate(store, id){
  const target = (store.customTemplates || []).find(t=> t.id === id);
  if(!target) return store;
  const tombstone = makeTombstone('templates', id, { deviceId:undefined });
  return {
    ...store,
    customTemplates:(store.customTemplates || []).map(t=> t.id === id ? markSoftDeleted(t) : t),
    tombstones:[...(store.tombstones || []).filter(t=> t.refId !== id), tombstone],
  };
}

export function restoreCustomTemplate(store, id){
  return {
    ...store,
    customTemplates:(store.customTemplates || []).map(t=> t.id === id ? unDelete(t) : t),
    tombstones:(store.tombstones || []).filter(t=> t.refId !== id),
  };
}

/**
 * Apply a finished onboarding to the LATEST store. `plan` is the first plan
 * generated off the profile ({ started, firstPlan }) or null. The generated
 * schedule is only adopted when the store still has no programme: a
 * programme started (or restored) while the plan was being generated wins,
 * and every other field written in the meantime is kept.
 */
export function mergeOnboardingCompletion(prev, payload, plan = null){
  const base = prev || {};
  const schedule = plan?.started?.store?.activeSchedule;
  if(!schedule || base.activeSchedule) return { ...base, onboarding: payload };
  return {
    ...base,
    activeSchedule: schedule,
    programHistory: recordProgramStart(base.programHistory || [], {
      programId: schedule.programId,
      version: schedule.programVersion || 1,
      startDateISO: schedule.startDateISO,
    }),
    onboarding: { ...payload, ...(plan.firstPlan ? { firstPlan: plan.firstPlan } : {}) },
  };
}

export function duplicateCustomTemplate(store, template){
  const copy = duplicateEditorTemplate(template);
  if(!copy) return { store, copy:null };
  return { copy, store:{ ...store, customTemplates:[...(store.customTemplates || []), copy] } };
}

export function installSharedTemplate(store, shareCode){
  const template = decodeShareCode(shareCode);
  if((store.customTemplates || []).some(t=> t.name === template.name && !t.deletedAt)){
    throw new Error(`A template named “${template.name}” already exists — rename it first to install this one.`);
  }
  return { template, store:{ ...store, customTemplates:[...(store.customTemplates || []), template] } };
}

export function applyEquipmentAdaptation(store, adaptation){
  return adaptation?.changed ? { ...store, activeSchedule:adaptation.schedule } : store;
}

export function fallbackProgrammeId(){ return PROGRAMS[0]?.id || null; }
