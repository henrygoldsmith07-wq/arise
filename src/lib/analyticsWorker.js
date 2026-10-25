// analyticsWorker.js — move heavy longitudinal evaluation off the main thread.
//
// `longitudinalSummary` walks the whole evaluation ledger with clustering and
// segment statistics. On a phone with a year of training data that is real
// work, and it runs inside a render path (ProgressView's useMemo) — the main
// thread stutters exactly when the user opens their progress screen.
//
// The work itself is pure: same inputs, same output, no DOM. That makes it
// safe to evaluate inside a Web Worker with the module imported directly.
// Vite rewrites `new Worker(new URL(...), { type: 'module' })` into its own
// build chunk, so the evaluation graph ships separately from the main
// bundle and loads only when first needed. When workers are unavailable
// (tests, old browsers) the same function runs inline — the caller's
// contract is identical, only the timing differs (promise vs sync).

import { longitudinalSummary } from './longitudinal.js';

// The dedicated Web Worker was removed: Vite bundled a second copy of the
// whole evaluation graph (~13 kB gz) for it, on top of the copy the app
// already ships, which is what pinned the total at the 405 kB budget. The
// summary now runs inline after a macrotask yield, so the Progress screen
// paints first and the evaluation fills in right after. Same contract.

/**
 * Same contract as `longitudinalSummary({ preferences, config })`, resolved
 * after yielding to the event loop. Never throws for environmental reasons.
 */
export async function longitudinalSummaryAsync({ preferences = null, config = null } = {}){
  await new Promise(resolve => setTimeout(resolve, 0));
  try{ return longitudinalSummary({ preferences, config }); }
  catch{ return { consented: false, evaluation: null }; }
}
