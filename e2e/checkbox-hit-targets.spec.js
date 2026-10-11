import { test, expect } from '@playwright/test';
import { measureHitArea, gateVerdict } from './hit-target.js';

// Touch-target regression gate for CONTROLS THAT ARE NOT BUTTONS.
//
// Every existing 44px gate targets role="button", so checkboxes, radios and
// selects escape them. The onboarding equipment tiles proved the gap: all nine
// were a bare 13x13 box — an order of magnitude under the app's own 44px
// standard, in the first-run flow, and a real cause of a click flake in
// perf.spec.js. The whole tile is now the hit target; this pins that.
//
// Onboarding is the right place to gate it: it is the flow with the densest
// checkbox grid and the least user tolerance for a missed tap.

const KIT_STEP = async (page) => {
  await page.goto('/');
  await page.evaluate(() => new Promise((resolve) => {
    localStorage.clear();
    sessionStorage.clear();
    try{
      const r = indexedDB.deleteDatabase('arise-idb-v1');
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    }catch{ resolve(); }
  }));
  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Onboarding' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: /Feel better/i }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /Gym/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByLabel(/Dumbbells/i)).toBeVisible({ timeout: 10_000 });
};

test.describe('checkbox touch targets', () => {
  test('every onboarding equipment checkbox has a 44px effective hit area', async ({ page }) => {
    await KIT_STEP(page);

    const boxes = page.locator('input[type="checkbox"]');
    const n = await boxes.count();
    expect(n, 'the kit step offers equipment checkboxes').toBeGreaterThan(0);

    for (let i = 0; i < n; i++){
      const cb = boxes.nth(i);
      const name = await cb.evaluate((el) => (el.closest('label')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40));
      const measured = await measureHitArea(page, cb);
      const verdict = gateVerdict(measured);
      expect(verdict, `"${name}" is ${Math.round(measured.w)}x${Math.round(measured.h)} → ${verdict}`).toBe('pass');
    }
  });

  test('the checkbox tile still toggles and stays keyboard reachable', async ({ page }) => {
    await KIT_STEP(page);

    const dumbbells = page.getByLabel(/Dumbbells/i);
    await expect(dumbbells).not.toBeChecked();
    await dumbbells.click();
    await expect(dumbbells).toBeChecked();

    // Toggle back off, then drive it from the keyboard.
    await dumbbells.click();
    await expect(dumbbells).not.toBeChecked();
    await dumbbells.focus();
    await page.keyboard.press('Space');
    await expect(dumbbells).toBeChecked();

    // The visual state follows the input, and the input is still focusable
    // (an opacity-0 input that lost focusability would pass the click test).
    const hasName = await dumbbells.evaluate((el) => !!(el.labels && el.labels.length));
    expect(hasName, 'the checkbox keeps an associated label').toBe(true);
  });

  // The More tab holds the densest settings clusters: every ToggleRow, the
  // sync switch, the encryption switch and the backup Merge/Replace radios.
  // Each of those was once a ~13px native control; all now go through the
  // shared .check-control class, so one gate covers all of them.
  test('every checkbox and radio on the More tab meets the 44px gate', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => new Promise((resolve) => {
      localStorage.clear();
      sessionStorage.clear();
      try{
        const r = indexedDB.deleteDatabase('arise-idb-v1');
        r.onsuccess = r.onerror = r.onblocked = () => resolve();
      }catch{ resolve(); }
    }));
    await page.reload();

    const dialog = page.getByRole('dialog', { name: 'Onboarding' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: /Explore with sample data/i }).click();
    await expect(page.getByRole('region', { name: 'Demo mode banner' })).toBeVisible();

    await page.getByRole('button', { name: 'More', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'More' })).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);

    const boxes = page.locator('input[type="checkbox"]:visible, input[type="radio"]:visible');
    const n = await boxes.count();
    expect(n, 'settings expose checkboxes or radios').toBeGreaterThan(0);

    for (let i = 0; i < n; i++){
      const cb = boxes.nth(i);
      const name = await cb.evaluate((el) => (el.closest('label')?.innerText || el.getAttribute('aria-label') || '(unnamed)').replace(/\s+/g, ' ').trim().slice(0, 45));
      const measured = await measureHitArea(page, cb);
      const verdict = gateVerdict(measured);
      expect(verdict, `"${name}" is ${Math.round(measured.w)}x${Math.round(measured.h)} → ${verdict}`).toBe('pass');
    }
  });
});
