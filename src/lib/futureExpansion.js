// futureExpansion.js — audited expansion candidates (Y-round deferred items).
//
// Every item below was evaluated against the existing architecture (see
// docs/ARCHITECTURE_EXPANSION.md for the full rationale). The module is
// deliberately inert: it documents decisions, carries no imports, and exists
// so the roadmap has a machine-readable anchor beside the prose doc.

export const DEFERRED = [
  {
    id: 'wearable-read-only',
    title: 'Read-only wearable integration',
    verdict: 'defer',
    reason: 'Requires platform APIs (HealthKit/Health Connect) only reachable via the optional Capacitor wrapper; privacy cost needs its own consent design.',
  },
  {
    id: 'watch-companion',
    title: 'Watch companion for the rest timer',
    verdict: 'defer',
    reason: 'Native-only surface; the PWA already covers rest cues via audio/haptics/wake lock. Revisit after the wrapper ships.',
  },
  {
    id: 'multi-profile',
    title: 'Multi-profile local support',
    verdict: 'defer',
    reason: 'Cross-cutting: every store surface and the sync merge assume one owner. Isolation must be designed at the storage layer first.',
  },
  {
    id: 'plugin-architecture',
    title: 'Plugin architecture (analytics / health adapters)',
    verdict: 'defer',
    reason: 'The adapter bag in core/container.js is the seam plugins would use; a manifest + permission model deserves its own ADR.',
  },
  {
    id: 'community-program-library',
    title: 'Community program library',
    verdict: 'defer',
    reason: 'Share codes solve one-to-one sharing without a server; a public library implies moderation and hosting commitments.',
  },
  {
    id: 'white-label',
    title: 'White-label engine packaging',
    verdict: 'defer',
    reason: 'The engine is already import-clean and React-free; packaging is a build/config task, not a feature — wait for an actual consumer.',
  },
  {
    id: 'hands-free-mode',
    title: 'Full hands-free mode',
    verdict: 'partial',
    reason: 'Voice set logging ships in this round (voiceInput.js); full navigation-by-voice needs broader a11y validation before it can be honest.',
  },
];

export const NEAR_TERM = [
  { id: 'healthkit-adapter', title: 'Optional HealthKit summary adapter', status: 'planned', note: 'Follows the existing health-summary consent isolation; wrapper-gated.' },
  { id: 'googlefit-adapter', title: 'Optional Google Fit summary adapter', status: 'planned', note: 'Same shape as the HealthKit adapter; shares the consent gate.' },
  { id: 'periodization-builder', title: 'Advanced periodization builder', status: 'exploring', note: 'mesocycle.js already models blocks; a UI over block params is the gap.' },
  { id: 'program-sharing', title: 'Program/template sharing', status: 'shipped', note: 'shareCodes.js — checksummed, URI-safe, ID-regenerating.' },
  { id: 'coach-export', title: 'Coach-facing export', status: 'shipped', note: 'coachExport.js + printReport.js (print/save-as-PDF).' },
  { id: 'voice-input', title: 'Voice input for set logging', status: 'shipped', note: 'voiceInput.js + per-block mic in the runner.' },
  { id: 'csv-importers', title: 'Importer from common CSV formats', status: 'shipped', note: 'appCsvImport.js — loose column matching, lb→kg, unknown-name reporting.' },
];
