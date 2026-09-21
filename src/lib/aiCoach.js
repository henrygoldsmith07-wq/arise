// aiCoach.js — optional AI coaching layer backed by NVIDIA-hosted models.
//
// Architecture (fixed contract):
//   Arise deterministic engine -> evidence + proposed decisions -> AI ->
//   explanation / summarisation / questions.
// The LLM NEVER invents prescriptions. It receives the engine's own findings
// (weekly-review directives, deload signals, model capability state) plus
// aggregated numbers, and explains them.
//
// Hard rules:
//   1. BYOK: the API key lives ONLY in this device's localStorage. It is never
//      exported, synced, logged, or included in backups. Nothing is hardcoded.
//   2. Consent: requests fire only when the user enabled the feature AND a key
//      is present.
//   3. Minimal payloads: only aggregated numbers and engine outputs leave the
//      device — no identifiers, no raw notes, no keys.
//   4. Fail soft: every network path resolves to { ok:false, error }.

import { EXERCISE_BY_ID } from './data.js';
import { resolveArisePriors } from './priors.js';
import { reviewCompletedWeek } from './mesocycle.js';
import { routeCoachRequest, isClassifierEnabled } from './feedbackClassifier.js';

const SETTINGS_KEY = 'arise.ai.settings.v1';
export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
export const DEFAULT_MODEL = 'meta/llama-3.1-8b-instruct';
export const COACH_FEEDBACK_URL = 'https://github.com/henrygoldsmith07-wq/arise/issues/new?template=feedback.md';

// Deterministic intent rules first, then classifier.dev semantic fallback
// (opt-in, redacted, offline-local-keyword fallback). The router returns a
// LANE only — it never produces a training prescription. Lanes:
//   local-engine    -> the deterministic engine already answers (no cloud coach)
//   coach-cloud     -> hand off to the existing NVIDIA explanation layer
//   feedback-pipeline -> route to the feedback channel (bug/feature request)
//   clarify         -> ask the user to rephrase
const INTENT_KEYWORDS = [
  { lane: 'local-engine', re: /\b(how (do|should|to|can) i|progression|progression policy|what (load|weight)|next (set|workout|session|week)|increase|decrease|add weight|too heavy|easy|hard|deload|rest|rerack)\b/i },
  { lane: 'feedback-pipeline', re: /\b(crash|bug|broken|error|fail|freeze|slow|lag|jank|stuck|broken|import|export|backup|sync|csv|merge|wrong|mismatch|typo|missing|add|feature|request|accessibility|contrast|screen reader|voiceover|talkback|keyboard|font|blur|lag)\b/i },
  { lane: 'coach-cloud', re: /\b(coach|insight|explain|why|tell me about|summary|recap|analyse|analyze|review|weekly)\b/i },
];
const DEFAULT_COACH_FETCH = typeof fetch !== 'undefined' ? fetch : null;

// Opt-in, redacted semantic fallback. Returns only a lane; never a prescription.
export async function aiCoachRoute(promptText, { fetchImpl = null, timeoutMs = 6000 } = {}){
  const text = String(promptText == null ? '' : promptText);
  for(const rule of INTENT_KEYWORDS){
    if(rule.re.test(text)) return { lane: rule.lane, source: 'deterministic-keyword', classified: false };
  }
  // Deterministic rules did not decide -> classifier.dev semantic fallback.
  // routeCoachRequest only hits the network when the user has explicitly opted
  // in; otherwise it resolves locally (keyword label, needsReview=true) and
  // never throws into the UI flow.
  const r = await routeCoachRequest(text, {
    fetchImpl: fetchImpl || DEFAULT_COACH_FETCH || undefined,
    timeoutMs,
  });
  // routeCoachRequest maps: training-question -> local-engine (the deterministic
  // engine owns prescriptions, not the cloud coach), feedback-or-bug ->
  // feedback-pipeline, anything else -> clarify. The cloud explanation layer
  // only ever answers general coaching/questions, never training prescriptions.
  const lane = r.route === 'local-engine' ? 'local-engine'
    : r.route === 'feedback-pipeline' ? 'feedback-pipeline'
    : r.route === 'clarify' ? 'clarify'
    : 'coach-cloud';
  return { lane, source: r.source, classified: true, needsReview: r.needsReview, label: r.label };
}

const SYSTEM_PROMPT =
  'You are the explanation layer for Arise, a deterministic strength-training engine. ' +
  'You receive ENGINE FINDINGS (decisions the engine already made, with reasons) and aggregated weekly numbers. ' +
  'Summarise what the engine decided and why in plain language, and surface at most two useful questions the user should answer next. ' +
  'NEVER invent, modify or suggest prescriptions, loads, sets or programme changes — the engine is authoritative. ' +
  'If findings are empty, say the engine has not made decisions yet. Maximum 150 words.';

function storage(){
  try{ return typeof localStorage !== 'undefined' ? localStorage : null; }catch{ return null; }
}

export function getAiSettings(){
  const s = storage();
  if(!s) return { enabled:false, apiKey:'', model: DEFAULT_MODEL };
  try{
    const parsed = JSON.parse(s.getItem(SETTINGS_KEY) || '{}');
    return {
      enabled: parsed.enabled === true,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: typeof parsed.model === 'string' && parsed.model ? parsed.model : DEFAULT_MODEL,
    };
  }catch{ return { enabled:false, apiKey:'', model: DEFAULT_MODEL }; }
}

