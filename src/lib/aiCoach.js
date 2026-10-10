// aiCoach.js — optional AI coaching layer backed by a user-configured endpoint.
//
// Architecture (fixed contract):
//   Arise deterministic engine -> evidence + proposed decisions -> AI ->
//   explanation / summarisation / questions.
// The LLM NEVER invents prescriptions. It receives the engine's own findings
// (weekly-review directives, deload signals, model capability state) plus
// aggregated numbers, and explains them.
//
// Hard rules:
//   1. BYOK: the API key is session-only by default. Persistent storage is an
//      explicit opt-in. It is never exported, synced, logged, or included in
//      backups. Nothing is hardcoded except a local-friendly default endpoint.
//   2. Consent: requests fire only when the user enabled the feature AND a key
//      is present AND an endpoint is configured.
//   3. Minimal payloads: only aggregated numbers and engine outputs leave the
//      device — no identifiers, no raw notes, no keys.
//   4. Fail soft: every network path resolves to { ok:false, error }.
//   5. Local-first default: the out-of-box endpoint is a localhost loopback
//      (e.g. Ollama), so the coach works with zero cloud and no third-party
//      dependency. The user can point it at any OpenAI-compatible endpoint.

import { EXERCISE_BY_ID } from './data.js';
import { resolveArisePriors } from './priors.js';
import { reviewCompletedWeek } from './mesocycle.js';
import { routeCoachRequest } from './feedbackClassifier.js';
import { integrationEnabledByBuild } from './integrations.js';

const SETTINGS_KEY = 'arise.ai.settings.v1';
const SESSION_KEY = 'arise.ai.session-key.v1';

// Local-first default: a loopback endpoint (Ollama, llama.cpp server, etc.) so
// the coach works with no third-party service. The CSP permits connect-src to
// 127.0.0.1 and [::1] for this. Users can override the endpoint to point at any
// OpenAI-compatible API.
export const LOCAL_BASE_URL = 'http://127.0.0.1:11434/v1/chat/completions';
export const DEFAULT_BASE_URL = LOCAL_BASE_URL;
export const DEFAULT_MODEL = 'meta/llama-3.1-8b-instruct';
export const COACH_FEEDBACK_URL = 'https://github.com/henrygoldsmith07-wq/arise/issues/new?template=feedback.md';

// Validate a user-configured endpoint URL. Loopback (HTTP) and https are both
// accepted; loopback is explicitly allowed so local inference is first-class.
export function isValidEndpointUrl(url){
  if(!url || typeof url !== 'string') return false;
  let u;
  try{ u = new URL(url.trim()); }catch{ return false; }
  const isLoopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname.endsWith('.localhost');
  return isLoopback ? u.protocol === 'http:' || u.protocol === 'https:' : u.protocol === 'https:';
}

// Classify a stored endpoint URL for legacy migration purposes. Returns 'loopback',
// 'remote-nvidia' (the old hardcoded endpoint), 'remote-valid', or 'invalid'.
export function parseableEndpoint(url){
  if(!isValidEndpointUrl(url)) return 'invalid';
  try{
    const u = new URL(url.trim());
    if(u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname.endsWith('.localhost')) return 'loopback';
    if(u.hostname === 'integrate.api.nvidia.com') return 'remote-nvidia';
    return 'remote-valid';
  }catch{ return 'invalid'; }
}

// Thin orchestration wrapper around the classifier-owned route. It returns a
// lane only — it never produces a training prescription.
export async function aiCoachRoute(promptText, { fetchImpl = null, timeoutMs = 6000 } = {}){
  const text = String(promptText == null ? '' : promptText);
  const result = await routeCoachRequest(text, {
    fetchImpl: fetchImpl || undefined,
    timeoutMs,
  });
  return {
    ...result,
    lane: result.route,
    // Keep the old provenance label for consumers while the classifier owns
    // the actual local rules and result.
    source: result.source === 'local-keywords' ? 'deterministic-keyword' : result.source,
    classified: result.source === 'cloud',
  };
}

const SYSTEM_PROMPT =
  'You are the explanation layer for Arise, a deterministic strength-training engine. ' +
  'You receive ENGINE FINDINGS (decisions the engine already made, with reasons) and aggregated weekly numbers. ' +
  'Summarise what the engine decided and why in plain language, and surface at most two useful questions the user should answer next. ' +
  'NEVER invent, modify or suggest prescriptions, loads, sets or programme changes — the engine is authoritative. ' +
  'If findings are empty, say the engine has not made decisions yet. Maximum 150 words.';

let volatileSessionKey = '';

function storage(){
  try{ return typeof localStorage !== 'undefined' ? localStorage : null; }catch{ return null; }
}
function sessionStorageSafe(){
  try{ return typeof sessionStorage !== 'undefined' ? sessionStorage : null; }catch{ return null; }
}

