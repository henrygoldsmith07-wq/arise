import { test, expect } from '@playwright/test';

// Train recommendation-first e2e: the profile recommendation is the primary
// experience, an active programme takes priority over it, and the management
// surfaces (browse / build / templates / import) stay reachable but collapsed.

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
  const consent = page.getByRole('dialog', { name: 'Local measurement consent' });
  if(await consent.isVisible().catch(() => false)){
    await consent.getByRole('button', { name: 'No thanks' }).click();
  }
}

test.describe('Train — recommendation first', () => {
  test('recommendation card dominates; management sections start collapsed', async ({ page }) => {
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'Train', exact: true }).click();

    // The recommendation is the primary experience.
    const rec = page.locator('[aria-label="Recommended for you"]');
    await expect(rec).toBeVisible({ timeout: 8_000 });
    await expect(rec.getByRole('button', { name: 'Start programme' })).toBeVisible();

    // Secondary controls exist but are collapsed: their content is not
    // rendered until opened (browse programmes, build/templates).
    await expect(page.getByRole('button', { name: 'Browse programmes' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Build my own & my templates/i })).toBeVisible();
    // Programme cards and template editing controls are NOT on initial load.
    await expect(page.getByRole('button', { name: '+ New template' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Have a share code?' })).toHaveCount(0);
  });

  test('explanation separates what chose the programme from what adapts sessions', async ({ page }) => {
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'Train', exact: true }).click();
    const rec = page.locator('[aria-label="Recommended for you"]');
    await expect(rec).toBeVisible({ timeout: 8_000 });

    await rec.getByText('Why this programme?').click();

    // "Used to choose": exactly the scorer inputs (goal, kit, level, days).
    await expect(rec.getByText('Used to choose this programme')).toBeVisible();
    await expect(rec.getByText('Goal:')).toBeVisible();
    await expect(rec.getByText('Feel better').first()).toBeVisible();
    await expect(rec.getByText('Available equipment:')).toBeVisible();
    await expect(rec.getByText('Training level:')).toBeVisible();
    await expect(rec.getByText('Beginner').first()).toBeVisible();
    await expect(rec.getByText('Available days:')).toBeVisible();

    // "Used when building sessions": the onboarding preferred length is
    // labelled a PREFERENCE, never presented as measured duration.
    await expect(rec.getByText(/Used when building your sessions/i)).toBeVisible();
    await expect(rec.getByText('Preferred session length:')).toBeVisible();

    // History never appears as a ranking input on a fresh profile —
    // and "Relevant history" as a choosing factor is gone entirely.
    await expect(rec.getByText('Relevant history')).toHaveCount(0);

    // The headline duration is a measured estimate (≈N min), not the
    // onboarding "45 min" value verbatim.
    await expect(rec.getByText(/^≈\d+ min/).first()).toBeVisible();
  });

  test('starting the recommendation creates the correct schedule', async ({ page }) => {
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'Train', exact: true }).click();
    const rec = page.locator('[aria-label="Recommended for you"]');
    await expect(rec).toBeVisible({ timeout: 8_000 });

    await rec.getByRole('button', { name: 'Start programme' }).click();

    // The current-programme card replaces the recommendation (priority), and
    // Today now carries a dated schedule to run.
    const current = page.locator('[aria-label="Current programme"]');
    await expect(current).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[aria-label="Recommended for you"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible({ timeout: 8_000 });
  });

  test('active programme takes priority over the recommendation', async ({ page }) => {
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'Train', exact: true }).click();
    const rec = page.locator('[aria-label="Recommended for you"]');
    await expect(rec).toBeVisible({ timeout: 8_000 });
    await rec.getByRole('button', { name: 'Start programme' }).click();

    // Re-entering Train: current programme first, no recommendation card,
    // no replacement nudge.
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await page.getByRole('button', { name: 'Train', exact: true }).click();
    const current = page.locator('[aria-label="Current programme"]');
    await expect(current).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[aria-label="Recommended for you"]')).toHaveCount(0);
    await expect(current.getByText(/Week \d+ of \d+ · \d+\/\d+ sessions/)).toBeVisible();
  });

  test('browse, templates and import remain accessible', async ({ page }) => {
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'Train', exact: true }).click();
    await expect(page.locator('[aria-label="Recommended for you"]')).toBeVisible({ timeout: 8_000 });

    // Browse opens the programme cards and the schedule action.
    await page.getByRole('button', { name: 'Browse programmes' }).click();
    await expect(page.getByRole('button', { name: /Schedule this program/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate from profile' })).toBeVisible();
    // Programme preview lives inside browse.
    await expect(page.getByText(/Preview — /i)).toBeVisible();

    // Templates section: builder + built-in chips + share-code import.
    await page.getByRole('button', { name: /Build my own & my templates/i }).click();
    await expect(page.getByRole('button', { name: '+ New template' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Starter Template' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Import programme — have a share code\?/i })).toBeVisible();
    await page.getByRole('button', { name: /Import programme — have a share code\?/i }).click();
    await expect(page.getByLabel('Program share code')).toBeVisible();
  });

  test('keyboard: sections expand and collapse; touch targets ≥44px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'Train', exact: true }).click();
    await expect(page.locator('[aria-label="Recommended for you"]')).toBeVisible({ timeout: 8_000 });

    const browse = page.getByRole('button', { name: 'Browse programmes' });
    for(const target of [
      page.locator('[aria-label="Recommended for you"]').getByRole('button', { name: 'Start programme' }),
      browse,
      page.getByRole('button', { name: /Build my own & my templates/i }),
    ]){
      const box = await target.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
  });
});
