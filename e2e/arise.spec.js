import { test, expect } from '@playwright/test';

test.describe('Arise — new user journey', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('onboarding → equipment → programme generation → start → log → progression', async ({ page }) => {
    // Onboarding should be open for a fresh user
    await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeVisible({ timeout: 10_000 });

    // Step 1: goal
    await page.getByRole('button', { name: /Get stronger/i }).click();
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 2: location
    await page.getByRole('button', { name: 'Gym' }).click();
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 3: kit
    await page.getByLabel(/Dumbbells/i).click();
    await page.getByLabel(/Bench/i).click();
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 4: level & schedule
    await page.getByRole('button', { name: 'Intermediate' }).click();
    await page.getByRole('button', { name: '3×' }).click();
    await page.getByRole('button', { name: '45 min' }).click();
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 5: preferences optional -> save
    await page.getByRole('button', { name: /Save & continue/i }).click();
    await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeHidden();

    // Train tab — generate programme
    await page.getByRole('button', { name: 'Train' }).click();
    await expect(page.getByRole('heading', { name: 'Train' })).toBeVisible();
    const generateBtn = page.getByRole('button', { name: /Generate from profile/i });
    if (await generateBtn.isVisible()) await generateBtn.click();
    // Or schedule this program if generate not present
    const scheduleBtn = page.getByRole('button', { name: /Schedule this program/i });
    if (await scheduleBtn.isVisible()) await scheduleBtn.click();

    // Should have a schedule now
    await expect(page.getByText(/Start: \d{4}-\d{2}-\d{2}/)).toBeVisible({ timeout: 5000 });

    // Go to Today and start first session
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    const startBtn = page.getByRole('button', { name: /Start today.s session|Start this session/ }).first();
    if (await startBtn.isVisible()) await startBtn.click();

    // SessionRunner should appear
    const runner = page.getByRole('dialog', { name: /Session —/ });
    await expect(runner).toBeVisible({ timeout: 8000 });

    // Log sets: edit reps/load and tap Done for each set
    const repInputs = runner.getByPlaceholder('8');
    const loadInputs = runner.getByPlaceholder('kg');
    // Fill first block's first two sets if present
    if (await repInputs.first().isVisible()) {
      await repInputs.first().fill('8');
      if (await loadInputs.first().isVisible()) await loadInputs.first().fill('12');
    }
    // Complete at least one set per block
    const doneButtons = runner.getByRole('button', { name: 'Done' });
    const doneCount = await doneButtons.count();
    for (let i = 0; i < Math.min(doneCount, 3); i++) {
      await doneButtons.nth(i).click();
    }

    // Add optional pain tag to test capture
    // ensure note area visible
    await expect(runner.getByText('Session notes')).toBeVisible();
    await runner.getByRole('button', { name: 'Felt strong' }).click();

    // Save session
    const saveBtn = runner.getByRole('button', { name: 'Save session' });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();

    // Should land on Progress tab and show progression update
    await expect(page.getByRole('heading', { name: /Progress/i }).or(page.getByText(/Your progress/))).toBeVisible({ timeout: 8000 });

    // Next session should be available on Today
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(page.getByText(/adherence|upcoming/i).first()).toBeVisible();
    // Validate explainability: programme changes explain why
    await page.getByRole('button', { name: 'Train' }).click();
    const why = page.getByText(/Why this programme was generated/i);
    if (await why.isVisible()) {
      await why.click();
      await expect(page.getByText(/Resampled|Capped each session/)).toBeVisible();
    }
  });

  test('mobile layout does not clip primary actions', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeVisible({ timeout: 10_000 });
    // Onboarding next button should be visible and not off-screen
    const next = page.getByRole('button', { name: 'Next' });
    await expect(next).toBeVisible();
    const box = await next.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  });
});
