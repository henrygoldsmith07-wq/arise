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

// Settings search index: a query maps to a section id, and every section sits
// under the intent group heading it belongs to in MoreView. Pure data plus a
// pure matcher so search can be tested without rendering the view. Keywords
// are lowercase and match as substrings of "title + keywords".
export const SETTINGS_GROUPS = [
  {
    id: 'grp-profile-training',
    title: 'Profile & training',
    keywords: 'goals equipment schedule units training policy progression experience onboarding kit location level',
    sections: [
      { id: 'sec-personalise', title: 'Goals, equipment & schedule', keywords: 'goal kit location level equipment plates barbell days minutes onboarding edit profile units kg lb pounds kilograms weight' },
      { id: 'sec-policy', title: 'Training policy', keywords: 'policy conservative standard aggressive maintenance explanation confidence detail progression engine' },
    ],
  },
  {
    id: 'grp-workout-experience',
    title: 'Workout experience',
    keywords: 'gym focus behaviour rest audio sound haptics vibration guided coaching voice',
    sections: [
      { id: 'sec-gym', title: 'Gym mode', keywords: 'gym focus wake screen stay awake rest timer automatic rest presets keypad swipe one thumb cautious mode safety pain haptics vibration feedback' },
      { id: 'sec-guided', title: 'Guided mode', keywords: 'guided sound cues voice coach speech rate maximum effort warnings audio' },
    ],
  },
  {
    id: 'grp-appearance',
    title: 'Appearance & accessibility',
    keywords: 'theme dark light text contrast motion',
    sections: [
      { id: 'sec-appearance', title: 'Appearance & accessibility', keywords: 'theme dark light system text contrast motion large text high contrast reduce animation simple expert mode experience' },
    ],
  },
  {
    id: 'grp-data',
    title: 'Data',
    keywords: 'backup export import sync storage recovery csv encrypt file erase delete',
    sections: [
      { id: 'sec-backup', title: 'Backup & portability', keywords: 'backup export import csv encrypt data file json partial coach summary restore merge replace' },
      { id: 'sec-sync', title: 'Cross-device sync settings', keywords: 'sync webdav cross-device remote passphrase encryption push pull merge tombstones' },
      { id: 'sec-storage', title: 'Storage & recovery', keywords: 'storage recovery diagnostics repair archive snapshot rollback salvage quota persistent integrity migration' },
    ],
  },
  {
    id: 'grp-privacy',
    title: 'Privacy & integrations',
    keywords: 'privacy consent sharing telemetry ai coach pulse health classifier.dev integrations',
    sections: [
      { id: 'sec-privacy', title: 'Privacy & data controls', keywords: 'privacy telemetry consent measurements delete storage diagnostics demo sample data local measurements crash logs erase' },
      { id: 'sec-ai', title: 'AI coach', keywords: 'ai coach model api key insight nvidia cloud routing' },
      { id: 'sec-feedback', title: 'Feedback & issue triage', keywords: 'feedback issue report classifier categorisation category review cloud local coach routing privacy' },
      { id: 'sec-integrations', title: 'Sharing & integrations', keywords: 'pulse health platform summary connector shared consent sharing' },
    ],
  },
  {
    id: 'grp-about-advanced',
    title: 'About / advanced',
    keywords: 'about advanced expert diagnostics support legal study evidence',
    sections: [
      { id: 'sec-help', title: 'Help, about & legal', keywords: 'help about version legal disclaimers terms privacy license medical accessibility statement' },
      { id: 'sec-evidence', title: 'Progression evidence', keywords: 'evidence study research ledger metrics calibration dashboard participation join withdraw export' },
      { id: 'sec-advanced', title: 'Advanced', keywords: 'advanced expert diagnostics support bundle telemetry crash logs testing phone checklist partial export events' },
    ],
  },
];

export const SETTINGS_INDEX = SETTINGS_GROUPS.flatMap(group =>
  group.sections.map(section => ({ ...section, groupId: group.id, groupTitle: group.title }))
);

export function matchSettings(query){
  const q = String(query || '').trim().toLowerCase();
  if(!q) return [];
  return SETTINGS_INDEX.filter(s => `${s.title} ${s.keywords}`.toLowerCase().includes(q));
}
