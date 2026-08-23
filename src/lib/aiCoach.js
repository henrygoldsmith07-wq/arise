// aiCoach.js — optional AI coaching layer backed by NVIDIA-hosted models.
//
// Hard rules:
//   1. BYOK: the API key lives ONLY in this device's localStorage. It is never
//      exported, synced, logged, or included in backups. Nothing is hardcoded.
//   2. Consent: requests fire only when the user enabled the feature AND a key
//      is present.
//   3. Minimal payloads: only aggregated training numbers leave the device —
//      no identifiers, no raw notes, no keys.
//   4. Fail soft: every network path resolves to { ok:false, error }; the app
//      works identically without this module ever succeeding.

const SETTINGS_KEY = 'arise.ai.settings.v1';
export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
export const DEFAULT_MODEL = 'meta/llama-3.1-8b-instruct';

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

// ── Context builder: aggregated training numbers only ───────────────────

export function buildTrainingContext({ history = [], schedule = null, readinessLog = [], customTemplates = [] } = {}){
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

  const exerciseSets = new Map();
  let totalSets = 0;
  for(const h of history || []) for(const b of h.blocks || []){
    const n = (b.sets || []).length;
    totalSets += n;
    exerciseSets.set(b.exerciseId, (exerciseSets.get(b.exerciseId) || 0) + n);
  }
  const topExercises = [...exerciseSets.entries()]
    .sort((a, b)=> b[1] - a[1]).slice(0, 8)
    .map(([exerciseId, sets]) => ({ exerciseId, sets }));

  const doneCount = (history || []).length;
  const plannedCount = schedule?.sessions?.length || 0;
  const doneInSchedule = plannedCount
    ? schedule.sessions.filter(s => doneIds(schedule, history).has(s.id)).length
    : 0;

  const readinessScores = (readinessLog || []).map(r => Number(r.score)).filter(Number.isFinite);

  return {
    appVersion: 1,
    totals: {
      sessionsLogged: doneCount,
      totalSets,
      programmeSessionsTotal: plannedCount,
      programmeSessionsDone: doneInSchedule,
      customTemplates: customTemplates.length,
    },
    recentWeeks: weeks,
    topExercisesBySets: topExercises,
    muscleBalanceHint: muscleSpread(history),
    averageReadiness: readinessScores.length
      ? Math.round(readinessScores.slice(-8).reduce((a, b)=> a + b, 0) / readinessScores.length)
      : null,
  };
}
function doneIds(schedule, history){
  const histIds = new Set((history || []).map(h => h.id));
  const out = new Set();
  for(const s of schedule?.sessions || []){
    if(histIds.has(s.id) || s.status === 'done') out.add(s.id);
  }
  return out;
}
function muscleSpread(history){
  // Uses declared ids only — names are unnecessary for the payload.
  const counts = {};
  for(const h of history || []) for(const b of h.blocks || []){
    const id = b.exerciseId || '';
    const family = id.split('-')[0];
    counts[family] = (counts[family] || 0) + (b.sets || []).length;
  }
  return counts;
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
        temperature: 0.4,
        max_tokens: 400,
        messages: [
          { role:'system', content: 'You are a concise, evidence-based strength coach. You receive aggregated training numbers (never personal data). Reply with at most 180 words: one short paragraph on what is going well, then up to three concrete adjustments as "- " bullets. No medical claims. If data is too sparse, say so plainly.' },
          { role:'user', content: `Training summary JSON:\n${JSON.stringify(context)}` },
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