export function saveAiSettings({ enabled = null, apiKey = null, model = null } = {}){
  const s = storage();
  if(!s) return false;
  const cur = getAiSettings();
  const next = {
    enabled: enabled == null ? cur.enabled : !!enabled,
    apiKey: apiKey == null ? cur.apiKey : String(apiKey).trim(),
    model: model == null ? cur.model : String(model).trim() || DEFAULT_MODEL,
  };
  try{
    s.setItem(SETTINGS_KEY, JSON.stringify(next));
    return true;
  }catch{ return false; }
}

export function clearAiSettings(){
  const s = storage();
  try{ s?.removeItem(SETTINGS_KEY); }catch{}
}

// ── Context builder: engine findings + aggregated numbers only ─────────

export function buildTrainingContext({ history = [], schedule = null, readinessLog = [], customTemplates = [], config = null } = {}){
  const byWeek = new Map(); // monday -> {sessions, sets, volumeKg}
  for(const h of history || []){
    const d = new Date(`${h?.dateISO || ''}T00:00:00Z`);
    if(Number.isNaN(d.getTime())) continue;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    let sets = 0, vol = 0;
    for(const b of h.blocks || []) for(const s of b.sets || []){
      sets++;
      vol += (Number(s.reps) || 0) * (Number(s.weightKg) || 0);
    }
    const w = byWeek.get(key) || { weekStart: key, sessions: 0, sets: 0, volumeKg: 0 };
    w.sessions++; w.sets += sets; w.volumeKg += Math.round(vol);
    byWeek.set(key, w);
  }
  const weeks = [...byWeek.values()].sort((a, b)=> a.weekStart.localeCompare(b.weekStart)).slice(-6);

  // True muscle balance via the exercise database — never id prefixes.
  const muscleSets = {};
  const exerciseSets = new Map();
  let totalSets = 0;
  for(const h of history || []) for(const b of h.blocks || []){
    const n = (b.sets || []).length;
    totalSets += n;
    exerciseSets.set(b.exerciseId, (exerciseSets.get(b.exerciseId) || 0) + n);
    const muscle = EXERCISE_BY_ID[b.exerciseId]?.muscle || 'Other';
    muscleSets[muscle] = (muscleSets[muscle] || 0) + n;
  }
  const topExercises = [...exerciseSets.entries()]
    .sort((a, b)=> b[1] - a[1]).slice(0, 8)
    .map(([exerciseId, sets]) => ({ exerciseId, sets }));

  // Engine findings: the deterministic layer's own latest decisions.
  const engineFindings = { weeklyReviewReady: false, directives: [], deloadSignals: [], mesoDeloadDue: false };
  try{
    const review = reviewCompletedWeek({ schedule, history, config });
    if(review?.ready){
      engineFindings.weeklyReviewReady = true;
      engineFindings.directives = (review.directives || []).map(d => ({
        exerciseId: d.exerciseId,
        kind: d.kind,
        ...(d.toExerciseId ? { toExerciseId: d.toExerciseId } : {}),
        reason: d.reason,
      }));
      engineFindings.deloadSignals = review.deloadDecision?.signals || [];
      engineFindings.mesoDeloadDue = !!review.mesoDeloadDue;
    }
  }catch{}

  const readinessScores = (readinessLog || []).map(r => Number(r.score)).filter(Number.isFinite);
  const recentReadiness = readinessScores.slice(-8);
  void resolveArisePriors; // priors flow through reviewCompletedWeek; kept for future gates

  return {
    contextVersion: 2,
    totals: {
      sessionsLogged: (history || []).length,
      totalSets,
      customTemplates: (customTemplates || []).length,
    },
    recentWeeks: weeks,
    topExercisesBySets: topExercises,
    muscleBalance: muscleSets,
    averageReadiness: recentReadiness.length
      ? Math.round(recentReadiness.reduce((a, b)=> a + b, 0) / recentReadiness.length)
      : null,
    engineFindings,
  };
}

// ── Request ─────────────────────────────────────────────────────────────

export async function requestCoachInsight({ context, apiKey, model = DEFAULT_MODEL, timeoutMs = 15000, fetchImpl = null } = {}){
  if(!apiKey) return { ok:false, error:'No API key set.' };
  if(!context) return { ok:false, error:'Nothing to analyse yet — log some sessions first.' };
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if(!doFetch) return { ok:false, error:'Network unavailable in this environment.' };

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(()=> controller.abort(), timeoutMs) : null;
  try{
    const res = await doFetch(NVIDIA_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 350,
        messages: [
          { role:'system', content: SYSTEM_PROMPT },
          { role:'user', content: `Engine findings and training numbers:\n${JSON.stringify(context)}` },
        ],
      }),
      signal: controller?.signal,
    });
    if(!res.ok){
      const bodyText = await res.text().catch(()=> '');
      return { ok:false, error:`API ${res.status}: ${bodyText.slice(0, 140)}` };
    }
    const json = await res.json().catch(()=> null);
    const text = json?.choices?.[0]?.message?.content;
    if(typeof text !== 'string' || !text.trim()) return { ok:false, error:'Empty response from model.' };
    return { ok:true, text: text.trim(), model, sentAtISO: new Date().toISOString() };
  }catch(err){
    const aborted = err?.name === 'AbortError';
    return { ok:false, error: aborted ? 'Request timed out.' : `Request failed: ${String(err?.message || err).slice(0, 120)}` };
  }finally{
    if(timer) clearTimeout(timer);
  }
}
