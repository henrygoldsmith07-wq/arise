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
    await expect(card.getByText(/Retrospective engine replay \d+%/)).toBeVisible();
    await expect(card.getByText(/Data coverage: Low/)).toBeVisible();

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

  test('stored prescriptions drive actual follow-through, not replay', async ({ page }) => {
    // Six rising sessions, each carrying the prescription Arise showed at the
    // time: eleven of twelve stored targets met.
    const rows = [
      { id: 'observed-0', days: 20, rxReps: 8, rxLoad: 20, sets: [{ reps: '8', weightKg: '20' }, { reps: '8', weightKg: '20' }] },
      { id: 'observed-1', days: 17, rxReps: 9, rxLoad: 20, sets: [{ reps: '9', weightKg: '20' }, { reps: '9', weightKg: '20' }] },
      { id: 'observed-2', days: 14, rxReps: 10, rxLoad: 20, sets: [{ reps: '10', weightKg: '20' }, { reps: '10', weightKg: '20' }] },
      { id: 'observed-3', days: 11, rxReps: 11, rxLoad: 20, sets: [{ reps: '11', weightKg: '20' }, { reps: '11', weightKg: '20', completed: false, skipped: true }] },
      { id: 'observed-4', days: 8, rxReps: 12, rxLoad: 20, sets: [{ reps: '12', weightKg: '20' }, { reps: '12', weightKg: '20' }] },
      { id: 'observed-5', days: 5, rxReps: 8, rxLoad: 22.5, sets: [{ reps: '8', weightKg: '22.5' }, { reps: '8', weightKg: '22.5' }] },
    ];
    await page.evaluate(async ({ rows }) => {
      const mod = await import('/src/lib/store.js');
      const { buildPrescriptionSnapshot } = await import('/src/lib/progression.js');
      const iso = (days) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() - days);
        return date.toISOString().slice(0, 10);
      };
      const store = mod.loadStore();
      store.history = rows.map((row) => {
        const dateISO = iso(row.days);
        return {
          id: row.id,
          dateISO,
          blocks: [{
            exerciseId: 'bench-press-dumbbell',
            prescription: buildPrescriptionSnapshot({
              session: { id: row.id, dateISO },
              block: { exerciseId: 'bench-press-dumbbell', sets: 2, reps: '8–12' },
              blockIndex: 0,
              recommendation: { reps: row.rxReps, load: row.rxLoad, reason: 'e2e prescription', priorsVersion: 1, policy: 'standard' },
              prescribedAt: `${dateISO}T09:00:00.000Z`,
              policy: 'standard',
            }),
            sets: row.sets.map((s) => ({ completed: true, ...s })),
          }],
        };
      });
      mod.saveStore(store);
    }, { rows });
    await page.reload();
    await tapTab(page, 'Progress');
    const card = page.getByRole('region', { name: 'Am I improving' });
    await expect(card.getByText('Likely improving')).toBeVisible();
    await expect(card.getByText(/Actual prescription follow-through \d+%/)).toBeVisible();
    await expect(card.getByText(/Data coverage: Moderate/)).toBeVisible();
    await expect(card.getByText(/Retrospective engine replay/)).toHaveCount(0);
  });
});

