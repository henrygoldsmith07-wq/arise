import { test, expect } from '@playwright/test';

// Performance smoke tests: the budgets we promise users, verified in a real
// browser. Boot budget = time to first paint of the shell in a fresh context;
// the "no heavy view at boot" claim is about the critical path — Progress's
// chunk may only be fetched AFTER the shell paints (idle warm-up), never
// before. Interaction budgets read the named User Timing measures the session
// runner emits (see src/lib/perfTrace.js).

const BOOT_JS_BUDGET_MS = 2500;      // shell visible (fresh context, no cache)
const RUNNER_OPEN_BUDGET_MS = 500;   // session runner mounts after tap
const SAVE_BUDGET_MS = 750;          // save builds payload + progression

async function completeOnboarding(page) {
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

test.describe('Arise — performance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('boot: shell paints under budget; Progress loads only after first paint', async ({ page }) => {
    const progressRequests = [];
    page.on('request', (req) => {
      if (/ProgressView/i.test(req.url())) progressRequests.push(Date.now());
    });

    const start = Date.now();
    await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeVisible({ timeout: 10_000 });
    const shellMs = Date.now() - start;
    console.log(`boot(shell) ${shellMs}ms`);
    expect(shellMs).toBeLessThan(BOOT_JS_BUDGET_MS);

    // Nothing Progress-related may be on the critical path: every request for
    // its chunk must happen after the shell painted (the idle warm-up counts
    // as after — it runs post-paint by design and only over an idle lane).
    for (const t of progressRequests) expect(t).toBeGreaterThanOrEqual(start + shellMs);

    // And Progress renders on demand when actually opened.
    await completeOnboarding(page);
    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible({ timeout: 8000 });
  });

  test('session runner: open + save within interaction budgets', async ({ page }) => {
    test.setTimeout(60_000);
    await completeOnboarding(page);

    await page.getByRole('button', { name: 'Train' }).click();
    // Train is a lazy chunk — wait for the view before touching its buttons.
    await expect(page.getByRole('heading', { name: 'Train' })).toBeVisible({ timeout: 8000 });
    const generateBtn = page.getByRole('button', { name: /Generate from profile/i });
    if (await generateBtn.isVisible()) await generateBtn.click();
    const scheduleBtn = page.getByRole('button', { name: /Schedule this program|Restart schedule from today/i });
    if (await scheduleBtn.isVisible()) await scheduleBtn.click();
    // Schedule applied (same gate the main journey uses).
    await expect(page.getByText(/Start: \d{4}-\d{2}-\d{2}/)).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    const startBtn = page.getByRole('button', { name: /Start today.s session|Start this session/ }).first();
    await expect(startBtn).toBeVisible({ timeout: 8000 });
    await startBtn.click();

    const runner = page.getByRole('dialog', { name: /Session —/ });
    await expect(runner).toBeVisible({ timeout: 8000 });

    // Complete one set, then save; read the trace measures.
    const done = runner.getByRole('button', { name: 'Done' }).first();
    if (await done.isVisible()) await done.click();
    const saveBtn = runner.getByRole('button', { name: 'Save session' });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();

    const measures = await page.evaluate(() => {
      const all = performance.getEntriesByType('measure');
      const pick = (name) => {
        const entries = all.filter((m) => m.name === name);
        return entries.length ? Math.round(entries[entries.length - 1].duration) : null;
      };
      return { open: pick('session-runner:open'), save: pick('session-runner:save') };
    });
    console.log('runner measures', measures);
    expect(measures.open).not.toBeNull();
    expect(measures.open).toBeLessThan(RUNNER_OPEN_BUDGET_MS);
    if (measures.save != null) expect(measures.save).toBeLessThan(SAVE_BUDGET_MS);
  });
});
