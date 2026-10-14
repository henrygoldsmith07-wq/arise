import { test, expect } from '@playwright/test';

// CoachPanel e2e — the on-device coach in the MAIN LOOP.
//
// The whole local coach (localCoach.js + buildCoachingState) already existed
// and was unit-tested, but its only call site was More → Settings → "AI coach
// (optional)". CoachPanel puts it after the Weekly Review on Today and after
// the "Am I improving?" assessment on Progress, with suggested questions drawn
// from the user's own training data.
//
// These tests verify the REAL browser contract that units cannot:
//   * the panel is reachable in the main loop (not only in settings),
//   * asking a question renders an answer sourced from the engines, and
//   * it is genuinely on-device — no request ever leaves the page.
//
// The last point is the one worth gating: the app ships an OPTIONAL cloud coach
// (BYOK endpoint). If this panel ever regressed to contacting it, the privacy
// story would change silently, so the request log must stay empty.

const WIPE = (page) => page.evaluate(() => new Promise((resolve) => {
  localStorage.clear();
  sessionStorage.clear();
  try{
    const r = indexedDB.deleteDatabase('arise-idb-v1');
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  }catch{ resolve(); }
}));

/** Fresh profile → demo data (real training to answer about) → shell up. */
async function bootToShell(page){
  await page.goto('/');
  await WIPE(page);
  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Onboarding' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: /Explore with sample data/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Demo mode banner' })).toBeVisible({ timeout: 15_000 });
}

const openCoach = async (page) => {
  await page.getByRole('button', { name: 'Ask the coach', exact: true }).click();
  await expect(page.getByTestId('coach-panel')).toBeVisible({ timeout: 10_000 });
};

test.describe('on-device coach in the main loop', () => {
  test('the coach is reachable on Today without going into settings', async ({ page }) => {
    await bootToShell(page);

    // The collapsed trigger is present on the default tab — one tap deep, no
    // navigation through More → Settings required.
    const trigger = page.getByTestId('coach-panel-trigger');
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText(/On-device coach/i);

    await openCoach(page);
    // Suggested questions are derived from the user's own training data, so a
    // demo profile must show real ones (never a default demo lift).
    const chips = page.getByRole('group', { name: 'Suggested questions' }).getByRole('button');
    expect(await chips.count(), 'suggested questions render').toBeGreaterThan(1);
  });

  test('asking a question renders an engine-sourced answer on-device', async ({ page }) => {
    await bootToShell(page);
    await openCoach(page);

    const question = page.getByLabel('Ask the coach a question');
    await question.fill('Am I improving?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();

    // The answer body (the live region), not the "Coach:" label span beside it.
    const turn = page.getByTestId('coach-panel').locator('[aria-live="polite"]').first();
    await expect(turn).toBeVisible({ timeout: 10_000 });
    const text = await turn.innerText();
    expect(text.replace(/^Coach:/, '').trim().length, 'a real answer, not a placeholder').toBeGreaterThan(30);

    // The panel must say where the answer came from — that is the whole
    // "explainable coach" contract.
    await expect(page.getByText(/Answered on-device from your logs/i).first()).toBeVisible();
  });

  test('a suggested question answers without typing', async ({ page }) => {
    await bootToShell(page);
    await openCoach(page);

    const chip = page.getByRole('group', { name: 'Suggested questions' }).getByRole('button').first();
    const chipText = (await chip.innerText()).trim();
    await chip.click();

    const turn = page.getByTestId('coach-panel').locator('[aria-live="polite"]').first();
    await expect(turn).toBeVisible({ timeout: 10_000 });
    expect((await turn.innerText()).replace(/^Coach:/, '').trim().length, 'chips answer, not stub').toBeGreaterThan(0);
    // The question echoed back is exactly the chip that was pressed.
    await expect(page.getByTestId('coach-panel').getByText(chipText, { exact: false }).first()).toBeVisible();
  });

  test('the coach also lives on Progress, right after the assessment', async ({ page }) => {
    await bootToShell(page);
    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId('coach-panel-trigger')).toBeVisible({ timeout: 10_000 });
    await openCoach(page);
    await expect(page.getByLabel('Ask the coach a question')).toBeVisible();
  });

  test('no network request ever leaves the device from the coach surface', async ({ page }) => {
    const external = [];
    // Anything that is not the dev server itself is an escape from the app.
    page.on('request', (req) => {
      try{
        const u = new URL(req.url());
        if(!/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/.test(u.hostname) && u.protocol !== 'data:' && u.protocol !== 'blob:'){
          external.push(req.url());
        }
      }catch{}
    });

    await bootToShell(page);
    await openCoach(page);

    const question = page.getByLabel('Ask the coach a question');
    await question.fill('Explain my week');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByTestId('coach-panel').getByText(/Coach:/).first()).toBeVisible({ timeout: 10_000 });

    // Also exercise a chip, which routes through the same answerer.
    await page.getByRole('group', { name: 'Suggested questions' }).getByRole('button').first().click();
    await page.waitForTimeout(400);

    expect(external, 'the on-device coach must contact no third-party origin').toEqual([]);
  });

  test('an empty question cannot be submitted', async ({ page }) => {
    await bootToShell(page);
    await openCoach(page);

    // No turns yet, and the Ask button is disabled until there is text.
    await expect(page.getByTestId('coach-panel').getByText(/Coach:/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled();
    await page.getByLabel('Ask the coach a question').fill('x');
    await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeEnabled();
  });

  test('the first-run data-posture badge: present on a fresh plan, gone with data or demo', async ({ page }) => {
    // Onboarding completes but no session is logged: the badge states the
    // local-first contract next to the plan it produced.
    await page.goto('/');
    await WIPE(page);
    await page.reload();
    const dialog = page.getByRole('dialog', { name: 'Onboarding' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: /Get stronger/i }).click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('button', { name: 'Gym' }).click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByLabel(/Dumbbells/i).click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('button', { name: 'Beginner', exact: true }).click();
    await dialog.getByRole('button', { name: '3×' }).click();
    await dialog.getByRole('button', { name: '45 min' }).click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('button', { name: /Save & continue/i }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    const badge = page.getByTestId('today-trust-badge');
    await expect(badge).toBeVisible({ timeout: 10_000 });
    // Honest copy: states what is kept AND that exports/sync stay the user's
    // choice — never "nothing ever leaves" absolutism.
    await expect(badge).toContainText(/Your data stays on this device/);
    await expect(badge).toContainText(/always your choice/);

    // Logging a session retires the badge: its job (setting the posture
    // before data exists) is done.
    await page.evaluate(async () => {
      const { loadStore, saveStore } = await import('/src/lib/store.js');
      const { whenPersisted } = await import('/src/lib/storage.js');
      saveStore({ ...loadStore(), history: [{ id: 'e2e-1', dateISO: '2026-10-01', blocks: [] }] });
      await whenPersisted();
    });
    await page.reload();
    await expect(page.getByTestId('today-trust-badge')).toHaveCount(0);
  });

  test('the data-posture badge never fires on demo data', async ({ page }) => {
    await bootToShell(page);
    // Demo has a rich store and even a plan — but no user data to keep.
    await expect(page.getByTestId('today-trust-badge')).toHaveCount(0);
  });
});
