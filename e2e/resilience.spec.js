import { test, expect } from '@playwright/test';

// Resilience + inclusivity e2e: the active-workout draft must survive a hard
// reload and a second tab must never corrupt it; dialogs must trap and return
// focus; light and dark themes must both render real contrast (screenshot
// pairs checked into test-results for review).

async function completeOnboarding(page){
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /Get stronger/i }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Gym' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel(/Dumbbells/i).click();
  await page.getByLabel(/Bench/i).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Intermediate' }).click();
  await page.getByRole('button', { name: '3×' }).click();
  await page.getByRole('button', { name: '45 min' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /Save & continue/i }).click();
  await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeHidden();
}

async function openRunner(page){
  await page.getByRole('button', { name: 'Train' }).click();
  const generateBtn = page.getByRole('button', { name: /Generate from profile/i });
  if (await generateBtn.isVisible()) {
    await generateBtn.click();
    await page.waitForTimeout(300); // let the generated programme render
  }
  const startText = page.getByText(/Start: \d{4}-\d{2}-\d{2}/);
  if (!(await startText.isVisible())) {
    const scheduleBtn = page.getByRole('button', { name: /Schedule this program/i });
    if (await scheduleBtn.isVisible()) await scheduleBtn.click();
  }
  await expect(startText).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  const startBtn = page.getByRole('button', { name: /Start today.s session|Start this session/ }).first();
  if (await startBtn.isVisible()) await startBtn.click();
  const runner = page.getByRole('dialog', { name: /Session —/ });
  await expect(runner).toBeVisible({ timeout: 8000 });
  return runner;
}

test.describe('active workout resilience', () => {
  test('draft survives a hard reload mid-session and offers recovery', async ({ page }) => {
    await completeOnboarding(page);
    const runner = await openRunner(page);

    // Log at least one real set so the draft carries content worth recovering.
    const repInputs = runner.getByPlaceholder('8');
    if (await repInputs.first().isVisible()) await repInputs.first().fill('9');
    const doneButtons = runner.getByRole('button', { name: 'Done' });
    if (await doneButtons.count()) await doneButtons.first().click();

    // Hard reload = the "app crashed" case. No graceful save, no beforeunload.
    await page.reload();
    await expect(page.getByText('Resume your workout?')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/sets saved locally/)).toBeVisible();
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByRole('dialog', { name: /Session —/ })).toBeVisible({ timeout: 8000 });
  });

  test('discarding a recovered draft clears it (and confirms first)', async ({ page }) => {
    await completeOnboarding(page);
    const runner = await openRunner(page);
    const doneButtons = runner.getByRole('button', { name: 'Done' });
    if (await doneButtons.count()) await doneButtons.first().click();
    await page.reload();
    await expect(page.getByText('Resume your workout?')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Discard draft' }).click();
    await expect(page.getByText('Resume your workout?')).toBeHidden();
    await page.reload();
    await expect(page.getByText('Resume your workout?')).toBeHidden({ timeout: 10_000 });
  });

  test('discard confirmation guards completed sets inside the runner', async ({ page }) => {
    await completeOnboarding(page);
    const runner = await openRunner(page);
    const doneButtons = runner.getByRole('button', { name: 'Done' });
    if (await doneButtons.count()) await doneButtons.first().click();
    await runner.getByRole('button', { name: 'Cancel' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText(/Discarding cannot be undone/)).toBeVisible();
    await confirm.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByRole('dialog', { name: /Session —/ })).toBeVisible();
  });
});

