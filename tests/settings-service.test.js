import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  acknowledgeConsentReview,
  acknowledgeWeeklyReview,
  clearEventHistoryStore,
  mergeImportedHealthSummary,
  patchPreferences,
  setConsentReviewReminder,
  setHealthSummaryConsent,
  setPulseConsent,
  setTelemetryConsent,
  setTelemetryOption,
} from '../src/services/settingsService.js';

describe('settings service store transitions', ()=>{
  it('patches preferences without touching unrelated domains', ()=>{
    const store = { version:3, history:[{ id:'h1' }], preferences:{ theme:'dark' }, gymPrefs:{ focusDefault:true } };
    const next = patchPreferences(store, { soundCues:false });
    assert.equal(next.preferences.soundCues, false);
    assert.equal(next.preferences.theme, 'dark');
    assert.deepEqual(next.history, store.history);
    assert.deepEqual(next.gymPrefs, store.gymPrefs);
    assert.notEqual(next.preferences, store.preferences);
  });

  it('sets consent flags as explicit booleans', ()=>{
    const store = { preferences:{ theme:'dark' } };
    assert.equal(setTelemetryConsent(store, true).preferences.telemetryEnabled, true);
    assert.equal(setTelemetryConsent(store, undefined).preferences.telemetryEnabled, false);
    assert.equal(setPulseConsent(store, 1).preferences.pulseEnabled, true);
    assert.equal(setPulseConsent(store, null).preferences.pulseEnabled, false);
    // later options never clobber earlier ones
    const both = setTelemetryOption(setTelemetryOption(store, 'errorDiagnostics', true), 'sessionTimings', true);
    assert.deepEqual(both.preferences.telemetryOptions, { errorDiagnostics:true, sessionTimings:true });
  });

  it('drops the saved health summary when consent is withdrawn, keeps it when granted', ()=>{
    const store = { preferences:{}, healthSummary:{ source:'health', updatedAtISO:'2026-09-01T00:00:00Z' } };
    const granted = setHealthSummaryConsent(store, true);
    assert.equal(granted.preferences.healthSummaryEnabled, true);
    assert.deepEqual(granted.healthSummary, store.healthSummary);
    const withdrawn = setHealthSummaryConsent(store, false);
    assert.equal(withdrawn.preferences.healthSummaryEnabled, false);
    assert.equal(withdrawn.healthSummary, null);
  });

  it('merges an imported health summary through one transition', ()=>{
    const store = { preferences:{ healthSummaryEnabled:true }, healthSummary:null };
    const summary = { source:'health', updatedAtISO:'2026-09-20T00:00:00Z' };
    const next = mergeImportedHealthSummary(store, summary);
    assert.deepEqual(next.healthSummary, summary);
    assert.equal(next.preferences.healthSummaryEnabled, true);
  });

  it('clears the event ledger store for replace-mode persistence', ()=>{
    const store = { history:[{ id:'h1' }], eventHistory:[{ id:'e1' }] };
    const next = clearEventHistoryStore(store);
    assert.deepEqual(next.eventHistory, []);
    assert.deepEqual(next.history, store.history);
  });

  it('manages the consent review reminder and its acknowledgement', ()=>{
    const store = { preferences:{} };
    const reminded = setConsentReviewReminder(store, true);
    assert.equal(reminded.preferences.consentReview.remind, true);
    assert.equal(reminded.preferences.consentReview.lastReviewedAt, null);
    const acked = acknowledgeConsentReview(reminded, '2026-10-01T00:00:00Z');
    assert.equal(acked.preferences.consentReview.lastReviewedAt, '2026-10-01T00:00:00Z');
    assert.equal(acked.preferences.consentReview.remind, true);
    // toggling the reminder off preserves the review timestamp
    const off = setConsentReviewReminder(acked, false);
    assert.equal(off.preferences.consentReview.remind, false);
    assert.equal(off.preferences.consentReview.lastReviewedAt, '2026-10-01T00:00:00Z');
  });

  it('acknowledges a weekly review without touching preferences', ()=>{
    const store = { preferences:{ theme:'light' }, lastWeeklyReviewAck:null };
    const next = acknowledgeWeeklyReview(store, '2026-W40');
    assert.equal(next.lastWeeklyReviewAck, '2026-W40');
    assert.deepEqual(next.preferences, store.preferences);
  });
});
