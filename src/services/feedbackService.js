import { getAppVersion } from '../lib/exportPolicy.js';
import { CLASSIFIER_TAXONOMY_VERSION, classifyFeedback, redactTextForClassification } from '../lib/feedbackClassifier.js';
import { buildFeedbackRecord, buildFeedbackSharePayload, formatFeedbackSharePayload, loadFeedbackRecords, markFeedbackReviewed, saveFeedbackRecord } from '../lib/feedbackStore.js';

export async function classifyAndSaveFeedback(text){
  const redacted = redactTextForClassification(text);
  if(!redacted) throw new Error('Enter a short issue or piece of feedback first.');
  const classifiedAt = new Date().toISOString();
  const classification = await classifyFeedback(text);
  const record = buildFeedbackRecord({
    text,
    submittedAt: classifiedAt,
    classification:{ ...classification, classifiedAt, taxonomyVersion:CLASSIFIER_TAXONOMY_VERSION },
  });
  if(!saveFeedbackRecord(record)) throw new Error('Could not save feedback on this device.');
  return { record, records:loadFeedbackRecords() };
}

export function reviewFeedback(id){
  if(markFeedbackReviewed(id)) return loadFeedbackRecords();
  return loadFeedbackRecords();
}

export function feedbackShareText(record){
  const payload = buildFeedbackSharePayload(record, { appVersion:getAppVersion() || '0.1.0' });
  return payload ? formatFeedbackSharePayload(payload) : null;
}
