// feedbackStore.js — local-only feedback records for developer/operator triage.
//
// Feedback text is redacted and truncated before it is stored. The classifier
// request body, scores, cloud response, credentials and raw input never enter
// this store. Feedback records are deliberately separate from the training
// store, exports, study evidence and deterministic workout state.
import { CLASSIFIER_TAXONOMY_VERSION, redactTextForClassification } from './feedbackClassifier.js';

export const FEEDBACK_STORAGE_KEY = 'arise.feedback.v1';
export const MAX_FEEDBACK_RECORDS = 100;

function storage(){
  try{ return typeof localStorage !== 'undefined' ? localStorage : null; }catch{ return null; }
}

function makeId(){
  try{
    if(typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  }catch{}
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function isRecord(value){
  return Boolean(value && typeof value === 'object' && typeof value.id === 'string');
}

function safeRecord(value){
  if(!isRecord(value)) return null;
  return {
    id: value.id.slice(0, 120),
    redactedText: redactTextForClassification(value.redactedText),
    category: typeof value.category === 'string' ? value.category.slice(0, 80) : 'other',
    confidence: Number.isFinite(value.confidence) ? value.confidence : null,
    needsReview: value.needsReview === true,
    source: typeof value.source === 'string' ? value.source.slice(0, 40) : 'fallback-other',
    classifiedAt: typeof value.classifiedAt === 'string' ? value.classifiedAt : null,
    taxonomyVersion: Number.isInteger(value.taxonomyVersion) ? value.taxonomyVersion : CLASSIFIER_TAXONOMY_VERSION,
    cloudAttempted: value.cloudAttempted === true,
    submittedAt: typeof value.submittedAt === 'string' ? value.submittedAt : null,
    reviewedAt: typeof value.reviewedAt === 'string' ? value.reviewedAt : null,
  };
}

export function loadFeedbackRecords(){
  const s = storage();
  if(!s) return [];
  try{
    const parsed = JSON.parse(s.getItem(FEEDBACK_STORAGE_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.map(safeRecord).filter(Boolean).slice(0, MAX_FEEDBACK_RECORDS)
      : [];
  }catch{ return []; }
}

export function buildFeedbackRecord({ text, classification = {}, submittedAt = new Date().toISOString(), id = null } = {}){
  const redactedText = redactTextForClassification(text);
  const confidence = Number.isFinite(classification.confidence) ? classification.confidence : null;
  return {
    id: id || makeId(),
    redactedText,
    category: typeof classification.label === 'string' ? classification.label : 'other',
    confidence,
    needsReview: classification.needsReview === true,
    source: typeof classification.source === 'string' ? classification.source : 'fallback-other',
    classifiedAt: typeof classification.classifiedAt === 'string' ? classification.classifiedAt : submittedAt,
    taxonomyVersion: Number.isInteger(classification.taxonomyVersion) ? classification.taxonomyVersion : CLASSIFIER_TAXONOMY_VERSION,
    cloudAttempted: classification.cloudAttempted === true,
    submittedAt,
    reviewedAt: null,
  };
}

export function saveFeedbackRecord(record){
  if(!isRecord(record)) return false;
  const safe = safeRecord(record);
  if(!safe) return false;
  const s = storage();
  if(!s) return false;
  try{
    const next = [safe, ...loadFeedbackRecords().filter((item) => item.id !== safe.id)].slice(0, MAX_FEEDBACK_RECORDS);
    s.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(next));
    return true;
  }catch{ return false; }
}

export function markFeedbackReviewed(id, reviewedAt = new Date().toISOString()){
  const records = loadFeedbackRecords();
  const index = records.findIndex((record) => record.id === id);
  if(index < 0) return false;
  records[index] = { ...records[index], reviewedAt };
  const s = storage();
  if(!s) return false;
  try{ s.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(records)); return true; }catch{ return false; }
}

// Build the only payload the UI may offer to an external share action. This
// is deliberately separate from the local queue record: no id, timestamps,
// scores, classifier response, training data, readiness, study identity or
// credentials can cross the sharing boundary.
export function buildFeedbackSharePayload(record, { appVersion = null } = {}){
  const safe = safeRecord(record);
  if(!safe) return null;
  return {
    feedback: safe.redactedText,
    category: safe.category,
    confidence: safe.confidence,
    needsReview: safe.needsReview,
    appVersion: typeof appVersion === 'string' && appVersion.trim() ? appVersion.trim().slice(0, 32) : null,
  };
}

export function formatFeedbackSharePayload(payload){
  if(!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  return JSON.stringify(payload, null, 2);
}

export function clearFeedbackRecords(){
  try{ storage()?.removeItem(FEEDBACK_STORAGE_KEY); }catch{}
}