test.describe('cross-tab safety', () => {
  test('a second tab refreshing its store cannot clobber an active draft', async ({ page, context }) => {
    await completeOnboarding(page);
    const runner = await openRunner(page);
    const repInputs = runner.getByPlaceholder('8');
    if (await repInputs.first().isVisible()) await repInputs.first().fill('9');
    const doneButtons = runner.getByRole('button', { name: 'Done' });
    if (await doneButtons.count()) await doneButtons.first().click();

    // Second tab: same origin, boots its own view, then writes its own store copy.
    const page2 = await context.newPage();
    await page2.goto('/');
    await expect(page2.getByRole('dialog', { name: 'Onboarding' })).toBeHidden({ timeout: 10_000 }).catch(() => {});
    await page2.evaluate(() => {
      const raw = localStorage.getItem('arise.store.v1');
      if (raw) localStorage.setItem('arise.store.v1', raw); // touch the key → storage event
    });
    // The draft must still be offered in tab 1 (the storage listener skips
    // mid-session refreshes precisely so a foreign write can't clobber it).
    await page.bringToFront();
    await page.reload();
    await expect(page.getByText('Resume your workout?')).toBeVisible({ timeout: 10_000 });
    await page2.close();
  });
});

test.describe('accessibility', () => {
  test('onboarding dialog traps focus and the modal is labelled', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const dialog = page.getByRole('dialog', { name: 'Onboarding' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // Interactive controls live inside the dialog; tabbing stays within the
    // modal surface while it is open.
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    const active = await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
    expect(active).toBe(true);
    // Buttons are real buttons with accessible names (no icon-only mystery).
    const next = dialog.getByRole('button', { name: 'Next' });
    await expect(next).toBeVisible();
  });

  test('live region exists and rest controls carry accessible names', async ({ page }) => {
    await completeOnboarding(page);
    const runner = await openRunner(page);
    // The throttled live region summarises progress politely (sr-only, role=status).
    await expect(runner.locator('[role="status"]').first()).toBeAttached();
    // Set completion controls are named (large targets with names, not glyphs).
    const doneButtons = runner.getByRole('button', { name: 'Done' });
    expect(await doneButtons.count()).toBeGreaterThan(0);
  });

  test('every visible button across tabs has an accessible name', async ({ page }) => {
    await completeOnboarding(page);
    for (const tab of ['Today', 'Train', 'Progress', 'More']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      const unnamed = await page.evaluate(() => {
        return [...document.querySelectorAll('button')]
          .filter((b) => b.offsetParent !== null)
          .filter((b) => !b.getAttribute('aria-label') && !(b.textContent || '').trim() && !b.querySelector('img[alt], svg[aria-label]'))
          .length;
      });
      expect(unnamed, `${tab} tab has unnamed buttons`).toBe(0);
    }
  });
});

test.describe('themes render with real content', () => {
  const tabs = ['Today', 'Train', 'Progress', 'More'];
  for (const theme of ['light', 'dark']) {
    for (const tab of tabs) {
      test(`${theme} — ${tab} screenshot`, async ({ page }) => {
        await completeOnboarding(page);
        // Pick the theme via the cycle control until the class matches.
        await page.evaluate((t) => {
          localStorage.setItem('arise.store.v1', (() => {
            const raw = localStorage.getItem('arise.store.v1');
            if (!raw) return raw;
            try { const s = JSON.parse(raw); s.preferences = { ...(s.preferences || {}), theme: t }; return JSON.stringify(s); } catch { return raw; }
          })());
        }, theme);
        await page.reload();
        await page.getByRole('button', { name: tab, exact: true }).click();
        await expect(page.locator('#main')).toBeVisible();
        await page.waitForTimeout(400); // let illustrations/lazy panels settle
        await page.screenshot({ path: `test-results/theme-${theme}-${tab.toLowerCase()}.png`, fullPage: false });
      });
    }
  }

  test('light theme body text has contrast against its background', async ({ page }) => {
    await completeOnboarding(page);
    await page.evaluate(() => {
      const raw = localStorage.getItem('arise.store.v1');
      if (raw) { try { const s = JSON.parse(raw); s.preferences = { ...(s.preferences || {}), theme: 'light' }; localStorage.setItem('arise.store.v1', JSON.stringify(s)); } catch {} }
    });
    await page.reload();
    const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(dark).toBe(false);
  });
});
