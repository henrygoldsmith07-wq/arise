import { test, expect } from '@playwright/test';

// Today hero hierarchy e2e: one dominant Start workout CTA, alternates behind
// an Options disclosure, last-used mode preference persistence, and keyboard
// accessibility of the disclosure.

async function completeOnboarding(page){
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  // Clear the IndexedDB cache too — once hydrated it is canonical.
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
  await page.getByRole('button', { name: '3×' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
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
  // Recommendation-first: one tap starts the recommended programme.
  const recCard = page.locator('[aria-label="Recommended for you"]');
  if (await recCard.getByRole('button', { name: 'Start programme' }).isVisible().catch(() => false)) {
    await recCard.getByRole('button', { name: 'Start programme' }).click();
  } else {
    await page.getByRole('button', { name: 'Browse programmes' }).click();
    await page.getByRole('button', { name: /Schedule this program/i }).click();
  }
  // Back to Today — the first session of a fresh schedule is today's.
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible({ timeout: 8_000 });
}

/** Open the hero Options disclosure idempotently (never toggles it closed). */
async function openOptions(page){
  const options = page.getByRole('button', { name: 'Options' });
  if((await options.getAttribute('aria-expanded')) !== 'true') await options.click();
  await expect(page.getByRole('button', { name: 'Guided mode' })).toBeVisible();
}

test.describe('Today hero — single dominant CTA with Options', () => {
  test.beforeEach(async ({ page }) => {
    await completeOnboarding(page);
    await dismissConsent(page);
    await scheduleProgram(page);
  });

  test('today’s hero is the only next-best-action advice on a training day', async ({ page }) => {
    // The hero answers "what should I do now?"; a second Next-best-action
    // card would duplicate the same advice.
    await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Suggested next step' })).toHaveCount(0);
  });

  test('scheduled-training audit is collapsed and still one tap deep', async ({ page }) => {
    // Seed one deterministic adaptation so the audit trail has real content;
    // a fresh schedule legitimately has nothing to disclose yet.
    await page.evaluate(async () => {
      const mod = await import('/src/lib/store.js');
      const store = mod.loadStore();
      store.activeSchedule.lastAdaptation = {
        dateISO: new Date().toISOString().slice(0, 10),
        changes: [{ sessionId: store.activeSchedule.sessions[0].id, exerciseId: 'push-up', reason: 'e2e seeded audit entry' }],
      };
      mod.saveStore(store);
      const { whenPersisted } = await import('/src/lib/storage.js');
      await whenPersisted();
    });
    await page.reload();

    // Decision material (Start workout) stays visible; reference material
    // (audit trail) starts collapsed, with the adherence summary still legible.
    const audit = page.locator('details', { has: page.getByText('Scheduled training') }).first();
    await expect(audit).toBeVisible();
    await expect(audit.getByText('Scheduled training')).toBeVisible();
    await expect(audit.getByText(/adherence so far|upcoming|No sessions due yet/)).toBeVisible();
    await expect(audit.getByText(/What changed & why/)).toBeHidden();

    await audit.getByText('Scheduled training').click();
    // Nested audit entries stay collapsed; the section just exposes them.
    await expect(audit.getByText(/What changed & why/)).toBeVisible();
  });

  test('only one dominant start CTA is initially visible; alternates hidden until Options', async ({ page }) => {
    // The one dominant action.
    await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible();

    // The old competing trio is gone: no second/third start button up front.
    await expect(page.getByRole('button', { name: /20-minute workout/i })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Guided mode' })).toBeHidden();

    // Options reveals both alternates plus the last-used hint.
    await openOptions(page);
    await expect(page.getByRole('button', { name: /20-minute workout/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Guided mode' })).toBeVisible();
    await expect(page.getByText(/Last used:/)).toBeVisible();
  });

  test('standard workout starts correctly from the main CTA', async ({ page }) => {
    await page.getByRole('button', { name: 'Start workout' }).click();
    // The standard runner (not guided) opens for today's session.
    const runner = page.getByRole('dialog', { name: /^Session —/ });
    await expect(runner).toBeVisible({ timeout: 8_000 });
    // Standard mode: not flagged as short in the runner chrome.
    await expect(runner.getByText('Short session')).toHaveCount(0);
  });

  test('20-minute workout from Options starts the short session', async ({ page }) => {
    await openOptions(page);
    await page.getByRole('button', { name: /20-minute workout/i }).click();
    const runner = page.getByRole('dialog', { name: /^Session —/ });
    await expect(runner).toBeVisible({ timeout: 8_000 });
    await expect(runner.getByText('Short session')).toBeVisible();
  });

  test('guided mode from Options starts the guided runner', async ({ page }) => {
    await openOptions(page);
    await page.getByRole('button', { name: 'Guided mode' }).click();
    const runner = page.getByRole('dialog', { name: /Guided session/ });
    await expect(runner).toBeVisible({ timeout: 8_000 });
  });

  test('selected mode preference persists and shows as "Last used"', async ({ page }) => {
    // Pick guided through Options, then cancel the runner.
    await openOptions(page);
    await page.getByRole('button', { name: 'Guided mode' }).click();
    const runner = page.getByRole('dialog', { name: /Guided session/ });
    await expect(runner).toBeVisible({ timeout: 8_000 });
    await runner.getByRole('button', { name: 'Close guided session' }).click();
    await expect(runner).toBeHidden();

    // Re-open Options: guided is now the recorded last-used mode.
    await openOptions(page);
    await expect(page.getByText('Last used: Guided mode')).toBeVisible();

    // The preference survives a full reload (IndexedDB canonical once hydrated).
    await page.reload();
    await openOptions(page);
    await expect(page.getByText('Last used: Guided mode')).toBeVisible();

    // It is a hint only: the dominant CTA still starts the STANDARD session.
    await page.getByRole('button', { name: 'Start workout' }).click();
    await expect(page.getByRole('dialog', { name: /^Session —/ })).toBeVisible({ timeout: 8_000 });
  });

  test('legacy/missing preference resolves to Standard workout hint', async ({ page }) => {
    // Fresh install path: no workoutMode key ever written → standard hint.
    await openOptions(page);
    await expect(page.getByText('Last used: Standard workout')).toBeVisible();
  });

  test('keyboard: Escape collapses Options and returns focus to the toggle', async ({ page }) => {
    const options = page.getByRole('button', { name: 'Options' });
    await options.focus();
    await expect(options).toBeFocused();

    // Enter opens the disclosure.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Guided mode' })).toBeVisible();
    await expect(options).toHaveAttribute('aria-expanded', 'true');

    // Escape closes it and focus stays on the toggle — keyboard users are
    // never stranded inside the collapsed panel.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Guided mode' })).toBeHidden();
    await expect(options).toHaveAttribute('aria-expanded', 'false');
    await expect(options).toBeFocused();
  });

  test('touch targets meet the 44×44 minimum on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const cta = page.getByRole('button', { name: 'Start workout' });
    const options = page.getByRole('button', { name: 'Options' });
    for(const target of [cta, options]){
      const box = await target.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    // The revealed alternates too.
    await options.click();
    for(const target of [page.getByRole('button', { name: /20-minute workout/i }), page.getByRole('button', { name: 'Guided mode' })]){
      const box = await target.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
  });
});
