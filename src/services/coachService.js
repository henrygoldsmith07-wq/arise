import { aiCoachRoute, buildTrainingContext, COACH_FEEDBACK_URL, requestCoachInsight, saveAiSettings } from '../lib/aiCoach.js';

export async function runCoachRequest({ question, store, apiKey, baseUrl, model, persistKey = false }){
  const prompt = String(question || '').trim();
  if(!prompt) return { ok:false, error:'Ask a question first.' };
  const key = String(apiKey || '').trim();
  const ep = String(baseUrl || '').trim();
  // Persist any settings the caller supplied, and nothing it did not: an
  // omitted baseUrl must not overwrite a stored endpoint. saveAiSettings
  // already defaults every omitted field to the current stored value.
  saveAiSettings({
    apiKey: key,
    model,
    enabled: true,
    persistKey,
    ...(ep ? { baseUrl: ep } : {}),
  });
  const route = await aiCoachRoute(prompt);
  if(route.lane === 'feedback-pipeline'){
    return { ok:true, text:`That sounds like something to report. Please open an issue and include your support bundle (More → Data → Export support bundle).\n\n${COACH_FEEDBACK_URL}` };
  }
  if(route.lane === 'clarify'){
    return { ok:false, error:'Could you rephrase that? I can explain past sessions or answer general coaching questions — I can’t prescribe future workouts.' };
  }
  if(route.lane === 'local-engine'){
    return { ok:true, text:'That’s a training/progression question the deterministic engine already shows in Train and Progress — open a session there for the live recommendation and its reasoning.' };
  }
  const context = buildTrainingContext({
    history: store?.history || [],
    schedule: store?.activeSchedule,
    readinessLog: store?.readinessLog || [],
    customTemplates: store?.customTemplates || [],
  });
  return requestCoachInsight({ context, apiKey:key, baseUrl:ep || undefined, model });
}
