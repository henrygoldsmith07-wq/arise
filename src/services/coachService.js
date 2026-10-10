// coachService.js — the user-facing coach workflow.
//
// LANE ORDER (this file's whole job)
// ---------------------------------
//   1. feedback-pipeline → the issue tracker path. Nothing local.
//   2. clarify           → the deterministic router could not classify; ask again.
//   3. local-engine      → the question is one the deterministic engine already
//                          answers on Train/Progress; point there.
//   4. coach-cloud       → "explain / summarise / how am I doing".
//
// Lane 4 used to dead-end here in every shipped build: `requestCoachInsight`
// refuses before it looks at the key when the optional integrations are
// compiled out, which is the default. The user typed a reasonable question and
// got "not available in this build" — while the app was, at that same moment,
// holding a complete structured coaching state on device.
//
// Lane 4 now answers LOCALLY FIRST (localCoach.js — pure, offline, built from
// the deterministic engines), and escalates to a user-configured endpoint only
// when one is actually configured and compiled in. That keeps three properties
// the product has always claimed:
//   * local-first — the coach works with no endpoint and no key;
//   * no fabrication — the local answer only restates engine findings, and the
//     remote model gets a much richer context than the weekly aggregates it
//     used to receive, still under the "engine is authoritative" prompt;
//   * no silent network — nothing leaves the device unless the user configured
//     a host.

import { aiCoachRoute, buildTrainingContext, COACH_FEEDBACK_URL, requestCoachInsight, saveAiSettings, DEFAULT_BASE_URL, isValidEndpointUrl } from '../lib/aiCoach.js';
import { localCoachAnswer, classifyCoachQuestion } from '../lib/coach/localCoach.js';
import { integrationEnabledByBuild } from '../lib/integrations.js';

const RECOMMENDATION_LANES = new Set(['coach-cloud']);

export async function runCoachRequest({ question, store, apiKey, baseUrl, model, persistKey = false }){
  const prompt = String(question || '').trim();
  if(!prompt) return { ok:false, error:'Ask a question first.' };
  const key = String(apiKey || '').trim();
  const ep = String(baseUrl || '').trim();
  // Persist only what the caller actually supplied. An explicit API key or
  // endpoint in the form is a deliberate act; merely typing a question is not,
  // so this no longer force-sets `enabled` on every ask.
  saveAiSettings({
    apiKey: key,
    model,
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
  if(!RECOMMENDATION_LANES.has(route.lane)) return { ok:false, error:'I could not tell what that was about. Try asking about your week, a lift, a plateau, or a missed session.' };

  // ── Lane 4: answer on device first ─────────────────────────────────────
  // The local coach composes a specific answer from buildCoachingState. It
  // returns ok:false only when the engines genuinely have nothing to say, in
  // which case escalating to a model would produce invented numbers — the one
  // thing the whole architecture exists to prevent.
  const local = localCoachAnswer(prompt, { store: store || {} });
  if(local.ok){
    // A configured, compiled-in endpoint is still allowed to expand on this,
    // but only when the user set one up. Without it, the local answer is the
    // answer — no dead end, no network.
    const wantsCloud = ep && isValidEndpointUrl(ep) && ep !== DEFAULT_BASE_URL;
    if(!wantsCloud || !integrationEnabledByBuild()){
      return {
        ok: true,
        text: local.text,
        source: 'local-coach',
        intent: local.intent,
        confidence: local.confidence,
        evidence: local.evidence,
        offline: true,
      };
    }
    const context = buildTrainingContext({
      history: store?.history || [],
      schedule: store?.activeSchedule,
      readinessLog: store?.readinessLog || [],
      customTemplates: store?.customTemplates || [],
      engineDecisions: local.evidence,
    });
    const cloud = await requestCoachInsight({ context, apiKey:key, baseUrl:ep, model });
    if(cloud.ok) return { ...cloud, source: 'endpoint', localAnswer: local.text };
    // Fail soft to the local answer — a model outage must not cost the user
    // the answer the engines already had.
    return {
      ok: true,
      text: local.text,
      source: 'local-coach',
      intent: local.intent,
      confidence: local.confidence,
      evidence: local.evidence,
      offline: true,
      note: `Your configured endpoint was unreachable (${cloud.error}), so this is the on-device answer.`,
    };
  }

  // Nothing to work with on device. A remote model could still phrase a general
  // answer, so the configured-and-compiled-in case is tried; otherwise say so
  // honestly rather than manufacting a response.
  const wantsCloud = ep && isValidEndpointUrl(ep) && ep !== DEFAULT_BASE_URL;
  if(!wantsCloud || !integrationEnabledByBuild()) return { ok:false, error: local.error };
  const context = buildTrainingContext({
    history: store?.history || [],
    schedule: store?.activeSchedule,
    readinessLog: store?.readinessLog || [],
    customTemplates: store?.customTemplates || [],
  });
  const cloud = await requestCoachInsight({ context, apiKey:key, baseUrl:ep, model });
  return cloud;
}

export { classifyCoachQuestion };
