// feedbackClassifier.js — conservative, opt-in classifier.dev adapter.
// Real uses only: (1) user-feedback categorisation via classifyFeedback
// (MoreView feedback triage), (2) optional AI-coach intent routing via
// routeCoachRequest (deterministic intent rules live in aiCoachRoute; this
// module is the semantic fallback). The classifier may select a LANE only —
// it never produces a training prescription. classifyIssue and
// classifyFeedbackBatch were removed: no production caller, no dead
// infrastructure.
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
export const CONFIDENCE_REVIEW_THRESHOLD = 0.60;
export const CONFIDENCE_AUTO_ACCEPT_THRESHOLD = 0.80;
export const MAX_TIMEOUT_MS = 8000;
export const FEEDBACK_LABEL_DESCRIPTIONS = Object.freeze({
  bug: 'a bug, crash, broken feature, or failure',
  'exercise-request': 'request for a new exercise or exercise variation',
  'program-request': 'request for a new programme, plan, template, or training split',
  usability: 'difficulty using the app or an unclear interface',
  'content-error': 'incorrect exercise or training information',
  accessibility: 'accessibility problem or assistive technology issue',
  performance: 'slow, laggy, or resource-heavy app behaviour',
  'import-data': 'problem importing, exporting, restoring, backing up, or syncing data',
  other: 'none of these categories',
});
export const COACH_ROUTE_LABEL_DESCRIPTIONS = Object.freeze({
  'training-question': 'a question about how to train or use the local training coach',
  'feedback-or-bug': 'feedback, a complaint, or a bug report about the app',
  other: 'none of these requests or an uncertain request',
});
export const FEEDBACK_INSTRUCTIONS = 'Categorise feedback for product issue triage only. Never infer training prescriptions, readiness, safety, treatment, study assignment, or causal conclusions.';
export const COACH_ROUTING_INSTRUCTIONS = 'Route an assistant request to a lane only. Never generate or modify a workout, progression, substitution, safety decision, treatment, study assignment, or causal analysis.';
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
  text = text.replace(/bearer\s+[a-z0-9._~-]+/gi, 'bearer [redacted-secret]');
  text = text.replace(/\b(?:api[_ -]?key|secret|token|password|authorization)\s*[:=]\s*\S+/gi, '[redacted-secret]');
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
function normaliseLabelText(value){
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}
function descriptionForLabel(label){
  return FEEDBACK_LABEL_DESCRIPTIONS[label]
    || COACH_ROUTE_LABEL_DESCRIPTIONS[label]
    || String(label).replace(/[-_]+/g, ' ');
}
function externalLabels(labelSet){
  return labelSet.map(descriptionForLabel);
}
function internalLabelFor(value, labelSet){
  const normalised = normaliseLabelText(value);
  if(!normalised) return null;
  return labelSet.find((label) => (
    normaliseLabelText(label) === normalised
    || normaliseLabelText(descriptionForLabel(label)) === normalised
  )) || null;
}
function safeScores(scores, labelSet){
  if(!scores || typeof scores !== 'object' || Array.isArray(scores)) return null;
  const out = {};
  for(const [key, value] of Object.entries(scores)){
    const label = internalLabelFor(key, labelSet);
    if(label && typeof value === 'number' && Number.isFinite(value)) out[label] = value;
  }
  return Object.keys(out).length ? out : null;
}
function parseResultEntry(result, labelSet){
  if(!result || typeof result !== 'object' || typeof result.label !== 'string') return null;
  const label = internalLabelFor(result.label, labelSet);
  const confidence = typeof result.confidence === 'number' ? result.confidence : null;
  if(!label || !Number.isFinite(confidence)) return null;
  return { label, confidence, scores: safeScores(result.scores, labelSet) };
}
function parseSingleResult(json, labelSet){
  if(!json || typeof json !== 'object') return null;
  if(Array.isArray(json.results) && json.results.length) return parseResultEntry(json.results[0], labelSet);
  return parseResultEntry(json, labelSet);
}
function applyConfidenceBands(label, confidence){
  if(label === 'other') return { label: 'other', needsReview: true };
  if(!Number.isFinite(confidence) || confidence < 0 || confidence > 1 || confidence < CONFIDENCE_REVIEW_THRESHOLD){
    return { label: 'other', needsReview: true };
  }
  if(confidence < CONFIDENCE_AUTO_ACCEPT_THRESHOLD) return { label, needsReview: true };
  return { label, needsReview: false };
}
function safeTimeout(timeoutMs){
  const numeric = Number(timeoutMs);
  if(!Number.isFinite(numeric)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(1, Math.floor(numeric)));
}
function safeTier(tier){
  return tier === 'smart' ? 'smart' : 'fast';
}
function safeInstructions(instructions, fallback){
  if(instructions == null) return fallback;
  return redactTextForClassification(instructions) || fallback;
}
function bodyWithLabels(labelSet, inputs, tier, instructions, fallbackInstructions){
  return {
    labels: externalLabels(labelSet),
    inputs,
    tier: safeTier(tier),
    instructions: safeInstructions(instructions, fallbackInstructions),
  };
}
function localCoachRouteClassify(text){
  const redacted = redactTextForClassification(text);
  if(!redacted) return { label: 'other', confidence: null, source: 'local-keywords', needsReview: true };
  if(/\b(crash|error|broken|bug|complaint|feedback|not working|issue)\b/i.test(redacted)){
    return { label: 'feedback-or-bug', confidence: 0.9, source: 'local-keywords', needsReview: false };
  }
  if(/\b(how|what|should|progress|train|training|workout|exercise|squat|bench|deadlift)\b/i.test(redacted)){
    return { label: 'training-question', confidence: 0.9, source: 'local-keywords', needsReview: false };
  }
  return { label: 'other', confidence: null, source: 'local-keywords', needsReview: true };
}
function localClassifyForLabels(text, labelSet){
  const local = labelSet.includes('training-question') && labelSet.includes('feedback-or-bug')
    ? localCoachRouteClassify(text)
    : localKeywordClassify(text);
  return {
    label: labelSet.includes(local.label) ? local.label : 'other',
    confidence: local.confidence,
    scores: null,
    source: local.source,
    cloudAttempted: false,
    needsReview: local.needsReview,
  };
}
function fallbackResult({ cloudAttempted = true, error = null } = {}){
  return {
    ok: true,
    label: 'other',
    confidence: null,
    scores: null,
    source: 'fallback-other',
    cloudAttempted,
    needsReview: true,
    ...(error ? { error } : {}),
  };
}
// Core single-text path. Always resolves; never throws into UI flows.
export async function classifyText(text, {
  labels = FEEDBACK_LABELS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  tier = 'fast',
  instructions = null,
  fetchImpl = null,
} = {}){
  const labelSet = normaliseLabels(labels);
  if(!isValidLabelSet(labelSet)){
    return { ok: false, ...fallbackResult({ cloudAttempted: false }), error: 'Provide at least 2 labels including other.' };
  }
  const redacted = redactTextForClassification(text);
  if(!redacted) return { ok: true, ...fallbackResult({ cloudAttempted: false }) };
  if(!isClassifierEnabled()){
    return { ok: true, ...localClassifyForLabels(redacted, labelSet) };
  }
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if(!doFetch){
    return fallbackResult({ cloudAttempted: true, error: 'Network unavailable.' });
  }
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), safeTimeout(timeoutMs)) : null;
  try{
    const body = bodyWithLabels(labelSet, [redacted], tier, instructions, FEEDBACK_INSTRUCTIONS);
    const res = await doFetch(CLASSIFIER_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller?.signal });
    if(!res.ok){
      const msg = await res.text().catch(() => '');
      return { ok: true, label: 'other', confidence: null, source: 'fallback-other', cloudAttempted: true, needsReview: true, error: `classifier.dev ${res.status}: ${String(msg).slice(0, 120)}` };
    }
    const json = await res.json().catch(() => null);
    const parsed = parseSingleResult(json, labelSet);
    if(!parsed){
      return { ok: true, label: 'other', confidence: null, source: 'fallback-other', cloudAttempted: true, needsReview: true, error: 'Unparseable classifier response.' };
    }
    const gated = applyConfidenceBands(parsed.label, parsed.confidence);
    return { ok: true, label: gated.label, confidence: parsed.confidence, scores: parsed.scores, source: 'cloud', cloudAttempted: true, needsReview: gated.needsReview };
  }catch(err){
    const aborted = err?.name === 'AbortError';
    return { ok: true, label: 'other', confidence: null, source: 'fallback-other', cloudAttempted: true, needsReview: true, error: aborted ? 'Request timed out.' : `Request failed: ${String(err?.message || err).slice(0, 120)}` };
  }finally{ if(timer) clearTimeout(timer); }
}
// Feedback triage wrapper (same adapter, same guarantees). Called by the
// MoreView feedback form; classifyIssue/classifyFeedbackBatch were removed
// (no production callers) rather than left as dead infrastructure.
export function classifyFeedback(text, opts = {}){
  return classifyText(text, { ...opts, labels: opts.labels || FEEDBACK_LABELS, instructions: opts.instructions ?? FEEDBACK_INSTRUCTIONS });
}
// Optional cloud AI-coach request routing. Returns a LANE, never training
// prescription: training-question -> local-engine, feedback-or-bug ->
// feedback-pipeline, other -> clarify.
export async function routeCoachRequest(text, opts = {}){
  const r = await classifyText(text, { ...opts, labels: opts.labels || COACH_ROUTE_LABELS, instructions: opts.instructions ?? COACH_ROUTING_INSTRUCTIONS });
  const route = r.needsReview ? 'clarify' : r.label === 'training-question' ? 'local-engine' : r.label === 'feedback-or-bug' ? 'feedback-pipeline' : 'clarify';
  return { ...r, route };
}
