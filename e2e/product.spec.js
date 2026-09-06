import { test, expect } from '@playwright/test';

// Product-strategy e2e: the demo mode lifecycle (load → labeled exploration →
// one-tap exit to a genuinely empty app) and the experience-level gate
// (expert reveals advanced analytics, simple hides them, data never changes).

async function tapTab(page, name){
  // Slow CI runners intermittently lose the hit-test race on the sticky
  // bottom nav: a content paragraph mid-relayout reports itself as the
  // topmost element at the tap point and the click never lands. Retry with
  // normal actionability first, then force — the primary nav is never
  // covered by a modal in these flows, so a forced click is safe.
  const btn = page.getByRole('button', { name, exact: true });
  await expect(async () => {
    try{
      await btn.click({ timeout: 2_500 });
    }catch{
      await btn.click({ force: true, timeout: 2_500 });
    }
  }).toPass({ timeout: 15_000 });
}

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
}

test.describe('Demo mode', () => {
  test('loads from onboarding, is labeled everywhere, and exits to an empty app', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    const dialog = page.getByRole('dialog', { name: 'Onboarding' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // The entry point: step 0 offers sample data before any commitment.
    await dialog.getByRole('button', { name: /Explore with sample data/i }).click();

    // Demo banner labels the mode…
    const banner = page.getByRole('region', { name: 'Demo mode banner' });
    await expect(banner).toBeVisible();
    await expect(banner.getByText(/sample data/i)).toBeVisible();

    // …onboarding stays closed, and the populated app is live: Today shows a
    // scheduled session and Progress shows real derived numbers.
    await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeHidden();
    await expect(page.getByText(/Today|Up next/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    await expect(page.getByText(/Training age/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Milestones/)).toBeVisible();

    // Export is disabled while demo data is loaded (sample data never
    // masquerades as the user's own backup).
    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('button', { name: 'Export JSON' })).toBeDisabled();

    // One-tap exit wipes back to a genuinely empty app.
    page.once('dialog', (d) => d.accept());
    await banner.getByRole('button', { name: 'Start fresh' }).click();
    await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Demo mode banner' })).toHaveCount(0);
    const empty = await page.evaluate(async () => {
      const { loadStore } = await import('/src/lib/store.js');
      return loadStore().history.length;
    });
    expect(empty).toBe(0);
  });
});

test.describe('Experience levels', () => {
  test.beforeEach(async ({ page }) => completeOnboarding(page));

  test('expert reveals advanced analytics; simple hides them; data never changes', async ({ page }) => {
    // Seed a couple of sessions directly so Progress has material.
    await page.evaluate(async () => {
      const mod = await import('/src/lib/store.js');
      const store = mod.loadStore();
      store.history = [
        { id: 'e2e-s1', dateISO: '2026-09-01', savedAt: '2026-09-01T10:00:00.000Z', blocks: [{ exerciseId: 'push-up', sets: [{ reps: '12', weightKg: '0' }, { reps: '10', weightKg: '0' }] }] },
        { id: 'e2e-s2', dateISO: '2026-09-03', savedAt: '2026-09-03T10:00:00.000Z', blocks: [{ exerciseId: 'push-up', sets: [{ reps: '14', weightKg: '0' }] }] },
      ];
      mod.saveStore(store);
    });
    await page.reload();

    await tapTab(page, 'Progress');
    await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();

    // Standard (default): advanced gates closed.
    await expect(page.getByText('Deload logic check')).toHaveCount(0);
    await expect(page.getByText('Historical recommendation backtest')).toHaveCount(0);
    await expect(page.getByText(/Next best action/)).toBeVisible();
    await expect(page.getByText(/Milestones/)).toBeVisible();

    // Expert: the advanced sections appear.
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: /Expert Everything/i }).click();
    await tapTab(page, 'Progress');
    await expect(page.getByText('Deload logic check')).toBeVisible();
    await expect(page.getByText('Historical recommendation backtest')).toBeVisible();

    // Simple: condensed attribution, advanced sections gone, core stays.
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: /Simple The essentials/i }).click();
    await tapTab(page, 'Progress');
    await expect(page.getByText('Deload logic check')).toHaveCount(0);
    await expect(page.getByText('Historical recommendation backtest')).toHaveCount(0);
    await expect(page.getByText(/Next best action/)).toBeVisible();

    // The gate is display-only: the underlying store is untouched.
    const count = await page.evaluate(async () => {
      const { loadStore } = await import('/src/lib/store.js');
      return loadStore().history.length;
    });
    expect(count).toBe(2);
  });
});
