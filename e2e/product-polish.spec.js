import { test, expect } from '@playwright/test';

// Product-gaps pass: exercise teaching where it matters, first-class
// template editing, and self-service study onboarding — each verified in
// the real UI, without disturbing the logging flow.

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

async function scheduleProgram(page){
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
}

test('How-to guide opens inside the runner and never blocks logging', async ({ page }) => {
  await completeOnboarding(page);
  await scheduleProgram(page);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  const startBtn = page.getByRole('button', { name: /Start workout|Start this session/ }).first();
  if (await startBtn.isVisible()) await startBtn.click();
  const runner = page.getByRole('dialog', { name: /Session —/ });
  await expect(runner).toBeVisible({ timeout: 8000 });

  const howTo = runner.getByRole('button', { name: /Show how to do it/ }).first();
  await expect(howTo).toBeVisible({ timeout: 5000 });
  await howTo.click();
  await expect(runner.getByText('Breathing & bracing').first()).toBeVisible();
  await expect(runner.getByText('Stay in control').first()).toBeVisible();
  await runner.getByRole('button', { name: /Hide how to do it/ }).first().click();

  // Logging itself is untouched: still one visible Done, tap completes.
  await runner.getByLabel(/^Reps set \d+$/).first().fill('8');
  await runner.getByRole('button', { name: 'Done' }).first().click();
  await expect(runner.getByRole('button', { name: '✓', exact: true }).first()).toBeVisible({ timeout: 5000 });

});

test('template editor: rest, reorder, kit preview, duplicate', async ({ page }) => {
  await completeOnboarding(page);
  await page.getByRole('button', { name: 'Train' }).click();
  await page.getByRole('button', { name: /Build my own/i }).click();
  await page.getByRole('button', { name: /New template/i }).click();
  const builder = page.getByRole('dialog', { name: 'Template builder' });
  await expect(builder).toBeVisible({ timeout: 5000 });

  await builder.getByLabel('Name').fill('E2E plan');
  const exerciseSelect = builder.getByLabel('Day 1 exercise 1', { exact: true });
  await exerciseSelect.selectOption({ label: 'Barbell Bench Press' });
  // The kit (dumbbells+bench) has no barbell — the preview must say what
  // it honestly becomes, using the same engine the scheduler uses.
  await expect(builder.getByText('Barbell Bench Press →')).toBeVisible({ timeout: 5000 });

  await builder.getByLabel('Day 1 exercise 1 rest seconds').fill('45');
  await builder.getByRole('button', { name: /\+ exercise/ }).click();
  await builder.getByLabel('Day 1 exercise 2', { exact: true }).selectOption({ label: 'Push-up' });
  // Reorder controls exist and are honest (first row up disabled).
  await expect(builder.getByRole('button', { name: 'Move exercise 1 of day 1 up' })).toBeDisabled();
  await builder.getByRole('button', { name: 'Move exercise 2 of day 1 up' }).click();
  await expect(builder.getByLabel('Day 1 exercise 1', { exact: true })).toHaveValue('push-up');

  await builder.getByRole('button', { name: 'Create template' }).click();
  await expect(page.getByRole('button', { name: /E2E plan ★/ })).toBeVisible({ timeout: 5000 });

  // Duplicate: a fresh, independently versioned copy.
  await page.getByRole('button', { name: 'Duplicate E2E plan', exact: true }).click();
  await expect(page.getByRole('button', { name: /E2E plan copy ★/ })).toBeVisible({ timeout: 5000 });

  // Edit bumps the version label on the save button.
  await page.getByRole('button', { name: 'Edit E2E plan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save as v2' })).toBeVisible({ timeout: 5000 });
});

test('study card: plain-language consent, honest eligibility, no fake joining', async ({ page }) => {
  await completeOnboarding(page);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByText('Take part in the real-world study')).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(/Turn on local measurements first/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join the study' })).toHaveCount(0);
  await expect(page.getByText(/Insufficient real-user evidence/)).toBeVisible();
});


test('editing onboarding opens at kit and can save immediately', async ({ page }) => {
  await completeOnboarding(page);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Edit onboarding' }).click();

  const dialog = page.getByRole('dialog', { name: 'Onboarding' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'What kit do you have?' })).toBeVisible();
  await expect(dialog.getByText(/Editing setup · Step 3 of 5/)).toBeVisible();

  await dialog.getByLabel(/Bodyweight/i).click();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();

  const equipment = await page.evaluate(async () => {
    const { loadStore } = await import('/src/lib/store.js');
    return loadStore().onboarding?.equipment || [];
  });
  expect(equipment).toContain('bodyweight');
});

test('pound preference makes equipment setup imperial while storage stays kg', async ({ page }) => {
  await completeOnboarding(page);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Pounds', exact: true }).click();
  await page.getByRole('button', { name: 'Edit onboarding' }).click();

  const dialog = page.getByRole('dialog', { name: 'Onboarding' });
  await dialog.getByLabel(/Barbell/i).click();
  await expect(dialog.getByRole('button', { name: '45 lb bar', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '45 lb', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '45 lb bar', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save changes' }).click();

  const stored = await page.evaluate(async () => {
    const { loadStore } = await import('/src/lib/store.js');
    return loadStore().onboarding?.plateConfig?.barWeightKg;
  });
  expect(stored).toBeGreaterThan(20);
  expect(stored).toBeLessThan(21);
});