function sessionKey(){
  const s = sessionStorageSafe();
  try{ return String(s?.getItem(SESSION_KEY) || volatileSessionKey || ''); }catch{ return volatileSessionKey; }
}
function setSessionKey(value){
  volatileSessionKey = String(value || '');
  const s = sessionStorageSafe();
  try{
    if(volatileSessionKey) s?.setItem(SESSION_KEY, volatileSessionKey);
    else s?.removeItem(SESSION_KEY);
  }catch{}
}

export function getAiSettings(){
  const s = storage();
  if(!s) return { enabled:false, apiKey:sessionKey(), baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, persistKey:false };
  try{
    const parsed = JSON.parse(s.getItem(SETTINGS_KEY) || '{}');
    // Legacy migration: older builds persisted the key unconditionally. Keep
    // it available for this browser session, then immediately strip it from
    // durable storage unless persistence had been explicitly opted into.
    if(typeof parsed.apiKey === 'string' && parsed.apiKey && parsed.persistKey !== true){
      setSessionKey(parsed.apiKey);
      const migrated = { ...parsed, persistKey:false };
      delete migrated.apiKey;
      // Migrate legacy NVIDIA endpoint to the new local-first default.
      if(parseableEndpoint(parsed.baseUrl) === 'remote-nvidia' || !isValidEndpointUrl(parsed.baseUrl)){
        migrated.baseUrl = DEFAULT_BASE_URL;
      }
      s.setItem(SETTINGS_KEY, JSON.stringify(migrated));
      return {
        enabled: migrated.enabled === true,
        apiKey: sessionKey(),
        baseUrl: isValidEndpointUrl(migrated.baseUrl) ? migrated.baseUrl : DEFAULT_BASE_URL,
        model: typeof migrated.model === 'string' && migrated.model ? migrated.model : DEFAULT_MODEL,
        persistKey: false,
      };
    }
    const persistKey = parsed.persistKey === true;
    const baseUrl = isValidEndpointUrl(parsed.baseUrl) ? parsed.baseUrl : DEFAULT_BASE_URL;
    return {
      enabled: parsed.enabled === true,
      apiKey: persistKey && typeof parsed.apiKey === 'string' ? parsed.apiKey : sessionKey(),
      baseUrl,
      model: typeof parsed.model === 'string' && parsed.model ? parsed.model : DEFAULT_MODEL,
      persistKey,
    };
  }catch{ return { enabled:false, apiKey:sessionKey(), baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, persistKey:false }; }
}

export function saveAiSettings({ enabled = null, apiKey = null, model = null, baseUrl = null, persistKey = null } = {}){
  const s = storage();
  if(!s) return false;
  const cur = getAiSettings();
  const keepPersisted = persistKey == null ? cur.persistKey === true : persistKey === true;
  const nextKey = apiKey == null ? cur.apiKey : String(apiKey).trim();
  const nextBaseUrl = baseUrl == null ? cur.baseUrl : String(baseUrl).trim() || DEFAULT_BASE_URL;
  const next = {
    enabled: enabled == null ? cur.enabled : !!enabled,
    baseUrl: isValidEndpointUrl(nextBaseUrl) ? nextBaseUrl : DEFAULT_BASE_URL,
    model: model == null ? cur.model : String(model).trim() || DEFAULT_MODEL,
    persistKey: keepPersisted,
  };
  if(keepPersisted && nextKey) next.apiKey = nextKey;
  if(keepPersisted) setSessionKey('');
  else setSessionKey(nextKey);
  try{
    s.setItem(SETTINGS_KEY, JSON.stringify(next));
    return true;
  }catch{ return false; }
}

export function clearAiSettings(){
  const s = storage();
  try{ s?.removeItem(SETTINGS_KEY); }catch{}
  setSessionKey('');
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

export async function requestCoachInsight({ context, apiKey, baseUrl, model = DEFAULT_MODEL, timeoutMs = 15000, fetchImpl = null } = {}){
  // Build-time boundary first: the hosted build ships with this integration
  // compiled out, so no key and no click can reach the network. An API key is a
  // second gate, not the first one.
  if(!integrationEnabledByBuild()) return { ok:false, error:'The AI coach is not available in this build.', notAvailable:true };
  if(!apiKey) return { ok:false, error:'No API key set.' };
  if(!context) return { ok:false, error:'Nothing to analyse yet — log some sessions first.' };
  // Resolve the endpoint: explicit arg > persisted settings > local-first default.
  let url = baseUrl;
  if(!url || !isValidEndpointUrl(url)){
    const settings = getAiSettings();
    url = settings.baseUrl || DEFAULT_BASE_URL;
  }
  if(!isValidEndpointUrl(url)) return { ok:false, error:'No valid endpoint configured.' };
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if(!doFetch) return { ok:false, error:'Network unavailable in this environment.' };

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(()=> controller.abort(), timeoutMs) : null;
  try{
    const res = await doFetch(url, {
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
