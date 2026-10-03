// Settings and consent state transitions. UI surfaces describe intent;
// these pure store transitions own the shape of the change, so a preference,
// consent or acknowledgement write can never drift between call sites and
// never reads a stale snapshot it built by spread.

export function patchPreferences(store, patch){
  return { ...store, preferences:{ ...(store?.preferences || {}), ...(patch || {}) } };
}

export function patchAccessibility(store, patch){
  const preferences = store?.preferences || {};
  return {
    ...store,
    preferences:{
      ...preferences,
      accessibility:{ ...(preferences.accessibility || {}), ...(patch || {}) },
    },
  };
}

export function patchGymPreferences(store, patch){
  return { ...store, gymPrefs:{ ...(store?.gymPrefs || {}), ...(patch || {}) } };
}

// Consent toggles cross the persistence and telemetry boundaries (a consent
// event is recorded alongside the store write), so they live here rather than
// in an inline `setStore({ ...store, ... })`.
export function setTelemetryConsent(store, enabled){
  return patchPreferences(store, { telemetryEnabled: Boolean(enabled) });
}

export function setPulseConsent(store, enabled){
  return patchPreferences(store, { pulseEnabled: Boolean(enabled) });
}

// Turning health-summary consent off also drops the saved summary: nothing
// the user withdrew consent for stays on the device.
export function setHealthSummaryConsent(store, enabled){
  const on = Boolean(enabled);
  const next = patchPreferences(store, { healthSummaryEnabled: on });
  return { ...next, healthSummary: on ? (store?.healthSummary ?? null) : null };
}

export function mergeImportedHealthSummary(store, summary){
  return { ...store, healthSummary: summary };
}

// Telemetry clearing is destructive for the event ledger: the store's
// eventHistory collection is emptied and persisted in replace mode so a later
// merge cannot resurrect cleared rows from another device's copy.
export function clearEventHistoryStore(store){
  return { ...store, eventHistory: [] };
}

export function setTelemetryOption(store, option, enabled){
  const preferences = store?.preferences || {};
  return patchPreferences(store, {
    telemetryOptions:{ ...(preferences.telemetryOptions || {}), [option]: enabled === true },
  });
}

export function setConsentReviewReminder(store, remind){
  const preferences = store?.preferences || {};
  return patchPreferences(store, {
    consentReview:{ ...(preferences.consentReview || {}), remind: remind === true, lastReviewedAt: preferences.consentReview?.lastReviewedAt || null },
  });
}

export function acknowledgeConsentReview(store, atISO = new Date().toISOString()){
  const preferences = store?.preferences || {};
  return patchPreferences(store, {
    consentReview:{ ...(preferences.consentReview || {}), lastReviewedAt: atISO },
  });
}

export function acknowledgeWeeklyReview(store, ackKey){
  return { ...store, lastWeeklyReviewAck: ackKey };
}
