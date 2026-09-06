// quotaGuard.js — act on quota pressure before writes start failing.
//
// storageQuota.js already measures and labels; this module adds the runtime
// behaviour the panel alone can't deliver:
//   - a one-time-per-level prompt decision ('warning' once, 'critical' once,
//     never re-nagged in the same session or for the same level)
//   - the pre-write check saveStore() calls on the critical path (sync, cheap)
//   - an automatic best-effort snapshot attempt at critical, so the last
//     healthy state is recoverable even if the user dismisses the prompt
//
// Fail-soft by contract: every export returns usable defaults on any error,
// because quota pressure is exactly when extra work can make things worse.

import { storageHealth } from './storageQuota.js';
import { captureSnapshot } from './snapshots.js';

const LEVELS = ['ok', 'evictable', 'warning', 'critical'];

/**
 * Decide whether the UI should surface a backup prompt.
 * @returns {{ shouldPrompt: boolean, level: string, reason: string|null }}
 */
export function evaluateQuotaPrompt(health, lastPromptedLevel = null){
  try {
    const level = health?.level || 'ok';
    if(!['warning', 'critical'].includes(level)) return { shouldPrompt: false, level, reason: null };
    // Escalation always re-prompts (warning -> critical). Same level in the
    // same session does not nag twice; recovery to a lower level clears it.
    if(lastPromptedLevel === level) return { shouldPrompt: false, level, reason: 'already-prompted' };
    const order = LEVELS.indexOf(level) >= LEVELS.indexOf(lastPromptedLevel || 'ok');
    if(lastPromptedLevel && !order) return { shouldPrompt: false, level, reason: 'de-escalated' };
    return { shouldPrompt: true, level, reason: level === 'critical' ? 'storage-critical' : 'storage-warning' };
  } catch {
    return { shouldPrompt: false, level: 'ok', reason: null };
  }
}

/** Best-effort critical snapshot. Resolves true when one was captured. */
export async function snapshotIfCritical(health){
  try {
    if(health?.level !== 'critical') return false;
    await captureSnapshot({ force: true, reason: 'quota-critical' });
    return true;
  } catch {
    return false; // the disk is the thing that's full; never add failure noise
  }
}

/** True when a write should proceed without blocking on a prompt. */
export function isWriteSafe(health){
  try { return health?.level !== 'critical'; } catch { return true; }
}
