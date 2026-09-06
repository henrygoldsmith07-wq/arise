// experienceMode.js — user-selected experience level.
//
// Arise's analytics grew deep: confidence bands, backtests, calibration
// curves, evidence dashboards. Power users live there; everyone else should
// never have to parse them. This gate is the product's honesty valve:
//
//   simple    — the number and one line of plain language
//   standard  — the default: context, trends, weekly review
//   expert    — everything: backtest metrics, calibration, segments
//
// It is a DISPLAY gate only — the same engine runs underneath, the same
// data is stored and exportable either way, and nothing is ever hidden from
// the export or the evidence ledger. Disclosure, not removal.

export const EXPERIENCE_LEVELS = ['simple', 'standard', 'expert'];

export const EXPERIENCE_INFO = {
  simple: { label: 'Simple', hint: 'The essentials — today’s session, progress, streaks.' },
  standard: { label: 'Standard', hint: 'Trends, weekly review, volume balance, PRs.' },
  expert: { label: 'Expert', hint: 'Everything: backtests, calibration, evidence segments.' },
};

/** Resolve the effective level; 'standard' is the default and the fallback. */
export function resolveExperience(preferences){
  const v = preferences?.experience;
  return EXPERIENCE_LEVELS.includes(v) ? v : 'standard';
}

/** Do the expert-only analytics render at this level? */
export function isExpertView(preferences){
  return resolveExperience(preferences) === 'expert';
}

/** Does the condensed, essentials-first render apply? */
export function isSimpleView(preferences){
  return resolveExperience(preferences) === 'simple';
}

/** Clamp arbitrary input to a valid level (preferences writes go through this). */
export function experiencePatch(next){
  return { experience: EXPERIENCE_LEVELS.includes(next) ? next : 'standard' };
}
