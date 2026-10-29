import { test, expect } from '@playwright/test';
import { dismissConsent } from './helpers.js';

// Block plan e2e: onboard → Train → Block plan → turn week 2 into a deload
// (sets drop, badge shows) → add a week → reload → still there → make week 2
// normal again → original set count returns.

async function completeOnboarding(page){
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => new Promise(resolve => {
    try{
      const req = indexedDB.deleteDatabase('arise-idb-v1');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    }catch{ resolve(); }
  }));
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /Feel better/i }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /Gym/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel(/Bodyweight/i).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Beginner', exact: true }).click();
  await page.getByRole('button', { name: /3\u00d7/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /Save & continue/i }).click();
  await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeHidden();
  await dismissConsent(page);
}

async function ensureProgramme(page){
  await page.getByRole('button', { name: 'Train', exact: true }).click();
  const current = page.locator('[aria-label="Current programme"]');
  const recCard = page.locator('[aria-label="Recommended for you"]');
  await expect(current.or(recCard)).toBeVisible({ timeout: 8_000 });
  if(!(await current.isVisible().catch(() => false))){
    await recCard.getByRole('button', { name: 'Start programme' }).click();
  }
  await expect(current).toBeVisible({ timeout: 8_000 });
}

const weekSets = (page, week) => page.evaluate(async (w) => {
  const { loadStore } = await import('/src/lib/store.js');
  return (loadStore().activeSchedule?.sessions || []).filter(s => s.week === w)
    .reduce((n, s) => n + s.blocks.reduce((a, b) => a + (Number(b.sets) || 0), 0), 0);
}, week);

test.describe('Block plan', () => {
  test('deload a week, add a week, reload, restore', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await completeOnboarding(page);
    await ensureProgramme(page);

    await page.getByRole('button', { name: /^Block plan/ }).click();
    const plan = page.getByRole('dialog', { name: 'Block plan' });
    await expect(plan).toBeVisible({ timeout: 8_000 });
    await expect(plan.getByRole('region', { name: 'Week 1' })).toBeVisible();
    await expect(plan.getByRole('region', { name: 'Week 2' })).toBeVisible();

    const original = await weekSets(page, 2);
    expect(original).toBeGreaterThan(0);

    // Deload week 2: badge appears and the schedule's sets drop.
    await plan.getByRole('button', { name: 'Make week 2 a deload week' }).click();
    await expect(plan.getByRole('region', { name: 'Week 2' }).getByText('Deload', { exact: true })).toBeVisible();
    await expect.poll(() => weekSets(page, 2)).toBeLessThan(original);

    // Add a week: week 3 appears, flagged Added.
    await plan.getByRole('button', { name: 'Add a week' }).click();
    await expect(plan.getByRole('region', { name: 'Week 3' })).toBeVisible();
    await expect(plan.getByRole('region', { name: 'Week 3' })).toContainText('Added');
    await expect(plan.getByRole('status')).toContainText('Added week 3');

    // 44px targets at 390px.
    const box = await plan.getByRole('button', { name: 'Add a week' }).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);

    // Survives a reload.
    await plan.getByRole('button', { name: 'Close block plan' }).click();
    await expect(plan).toBeHidden();
    await page.evaluate(async () => { const { whenPersisted } = await import('/src/lib/storage.js'); await whenPersisted(); });
    await page.reload();
    await page.getByRole('button', { name: 'Train', exact: true }).click();
    await page.getByRole('button', { name: /^Block plan/ }).click();
    const again = page.getByRole('dialog', { name: 'Block plan' });
    await expect(again.getByRole('region', { name: 'Week 3' })).toBeVisible({ timeout: 8_000 });
    await expect(again.getByRole('region', { name: 'Week 2' }).getByText('Deload', { exact: true })).toBeVisible();

    // Make week 2 normal: exact original sets are back.
    await again.getByRole('button', { name: 'Make week 2 a normal week' }).click();
    await expect(again.getByRole('region', { name: 'Week 2' }).getByText('Deload', { exact: true })).toBeHidden();
    await expect.poll(() => weekSets(page, 2)).toBe(original);

    // Remove added week.
    await again.getByRole('button', { name: 'Remove added week' }).click();
    await expect(again.getByRole('region', { name: 'Week 3' })).toBeHidden();
  });
});
