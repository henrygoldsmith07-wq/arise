// feedbackClassifier.js — conservative, opt-in classifier.dev adapter.
// Scope: user-feedback categorisation, developer issue categorisation,
// optional cloud AI-coach request routing (lane only, never prescription).
// Non-goals: readinessClassifier, trainRecommendation, sessionGenerator,
// progression, substitutions, safety stay local + offline. This module never
// imports them, and they never import it (enforced by tests).
// Privacy: cloud-only opt-in, redacted + truncated input, no raw text in
// telemetry/exports/logs, timeout/failure fallback to other, confidence gate.
export const CLASSIFIER_ENDPOINT = 'https://classifier.dev';
export const CLASSIFIER_SETTINGS_KEY = 'arise.classifier.settings.v1';
export const CLASSIFIER_TAXONOMY_VERSION = 1;
export const FEEDBACK_LABELS = Object.freeze([
  'bug',
  'exercise-request',
  'program-request',
  'usability',
  'content-error',
  'accessibility',
  'performance',
  'import-data',
  'other',
]);
export const COACH_ROUTE_LABELS = Object.freeze([
  'training-question',
  'feedback-or-bug',
  'other',
]);
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;
export const DEFAULT_TIMEOUT_MS = 6000;
export const MAX_INPUT_CHARS = 500;
function storage(){
  try{ return typeof localStorage !== 'undefined' ? localStorage : null; }catch{ return null; }
}
export function getClassifierSettings(){
  const s = storage();
  if(!s) return { enabled: false };
  try{
    const parsed = JSON.parse(s.getItem(CLASSIFIER_SETTINGS_KEY) || '{}');
    return { enabled: parsed.enabled === true };
  }catch{ return { enabled: false }; }
}
export function saveClassifierSettings({ enabled = null } = {}){
  const s = storage();
  if(!s) return false;
  const cur = getClassifierSettings();
  const next = { enabled: enabled == null ? cur.enabled : !!enabled };
  try{ s.setItem(CLASSIFIER_SETTINGS_KEY, JSON.stringify(next)); return true; }catch{ return false; }
}
export function clearClassifierSettings(){
  try{ storage()?.removeItem(CLASSIFIER_SETTINGS_KEY); }catch{}
}
export function isClassifierEnabled(){
  return getClassifierSettings().enabled === true;
}
// Redaction: best-effort scrub before anything leaves the device. Callers
// must still gate on opt-in and must never persist raw text next to labels.
export function redactTextForClassification(input, { maxLen = MAX_INPUT_CHARS } = {}){
  if(input == null) return '';
  let text = String(input);
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
  text = text.replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-phone]');
  text = text.replace(/bearer\s+[a-z0-9._~-]+/gi, 'bearer [redacted]');
  text = text.replace(/api[_-]?key\s*[:=]\s*\S+/gi, 'api-key [redacted]');
  text = text.replace(/password\s*[:=]\s*\S+/gi, 'password [redacted]');
  text = text.replace(/\b\d{6,}\b/g, '[redacted-number]');
  text = text.trim().replace(/\s+/g, ' ');
  if(text.length > maxLen) text = text.slice(0, maxLen);
  return text;
}
function normaliseLabels(labels){
  const list = Array.isArray(labels) ? labels.filter((l) => typeof l === 'string' && l.trim()) : [];
  const seen = new Set();
  const out = [];
  for(const l of list){
    const v = l.trim();
    if(!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
function isValidLabelSet(labels){
  return labels.length >= 2 && labels.includes('other');
}
// Deterministic local keyword fallback. Pure + offline. Confidence stays at
// 0.55 so callers keep needsReview true unless cloud clears the threshold.
const KEYWORD_RULES = [
  { label: 'bug', re: /\b(crash(es|ed|ing)?|error|broken|bug|fail(s|ed|ure)?|freeze|froze|blank|stuck|not working)\b/i },
  { label: 'import-data', re: /\b(import|export|backup|restore|sync|webdav|csv|merge|replace)\b/i },
  { label: 'accessibility', re: /\b(voiceover|talkback|screen reader|contrast|font size|large text|keyboard|focus trap|accessible)\b/i },
  { label: 'performance', re: /\b(slow|lag|jank|stutter|load time|takes forever|battery)\b/i },
  { label: 'content-error', re: /\b(typo|misspell|wrong (muscle|weight|equipment|instructions?)|incorrect|mislabeled|mislabelled)\b/i },
  { label: 'exercise-request', re: /\b(add|missing|new) (an? )?exercise|exercise (request|variation|alternative)|new movement\b/i },
  { label: 'program-request', re: /\b(program|programme|plan|template|split|schedule|mesocycle|days per week)\b/i },
  { label: 'usability', re: /\b(confusing|confused|hard to use|button|tap|navigation|navigate|ux|unclear)\b/i },
];
export function localKeywordClassify(text){
  const redacted = redactTextForClassification(text);
  if(!redacted) return { label: 'other', confidence: null, source: 'local-keywords', needsReview: true };
  for(const rule of KEYWORD_RULES){
    if(rule.re.test(redacted)) return { label: rule.label, confidence: 0.55, source: 'local-keywords', needsReview: true };
  }
  return { label: 'other', confidence: null, source: 'local-keywords', needsReview: true };
}
function applyThreshold(label, confidence, threshold){
  if(label === 'other') return { label, needsReview: true };
  if(!Number.isFinite(confidence)) return { label: 'other', needsReview: true };
  if(confidence < threshold) return { label: 'other', needsReview: true };
  return { label, needsReview: false };
}
function parseSingleResult(json){
  if(!json || typeof json !== 'object') return null;
  if(Array.isArray(json.results) && json.results.length){
    const r = json.results[0];
    if(r && typeof r.label === 'string') return { label: r.label, confidence: Number(r.confidence), scores: r.scores || null };
  }
  if(typeof json.label === 'string') return { label: json.label, confidence: Number(json.confidence), scores: json.scores || null };
  return null;
}
function parseBatchResults(json, count){
  if(!json || typeof json !== 'object') return null;
  if(Array.isArray(json.results) && json.results.length === count){
    return json.results.map((r) => ({
      label: typeof r?.label === 'string' ? r.label : 'other',
      confidence: Number(r?.confidence),
      scores: r?.scores || null,
    }));
  }
  return null;
}
// Core single-text path. Always resolves; never throws into UI flows.
export async function classifyText(text, {
  labels = FEEDBACK_LABELS,
  threshold = DEFAULT_CONFIDENCE_THRESHOLD,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  tier = 'fast',
  instructions = null,
  fetchImpl = null,
} = {}){
  const labelSet = normaliseLabels(labels);
  if(!isValidLabelSet(labelSet)){
    return { ok: false, label: 'other', confidence: null, source: 'fallback-other', cloudAttempted: false, needsReview: true, error: 'Provide at least 2 labels including other.' };
  }
  const redacted = redactTextForClassification(text);
  if(!redacted){
    return { ok: true, label: 'other', confidence: null, source: 'fallback-other', cloudAttempted: false, needsReview: true };
  }
  if(!isClassifierEnabled()){
    const local = localKeywordClassify(redacted);
    return { ok: true, label: labelSet.includes(local.label) ? local.label : 'other', confidence: local.confidence, scores: null, source: local.source, cloudAttempted: false, needsReview: true };
  }
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if(!doFetch){
    return { ok: true, label: 'other', confidence: null, source: 'fallback-other', cloudAttempted: true, needsReview: true, error: 'Network unavailable.' };
  }
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try{
    const body = { labels: labelSet, inputs: [redacted], tier };
    if(instructions) body.instructions = String(instructions).slice(0, 500);
    const res = await doFetch(CLASSIFIER_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller?.signal });
    if(!res.ok){
      const msg = await res.text().catch(() => '');
      return { ok: true, label: 'other', confidence: null, source: 'fallback-other', cloudAttempted: true, needsReview: true, error: `classifier.dev ${res.status}: ${String(msg).slice(0, 120)}` };
    }
    const json = await res.json().catch(() => null);
    const parsed = parseSingleResult(json);
    if(!parsed || !labelSet.includes(parsed.label)){
      return { ok: true, label: 'other', confidence: null, source: 'fallback-other', cloudAttempted: true, needsReview: true, error: 'Unparseable classifier response.' };
    }
    const gated = applyThreshold(parsed.label, parsed.confidence, threshold);
    return { ok: true, label: gated.label, confidence: Number.isFinite(parsed.confidence) ? parsed.confidence : null, scores: parsed.scores, source: 'cloud', cloudAttempted: true, needsReview: gated.needsReview };
  }catch(err){
    const aborted = err?.name === 'AbortError';
    return { ok: true, label: 'other', confidence: null, source: 'fallback-other', cloudAttempted: true, needsReview: true, error: aborted ? 'Request timed out.' : `Request failed: ${String(err?.message || err).slice(0, 120)}` };
  }finally{ if(timer) clearTimeout(timer); }
}
// Feedback triage wrappers (same adapter, same guarantees).
export function classifyFeedback(text, opts = {}){
  return classifyText(text, { ...opts, labels: opts.labels || FEEDBACK_LABELS });
}
export function classifyIssue(text, opts = {}){
  return classifyText(text, { ...opts, labels: opts.labels || FEEDBACK_LABELS, instructions: opts.instructions || 'Issue triage for an offline-first training app. Prefer bug for crashes, import-data for backup sync CSV, content-error for wrong exercise data.' });
}
export async function classifyFeedbackBatch(texts, {
  labels = FEEDBACK_LABELS,
  threshold = DEFAULT_CONFIDENCE_THRESHOLD,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  tier = 'fast',
  instructions = null,
  fetchImpl = null,
} = {}){
  const labelSet = normaliseLabels(labels);
  if(!isValidLabelSet(labelSet)) return { ok: false, results: [], error: 'Provide at least 2 labels including other.' };
  const list = Array.isArray(texts) ? texts : [];
  const redactedList = list.map((t) => redactTextForClassification(t));
  if(!isClassifierEnabled()){
    return { ok: true, source: 'local-keywords', cloudAttempted: false, results: redactedList.map((redacted) => {
      const local = localKeywordClassify(redacted);
      return { label: labelSet.includes(local.label) ? local.label : 'other', confidence: local.confidence, source: 'local-keywords', needsReview: true, cloudAttempted: false };
    }) };
  }
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if(!doFetch){
    return { ok: true, source: 'fallback-other', cloudAttempted: true, error: 'Network unavailable.', results: redactedList.map(() => ({ label: 'other', confidence: null, source: 'fallback-other', needsReview: true, cloudAttempted: true })) };
  }
  if(!redactedList.length) return { ok: true, source: 'cloud', cloudAttempted: true, results: [] };
  const inputs = redactedList.map((r) => (r ? r : '(empty)'));
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try{
    const body = { labels: labelSet, inputs, tier };
    if(instructions) body.instructions = String(instructions).slice(0, 500);
    const res = await doFetch(CLASSIFIER_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller?.signal });
    if(!res.ok){
      const msg = await res.text().catch(() => '');
      return { ok: true, source: 'fallback-other', cloudAttempted: true, error: `classifier.dev ${res.status}: ${String(msg).slice(0, 120)}`, results: inputs.map(() => ({ label: 'other', confidence: null, source: 'fallback-other', needsReview: true, cloudAttempted: true })) };
    }
    const json = await res.json().catch(() => null);
    const parsed = parseBatchResults(json, inputs.length);
    if(!parsed){
      return { ok: true, source: 'fallback-other', cloudAttempted: true, error: 'Unparseable classifier response.', results: inputs.map(() => ({ label: 'other', confidence: null, source: 'fallback-other', needsReview: true, cloudAttempted: true })) };
    }
    return { ok: true, source: 'cloud', cloudAttempted: true, results: parsed.map((p) => {
      const label = labelSet.includes(p.label) ? p.label : 'other';
      const gated = applyThreshold(label, p.confidence, threshold);
      return { label: gated.label, confidence: Number.isFinite(p.confidence) ? p.confidence : null, scores: p.scores, source: 'cloud', cloudAttempted: true, needsReview: gated.needsReview };
    }) };
  }catch(err){
    const aborted = err?.name === 'AbortError';
    return { ok: true, source: 'fallback-other', cloudAttempted: true, error: aborted ? 'Request timed out.' : `Request failed: ${String(err?.message || err).slice(0, 120)}`, results: inputs.map(() => ({ label: 'other', confidence: null, source: 'fallback-other', needsReview: true, cloudAttempted: true })) };
  }finally{ if(timer) clearTimeout(timer); }
}
// Optional cloud AI-coach request routing. Returns a LANE, never training
// prescription: training-question -> local-engine, feedback-or-bug ->
// feedback-pipeline, other -> clarify.
export async function routeCoachRequest(text, opts = {}){
  const r = await classifyText(text, { ...opts, labels: opts.labels || COACH_ROUTE_LABELS, instructions: opts.instructions || 'Route an assistant request: training-question for how to train, feedback-or-bug for crashes complaints asks.' });
  const route = r.label === 'training-question' ? 'local-engine' : r.label === 'feedback-or-bug' ? 'feedback-pipeline' : 'clarify';
  return { ...r, route };
}
