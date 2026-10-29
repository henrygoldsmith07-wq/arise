import { test, expect } from '@playwright/test';
import { awaitPersisted } from './helpers.js';

// Per-lift setup notes (seat, pin, grip, angle): written from the runner,
// shown under the target, kept across reloads, and flagged when it differs
// from what was logged last time.

async function completeOnboarding(page){
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /Get stronger/i }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Gym' }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByLabel(/Dumbbells/i).click();
  await page.getByLabel(/Bench/i).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Intermediate' }).click();
  await page.getByRole('button', { name: '3×' }).click();
  await page.getByRole('button', { name: '45 min' }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: /Save & continue/i }).click();
  await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeHidden();
  // Drain the profile commit before anything reloads: a reload that beats it
  // boots profile-less and the onboarding dialog reappears to intercept
  // later clicks (same race as friction-baseline:169).
  await awaitPersisted(page);
}

async function startWorkout(page){
  await page.getByRole('button', { name: 'Train' }).click();
  const recCard = page.locator('[aria-label="Recommended for you"]');
  if (await recCard.getByRole('button', { name: 'Start programme' }).isVisible().catch(() => false)) {
    await recCard.getByRole('button', { name: 'Start programme' }).click();
  } else {
    await page.getByRole('button', { name: 'Browse programmes' }).click();
    const generateBtn = page.getByRole('button', { name: /Generate from profile/i });
    if (await generateBtn.isVisible()) { await generateBtn.click(); await page.waitForTimeout(300); }
    const scheduleBtn = page.getByRole('button', { name: /Schedule this program/i });
    if (await scheduleBtn.isVisible()) await scheduleBtn.click();
  }
  await expect(page.locator('[aria-label="Current programme"]')).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  const startBtn = page.getByRole('button', { name: /Start workout|Start this session/ }).first();
  if (await startBtn.isVisible()) await startBtn.click();
  const runner = page.getByRole('dialog', { name: /Session —/ });
  await expect(runner).toBeVisible({ timeout: 8000 });
  return runner;
}


test('a setup note written in the runner shows on the lift, persists, and can be cleared', async ({ page }) => {
  await completeOnboarding(page);
  const runner = await startWorkout(page);
  const open = runner.locator('[data-testid^="setup-open-"]').first();
  await expect(open).toBeVisible();
  const box = await open.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(43);
  const testId = await open.getAttribute('data-testid');
  const exerciseId = testId.replace('setup-open-', '');

  await open.click();
  const sheet = page.getByTestId('setup-sheet');
  await expect(sheet).toBeVisible();
  await page.getByTestId('setup-seat').fill('4');
  await page.getByTestId('setup-pin').fill('pin 3');
  await page.getByTestId('setup-save').click();
  await expect(sheet).toBeHidden();
  await expect(runner.getByTestId(`setup-text-${exerciseId}`)).toHaveText('Seat 4 · Pin pin 3');

  await awaitPersisted(page);
  const stored = await page.evaluate(async (id) => {
    const { loadStore } = await import('/src/lib/store.js');
    return loadStore().gymPrefs?.setupNotes?.[id] || null;
  }, exerciseId);
  expect(stored.seat).toBe('4');
  expect(stored.pin).toBe('pin 3');

  // Survives a reload (the draft resumes; the note comes from gymPrefs).
  await page.reload();
  const resumed = page.getByRole('dialog', { name: /Session —/ });
  if (!(await resumed.isVisible().catch(() => false))) await startWorkout(page);
  await expect(page.getByTestId(`setup-text-${exerciseId}`)).toHaveText('Seat 4 · Pin pin 3');

  // Clear removes the line and keeps a tombstone for sync.
  await page.getByTestId(`setup-open-${exerciseId}`).click();
  await page.getByTestId('setup-clear').click();
  await expect(page.getByTestId(`setup-text-${exerciseId}`)).toHaveCount(0);
  await awaitPersisted(page);
  const cleared = await page.evaluate(async (id) => {
    const { loadStore } = await import('/src/lib/store.js');
    return loadStore().gymPrefs?.setupNotes?.[id] || null;
  }, exerciseId);
  expect(cleared.seat).toBeUndefined();
  expect(typeof cleared.updatedAt).toBe('string');
});

test('the runner says when the setup changed since the last logged session', async ({ page }) => {
  await completeOnboarding(page);
  const runner = await startWorkout(page);
  const exerciseId = (await runner.locator('[data-testid^="setup-open-"]').first().getAttribute('data-testid')).replace('setup-open-', '');
  await page.evaluate(async (id) => {
    const { loadStore, saveStore } = await import('/src/lib/store.js');
    const store = loadStore();
    const now = new Date().toISOString();
    saveStore({
      ...store,
      gymPrefs: { ...(store.gymPrefs || {}), restPresets: store.gymPrefs?.restPresets || {}, setupNotes: { [id]: { seat: '5', updatedAt: now } }, updatedAt: now },
      history: [...(store.history || []), {
        id: 'setup-prev', dateISO: '2026-10-01', savedAt: '2026-10-01T10:00:00Z', title: 'Upper',
        blocks: [{ exerciseId: id, setup: 'Seat 3', sets: [{ reps: '10', weightKg: '40', rpe: '8', completed: true }] }],
      }],
    });
  }, exerciseId);
  await awaitPersisted(page);
  await page.reload();
  const again = page.getByRole('dialog', { name: /Session —/ });
  if (!(await again.isVisible().catch(() => false))) await startWorkout(page);
  await expect(page.getByTestId(`setup-changed-${exerciseId}`)).toContainText('was Seat 3');
});
