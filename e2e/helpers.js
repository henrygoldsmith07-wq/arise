// e2e/helpers.js — shared, deterministic waits for optional app surfaces.
//
// WHY: this suite had 40+ one-shot `isVisible().catch(() => false)` samples
// used as GATES. A gate that reads "not visible" once, too early, skips its
// action permanently — and the two most-copied ones leave a modal up that then
// intercepts every later click. That is exactly how backup-roundtrip.spec.js
// failed intermittently: its onboarding gate sampled before rehydration, so
// onboarding opened on top of the import preview and swallowed "Apply Merge".
//
// The rule these helpers encode: to learn whether an OPTIONAL surface is
// present, WAIT for it (bounded) and then read state. Never sample once.

import { expect } from '@playwright/test';

// Long enough for the card to finish animating in (it appears within ~1s of
// onboarding completing), short enough that a profile which never shows it does
// not pay a meaningful penalty on every call.
const CONSENT_TIMEOUT = 2_000;

/**
 * Wait for onboarding to be gone and dismiss any consent card it leaves behind.
 * The pairing is what a completed first run always looks like.
 */
export async function dismissConsent(page){
  const consent = page.getByRole('dialog', { name: 'Local measurement consent' });
  await expect(consent).toBeVisible({ timeout: CONSENT_TIMEOUT }).catch(() => {});
  if (await consent.isVisible().catch(() => false)){
    await consent.getByRole('button', { name: 'No thanks' }).click();
  }
  await expect(consent).toBeHidden();
}

/**
 * Wait until the onboarding profile is durably committed to canonical
 * IndexedDB — two phases, because either one alone still races:
 *
 * Phase 1 (enqueue): poll the in-memory cache until it carries the profile.
 * React applies state immediately and persists in a post-paint effect, so a
 * bare whenPersisted() can run BEFORE that effect enqueues the save — and
 * then it drains an empty queue, resolves instantly, and proves nothing.
 * setCachedStore assigns the cache synchronously, so a truthy
 * loadStore().onboarding proves the save is at least queued.
 *
 * Phase 2 (commit): whenPersisted() drains the queue, proving IDB carries it.
 *
 * Without both, a fast reload boots profile-less and the onboarding dialog
 * reappears to intercept every later click. That is exactly how
 * friction-baseline:169 failed all three CI attempts.
 */
export async function awaitPersisted(page){
  await expect.poll(async () => page.evaluate(async () => {
    const { loadStore } = await import('/src/lib/store.js');
    return Boolean(loadStore()?.onboarding);
  }), { timeout: 10_000 }).toBe(true);
  await page.evaluate(async () => {
    const { whenPersisted } = await import('/src/lib/storage.js');
    await whenPersisted();
  });
}
