import { test, expect } from '@playwright/test';

// Guided workout mode end-to-end: the More-view settings section and a full
// guided workout from Today through to a saved session in Progress.

async function completeOnboarding(page){
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  // Also clear the IndexedDB cache — once hydrated it is canonical and would
  // resurrect a previous profile's data.
  await page.evaluate(() => new Promise(resolve => {
    try{
      const req = indexedDB.deleteDatabase('arise-idb-v1');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    }catch{ resolve(); }
  }));
  await page.reload();

  await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeVisible({ timeout: 10_000 });

  // Step 1: goal
  await page.getByRole('button', { name: /Feel better/i }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 2: location
  await page.getByRole('button', { name: /Gym/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 3: kit
  await page.getByLabel(/Bodyweight/i).click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 4: level & schedule
  await page.getByRole('button', { name: 'Beginner', exact: true }).click();
  await page.getByRole('button', { name: '3×' }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 5: optional preferences → save
  await page.getByRole('button', { name: /Save & continue/i }).click();
  await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeHidden();
}

async function dismissConsent(page){
  const consent = page.getByRole('dialog', { name: 'Local measurement consent' });
  if(await consent.isVisible().catch(() => false)){
    await consent.getByRole('button', { name: 'No thanks' }).click();
  }
  await expect(consent).toBeHidden();
}

async function scheduleProgram(page){
  await page.getByRole('button', { name: 'Train', exact: true }).click();
  await page.getByRole('button', { name: /Schedule this program/i }).click();
  // Back to Today — the first session of a fresh schedule is today's.
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('button', { name: /Guided/ })).toBeVisible({ timeout: 8_000 });
}

test.describe('Guided mode settings in More', () => {
  test('toggles sound cues and voice coach, picks a speech rate, and persists across reload', async ({ page }) => {
    await completeOnboarding(page);
    await dismissConsent(page);

    await page.getByRole('button', { name: 'More', exact: true }).click();
    const section = page.locator('section', { has: page.getByRole('heading', { name: 'Guided mode' }) });
    await expect(section).toBeVisible();

    // Sound cues default on, voice coach default off (speech is opt-in).
    const cues = section.getByRole('checkbox', { name: /Sound cues/ });
    const coach = section.getByRole('checkbox', { name: /Voice coach/ });
    await expect(cues).toBeChecked();
    await expect(coach).not.toBeChecked();

    // Flip both, pick Fast speech rate.
    await cues.click();
    await coach.click();
    await section.getByRole('button', { name: 'Fast' }).click();
    await expect(section.getByRole('button', { name: 'Fast' })).toHaveAttribute('aria-pressed', 'true');
    await expect(coach).toBeChecked();
    await expect(cues).not.toBeChecked();

    // Preferences survive a full reload (IndexedDB is canonical once hydrated).
    await page.reload();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    const sectionAfter = page.locator('section', { has: page.getByRole('heading', { name: 'Guided mode' }) });
    await expect(sectionAfter.getByRole('checkbox', { name: /Voice coach/ })).toBeChecked();
    await expect(sectionAfter.getByRole('checkbox', { name: /Sound cues/ })).not.toBeChecked();
    await expect(sectionAfter.getByRole('button', { name: 'Fast' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('Full guided workout', () => {
  test('guided runner walks every set, chains rest, and saves into Progress', async ({ page }) => {
    await completeOnboarding(page);
    await dismissConsent(page);
    await scheduleProgram(page);

    // Launch the guided runner.
    await page.getByRole('button', { name: /Guided/ }).click();
    const runner = page.getByRole('dialog', { name: /Guided session/ });
    await expect(runner).toBeVisible({ timeout: 8_000 });

    // Header: elapsed timer ticking and the 0/N sets chip.
    await expect(runner.getByLabel(/Elapsed time/)).toBeVisible();
    const setsChip = runner.getByText(/\d+\/\d+ sets/).first();
    const initial = await setsChip.textContent();
    const totalSets = Number(initial.match(/\/(\d+)/)[1]);
    expect(totalSets).toBeGreaterThan(0);

    // Complete the first set: Done starts the rest countdown automatically.
    await runner.getByRole('button', { name: 'Done — next' }).click();
    const restCard = runner.getByRole('button', { name: 'Skip rest' });
    await expect(restCard).toBeVisible({ timeout: 5_000 });
    await expect(setsChip).toHaveText(/1\/\d+ sets/);

    // Sound + voice toggles are reachable in the runner (defaults per profile).
    await expect(runner.getByRole('button', { name: /Voice coach/ })).toBeVisible();
    await expect(runner.getByRole('button', { name: /Sound cues/ })).toBeVisible();

    // Burn through the rest, then skip the rest of the workout.
    await restCard.click();
    for(let i = 0; i < totalSets + 2; i++){
      const done = runner.getByRole('button', { name: 'Done — next' });
      const skipSet = runner.getByRole('button', { name: 'Skip', exact: true });
      if(await done.isVisible().catch(() => false)){
        await done.click();
      } else if(await skipSet.isVisible().catch(() => false)){
        await skipSet.click();
      }
      const rest = runner.getByRole('button', { name: 'Skip rest' });
      if(await rest.isVisible().catch(() => false)) await rest.click();
      if(await runner.getByText('Workout complete').isVisible().catch(() => false)) break;
    }

    // All sets resolved → celebration screen with notes.
    await expect(runner.getByText('Workout complete')).toBeVisible({ timeout: 8_000 });
    await runner.getByRole('button', { name: 'Felt strong' }).click();
    await expect(setsChip).toHaveText(new RegExp(`${totalSets}/${totalSets} sets`));

    // Save → the app switches to Progress and records the guided session.
    await runner.getByRole('button', { name: 'Save session' }).click();
    await expect(runner).toBeHidden({ timeout: 8_000 });
    await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
    await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 5_000 });

    // The session survives a reload — it lives in the standard history.
    await page.reload();
    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    await expect(page.getByText(/planned done|adherence/i).first()).toBeVisible({ timeout: 8_000 });
  });
});
