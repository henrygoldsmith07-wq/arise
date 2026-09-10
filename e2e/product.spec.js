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

test.describe('Progress assessment', () => {
  const isoDaysAgo = (days) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  };
  const daysBefore = (iso, days) => {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  };
  const currentMonday = () => {
    let monday = new Date().toISOString().slice(0, 10);
    while(new Date(`${monday}T00:00:00Z`).getUTCDay() !== 1) monday = daysBefore(monday, 1);
    return monday;
  };
  const lift = (id, dateISO, exerciseId, weightKg, reps) => ({
    id, dateISO, blocks: [{ exerciseId, sets: [{ reps: String(reps), weightKg: String(weightKg) }] }],
  });
  const seedAssessment = async (page, { history, schedule = null }) => {
    await page.evaluate(async ({ history, schedule }) => {
      const mod = await import('/src/lib/store.js');
      const store = mod.loadStore();
      store.history = history;
      store.activeSchedule = schedule;
      mod.saveStore(store);
    }, { history, schedule });
    await page.reload();
    await tapTab(page, 'Progress');
    await expect(page.getByRole('region', { name: 'Am I improving' })).toBeVisible();
  };

  test.beforeEach(async ({ page }) => completeOnboarding(page));

  test('improving loaded training shows strength and prescription signals', async ({ page }) => {
    const history = [
      lift('improving-0', isoDaysAgo(21), 'bench-press-dumbbell', 20, 8),
      lift('improving-1', isoDaysAgo(18), 'bench-press-dumbbell', 20, 9),
      lift('improving-2', isoDaysAgo(15), 'bench-press-dumbbell', 20, 10),
      lift('improving-3', isoDaysAgo(12), 'bench-press-dumbbell', 20, 11),
      lift('improving-4', isoDaysAgo(9), 'bench-press-dumbbell', 20, 12),
      lift('improving-5', isoDaysAgo(6), 'bench-press-dumbbell', 22.5, 8),
      lift('improving-6', isoDaysAgo(3), 'bench-press-dumbbell', 22.5, 9),
    ];
    await seedAssessment(page, { history });
    const card = page.getByRole('region', { name: 'Am I improving' });
    await expect(card.getByText('Likely improving')).toBeVisible();
    await expect(card.getByText('Strength trend ↑')).toBeVisible();
    await expect(card.getByText(/Targets completed \d+%/)).toBeVisible();
    await expect(card.getByText(/Evidence: (Moderate|High)/)).toBeVisible();

    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: /Simple The essentials/i }).click();
    await tapTab(page, 'Progress');
    await expect(card.getByText('Likely improving')).toBeVisible();
    await expect(card.getByText('Strength trend ↑')).toHaveCount(0);
  });

  test('flat repeated training holds steady instead of claiming volume progress', async ({ page }) => {
    const history = [21, 18, 15, 12, 9, 6].map((days, index) => lift(`flat-${index}`, isoDaysAgo(days), 'bench-press-dumbbell', 20, 8));
    await seedAssessment(page, { history });
    const card = page.getByRole('region', { name: 'Am I improving' });
    await expect(card.getByText('Holding steady')).toBeVisible();
    await expect(card.getByText('Likely improving')).toHaveCount(0);
  });

  test('opposing lifts report mixed signals', async ({ page }) => {
    const history = [
      lift('mixed-0', isoDaysAgo(21), 'bench-press-dumbbell', 20, 8),
      lift('mixed-1', isoDaysAgo(19), 'dumbbell-row', 30, 10),
      lift('mixed-2', isoDaysAgo(17), 'bench-press-dumbbell', 20, 9),
      lift('mixed-3', isoDaysAgo(15), 'dumbbell-row', 30, 9),
      lift('mixed-4', isoDaysAgo(13), 'bench-press-dumbbell', 20, 10),
      lift('mixed-5', isoDaysAgo(11), 'dumbbell-row', 30, 8),
      lift('mixed-6', isoDaysAgo(9), 'bench-press-dumbbell', 20, 11),
      lift('mixed-7', isoDaysAgo(7), 'dumbbell-row', 30, 7),
    ];
    await seedAssessment(page, { history });
    const card = page.getByRole('region', { name: 'Am I improving' });
    await expect(card.getByText('Mixed signals')).toBeVisible();
    await expect(card.getByText(/rising.*falling/)).toBeVisible();
  });

  test('a planned deload dip is contextualised rather than labelled regression', async ({ page }) => {
    const monday = currentMonday();
    const history = [
      lift('deload-0', daysBefore(monday, 20), 'bench-press-dumbbell', 20, 8),
      lift('deload-1', daysBefore(monday, 17), 'bench-press-dumbbell', 20, 9),
      lift('deload-2', daysBefore(monday, 14), 'bench-press-dumbbell', 20, 10),
      lift('deload-3', daysBefore(monday, 11), 'bench-press-dumbbell', 20, 11),
      lift('deload-4', daysBefore(monday, 8), 'bench-press-dumbbell', 20, 12),
      lift('deload-5', daysBefore(monday, 5), 'bench-press-dumbbell', 22.5, 8),
      lift('deload-6', daysBefore(monday, 2), 'bench-press-dumbbell', 22.5, 9),
      lift('deload-7', isoDaysAgo(0), 'bench-press-dumbbell', 12.5, 8),
    ];
    const schedule = {
      programId: 'starter-3x',
      mesocycle: { weeks: 4, deloadWeek: 1 },
      sessions: [{ id: 'e2e-deload', dateISO: monday, week: 1, title: 'Deload', status: 'planned', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: 2, reps: '8' }] }],
    };
    await seedAssessment(page, { history, schedule });
    const card = page.getByRole('region', { name: 'Am I improving' });
    await expect(card.getByText('Likely improving')).toBeVisible();
    await expect(card.getByText(/planned deload week/)).toBeVisible();
  });

  test('sparse history withholds the verdict', async ({ page }) => {
    const history = [
      lift('sparse-0', isoDaysAgo(4), 'push-up', 0, 10),
      lift('sparse-1', isoDaysAgo(1), 'push-up', 0, 11),
    ];
    await seedAssessment(page, { history });
    const card = page.getByRole('region', { name: 'Am I improving' });
    await expect(card.getByText('Not enough evidence yet', { exact: true })).toBeVisible();
    await expect(card.getByText(/2 comparable sessions logged/)).toBeVisible();
  });

  test('bodyweight-only progress is judged on reps, not lifted volume', async ({ page }) => {
    const history = [8, 9, 10, 11, 12, 13].map((reps, index) => lift(`bodyweight-${index}`, isoDaysAgo(20 - index * 3), 'push-up', 0, reps));
    await seedAssessment(page, { history });
    const card = page.getByRole('region', { name: 'Am I improving' });
    await expect(card.getByText('Likely improving')).toBeVisible();
    await expect(card.getByText(/8 → 13 reps/)).toBeVisible();
    await expect(card.getByText(/Bodyweight-only sessions track reps/)).toBeVisible();
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

    // What changed? renders only when the schedule/history recorded a
    // deterministic adaptation — never as invented filler.
    await expect(page.getByRole('region', { name: 'What changed' })).toHaveCount(0);

    // Expert: the advanced sections appear.
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: /Expert Everything/i }).click();
    await tapTab(page, 'Progress');
    await expect(page.getByText('Deload logic check')).toBeVisible();
    await expect(page.getByText('Historical recommendation backtest')).toBeVisible();
    await expect(page.getByText(/replayed against your own logged history/)).toBeVisible();

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