test.describe('Prospective prescription capture', () => {
  test.beforeEach(async ({ page }) => completeOnboarding(page));

  // The undecided-consent card appears inline and shifts layout mid-flow;
  // dismiss it up front so taps land where aimed (same as guided-mode.spec).
  async function dismissConsentCard(page){
    const consent = page.getByRole('dialog', { name: 'Local measurement consent' });
    if(await consent.isVisible().catch(() => false)){
      await consent.getByRole('button', { name: 'No thanks' }).click();
    }
    await expect(consent).toBeHidden();
  }

  test('freezes the shown prescription at display time, persists it to the draft, and copies it at save', async ({ page }) => {
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
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    const startBtn = page.getByRole('button', { name: /Start workout|Start this session/ }).first();
    if (await startBtn.isVisible()) await startBtn.click();
    const runner = page.getByRole('dialog', { name: /Session —/ });
    await expect(runner).toBeVisible({ timeout: 8000 });

    // Before any set is logged, the draft already carries the frozen snapshot —
    // proof it was captured when the target was shown, not at save time.
    await expect.poll(async () => page.evaluate(async () => {
      const { loadStore } = await import('/src/lib/store.js');
      return loadStore().activeWorkout?.blocks?.[0]?.prescription?.prescriptionId || null;
    }), { timeout: 8000, message: 'display-time snapshot persisted to the draft' }).toBeTruthy();
    const shown = await page.evaluate(async () => {
      const { loadStore } = await import('/src/lib/store.js');
      const rx = loadStore().activeWorkout?.blocks?.[0]?.prescription;
      return rx ? { id: rx.prescriptionId, source: rx.source, revision: rx.revision, firstShownAt: rx.firstShownAt, createdAt: rx.createdAt } : null;
    });
    expect(shown.source).toBe('engine');
    expect(shown.revision).toBe(1);
    expect(shown.firstShownAt).toBeTruthy();
    expect(shown.createdAt).toBeTruthy();

    // Log one real set, then fill the rest, then save.
    const repInputs = runner.getByPlaceholder('8');
    if (await repInputs.first().isVisible()) await repInputs.first().fill('8');
    const loadInputs = runner.getByPlaceholder('kg');
    if (await loadInputs.first().isVisible()) await loadInputs.first().fill('12');
    const doneButtons = runner.getByRole('button', { name: 'Done' });
    if (await doneButtons.count()) await doneButtons.first().click();

    const applyAll = runner.getByRole('button', { name: 'Apply all' });
    if (await applyAll.isVisible().catch(() => false)) await applyAll.click();
    const remainingReps = runner.getByPlaceholder('8');
    const remainingCount = await remainingReps.count();
    for (let i = 0; i < remainingCount; i++) {
      if (!(await remainingReps.nth(i).inputValue())) await remainingReps.nth(i).fill('8');
    }
    const saveBtn = runner.getByRole('button', { name: 'Save session' });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();

    const saved = await page.evaluate(async () => {
      const { loadStore } = await import('/src/lib/store.js');
      const store = loadStore();
      const last = store.history[store.history.length - 1];
      const rx = last?.blocks?.[0]?.prescription;
      return { draftGone: !store.activeWorkout, startedAt: last?.startedAt, finishedAt: last?.finishedAt, id: rx?.prescriptionId, revision: rx?.revision, firstShownAt: rx?.firstShownAt };
    });
    expect(saved.draftGone).toBe(true);
    expect(saved.id).toBe(shown.id);
    expect(saved.revision).toBe(1);
    // First-visible capture: the shown stamp falls inside the session window
    // and is copied verbatim by save (never rebuilt to finishedAt).
    expect(saved.firstShownAt).toBe(shown.firstShownAt);
    expect(Date.parse(saved.firstShownAt)).toBeGreaterThanOrEqual(Date.parse(saved.startedAt));
    expect(Date.parse(saved.firstShownAt)).toBeLessThanOrEqual(Date.parse(saved.finishedAt));
  });

  test('Gym Mode defers capture: only the focused block is frozen, later blocks wait', async ({ page }) => {
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

    // Start the session already in Gym Mode (focus is one block at a time).
    await page.evaluate(async () => {
      const { loadStore, saveStore } = await import('/src/lib/store.js');
      const store = loadStore();
      store.preferences = { ...(store.preferences || {}), focusDefault: true };
      saveStore(store);
    });
    await page.reload();
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    const startBtn = page.getByRole('button', { name: /Start workout|Start this session/ }).first();
    if (await startBtn.isVisible()) await startBtn.click();
    const runner = page.getByRole('dialog', { name: /Session —/ });
    await expect(runner).toBeVisible({ timeout: 8000 });

    // The focused block (0) is captured; the not-yet-shown block (1) is not.
    await expect.poll(async () => page.evaluate(async () => {
      const { loadStore } = await import('/src/lib/store.js');
      return loadStore().activeWorkout?.blocks?.[0]?.prescription?.prescriptionId || null;
    }), { timeout: 8000, message: 'focused block captured' }).toBeTruthy();
    const focusOnly = await page.evaluate(async () => {
      const { loadStore } = await import('/src/lib/store.js');
      const blocks = loadStore().activeWorkout?.blocks || [];
      return { first: !!blocks[0]?.prescription, second: !!blocks[1]?.prescription, count: blocks.length };
    });
    expect(focusOnly.first).toBe(true);
    if (focusOnly.count > 1) expect(focusOnly.second).toBe(false, 'a hidden block must not be frozen yet');

    // Work through the focused block's sets so focus advances to block 1,
    // which is only then captured (delayed first-visible).
    for (let guard = 0; guard < 6; guard++) {
      const repInputs = runner.getByPlaceholder('8');
      for (let i = 0; i < await repInputs.count(); i++) if (!(await repInputs.nth(i).inputValue())) await repInputs.nth(i).fill('8');
      const complete = runner.getByRole('button', { name: 'Complete next set' });
      if (await complete.isVisible().catch(() => false)) await complete.click();
      else break;
    }

    await expect.poll(async () => page.evaluate(async () => {
      const { loadStore } = await import('/src/lib/store.js');
      return loadStore().activeWorkout?.blocks?.[1]?.prescription?.prescriptionId || null;
    }), { timeout: 8000, message: 'newly focused block captured on visibility' }).toBeTruthy();
  });

  test('a swap after completed work splits the block instead of relabelling it', async ({ page }) => {
    await dismissConsentCard(page);
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
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    const startBtn = page.getByRole('button', { name: /Start workout|Start this session/ }).first();
    if (await startBtn.isVisible()) await startBtn.click();
    const runner = page.getByRole('dialog', { name: /Session —/ });
    await expect(runner).toBeVisible({ timeout: 8000 });

    const original = await page.evaluate(async () => {
      const { loadStore } = await import('/src/lib/store.js');
      return loadStore().activeWorkout?.blocks?.[0]?.exerciseId || null;
    });
    expect(original).toBeTruthy();

    // Complete the first set (its reps are pre-filled by the runner) under the
    // original exercise, before any swap.
    await runner.getByRole('button', { name: 'Done' }).first().click();

    // Open the substitution sheet and take the first equipment-aware option.
    await runner.getByRole('button', { name: 'Swap', exact: true }).first().click();
    const options = runner.locator('[aria-label="Exercise substitutions"] button').filter({ hasText: 'Use' });
    test.skip(await options.count() === 0, 'no substitution available for this kit');
    await options.first().click();

    // The completed set stays on the original exercise; a new block appears.
    await expect.poll(async () => page.evaluate(async (orig) => {
      const { loadStore } = await import('/src/lib/store.js');
      const blocks = loadStore().activeWorkout?.blocks || [];
      const keep = blocks.find((b)=> b.exerciseId === orig);
      return blocks.length >= 2 && keep?.sets?.some((s)=> s.completed) && blocks.some((b)=> b.exerciseId !== orig);
    }, original), { timeout: 8000, message: 'block split with original work preserved' }).toBeTruthy();

    // Logging resumes where the swap landed: a reps field is focused so the
    // substitution costs no hunt-and-tap to continue from.
    await expect.poll(async () => page.evaluate(() => document.activeElement?.getAttribute?.('aria-label') || ''), { timeout: 5000, message: 'focus lands on a reps field after swap' }).toMatch(/^Reps set \d+$/);

    // Focus must be inside the REPLACEMENT block (B), never the performed
    // original (A): a partial split leaves A at the old index, so an
    // index-based resume would focus finished work.
    const focusBlock = await page.evaluate(async () => {
      const { loadStore } = await import('/src/lib/store.js');
      const active = document.activeElement;
      const container = active?.closest?.('[id^="block-"]');
      const idx = container ? Number(String(container.id).replace('block-', '')) : null;
      const blocks = loadStore().activeWorkout?.blocks || [];
      const block = Number.isInteger(idx) ? blocks[idx] : null;
      return {
        exerciseId: block?.exerciseId || null,
        completedInBlock: (block?.sets || []).filter((s)=> s.completed).length,
        totalInBlock: (block?.sets || []).length,
        setIds: (block?.sets || []).map((s)=> s.setId || null),
      };
    });
    const replacementId = await page.evaluate(async (orig) => {
      const { loadStore } = await import('/src/lib/store.js');
      const blocks = loadStore().activeWorkout?.blocks || [];
      const other = blocks.find((b)=> b.exerciseId !== orig);
      return other ? other.exerciseId : null;
    }, original);
    expect(replacementId).toBeTruthy();
    expect(focusBlock.exerciseId).toBe(replacementId);
    expect(focusBlock.completedInBlock).toBe(0);
    expect(focusBlock.totalInBlock).toBeGreaterThan(0);

    // Save the session, then wait until the save is actually visible in the
    // store: React commits state and persists asynchronously, so reading
    // history immediately after the click races the commit. The read itself
    // is polled (not just its presence) so save-commit timing can never
    // make the test read a half-committed history entry.
    await runner.getByRole('button', { name: 'Save session' }).click();
    let saved = null;
    await expect.poll(async () => { saved = await page.evaluate(async (orig) => {
      const { loadStore } = await import('/src/lib/store.js');
      const last = loadStore().history[loadStore().history.length - 1];
      if(!last) return null;
      const blocks = last.blocks || [];
      const keep = blocks.find((b)=> b.exerciseId === orig);
      const other = blocks.find((b)=> b.exerciseId !== orig);
      return {
        ids: blocks.map((b)=> b.exerciseId),
        keepHasCompleted: !!keep?.sets?.some((s)=> s.completed),
        keepSetCount: (keep?.sets || []).length,
        otherCompletedCount: (other?.sets || []).filter((s)=> s.completed).length,
        otherSetCount: (other?.sets || []).length,
        keepPrescriptionId: keep?.prescription?.prescriptionId || null,
        keepPrescriptionExercise: keep?.prescription?.exerciseId || null,
        otherPrescriptionChange: other?.prescription?.changeReason || null,
        otherSupersedes: other?.prescription?.supersedesPrescriptionId || null,
        keepSetIds: (keep?.sets || []).map((s)=> s.setId || null),
        otherSetIds: (other?.sets || []).map((s)=> s.setId || null),
      };
    }, original); return saved; }, { timeout: 10000, message: 'saved split lands in history' }).not.toBeNull();
    expect(saved.ids.filter((id)=> id !== original).length).toBeGreaterThan(0, 'a replacement block exists');
    expect(saved.keepHasCompleted).toBe(true, 'completed work stays under the original exercise');
    expect(saved.keepSetCount).toBe(1, 'the original block keeps only its performed set');
    expect(saved.otherCompletedCount).toBe(0, 'the replacement block contains only remaining work');
    expect(saved.otherSetCount).toBeGreaterThan(0);
    expect(saved.keepPrescriptionExercise).toBe(original, 'the original prescription keeps its exercise');
    expect(saved.otherPrescriptionChange).toBe('exercise-substituted');
    expect(saved.otherSupersedes).toBe(saved.keepPrescriptionId);
    // Set identity: no id appears on both sides of the split.
    expect(saved.keepSetIds.filter((id)=> id && saved.otherSetIds.includes(id))).toEqual([]);

    // Reload: the split survives as saved history. Durability is gated on
    // the app's own write queue (whenPersisted) — reloading before the
    // async persist drains would test timing luck, not the split. Two
    // animation frames first: React persists from a passive effect, so the
    // write must be ENQUEUED (not merely state-committed) before waiting.
    await page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const { whenPersisted } = await import('/src/lib/storage.js');
      await whenPersisted();
    });
    await page.reload();
    // Boot hydration is async (IndexedDB): the freshly loaded page reads an
    // empty store until it completes, so the whole reloaded read is polled
    // — otherwise the test measures boot timing, not split durability.
    let reloaded = null;
    await expect.poll(async () => { reloaded = await page.evaluate(async (orig) => {
      const { loadStore } = await import('/src/lib/store.js');
      const last = loadStore().history[loadStore().history.length - 1];
      if(!last) return null;
      const blocks = last.blocks || [];
      return {
        ids: blocks.map((b)=> b.exerciseId),
        keepHasCompleted: !!blocks.find((b)=> b.exerciseId === orig)?.sets?.some((s)=> s.completed),
      };
    }, original); return reloaded; }, { timeout: 15000, message: 'saved history rehydrates after reload' }).not.toBeNull();
    expect(reloaded.ids.filter((id)=> id !== original).length).toBeGreaterThan(0);
    expect(reloaded.keepHasCompleted).toBe(true);
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
