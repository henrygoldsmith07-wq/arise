import { test, expect } from '@playwright/test';

// The two Progress cards that surface engine intelligence which was previously
// computed and unit-tested but never rendered. These pin the honest-rendering
// contract in a REAL browser: a card appears when the evidence supports it and
// stays absent when it does not, and every number comes from seeded history.
//
// Both cards live behind the EXPERT experience level, matching the existing
// "Volume landmarks (sets/week)" card — advanced analytics are opt-in there, and
// the standard-level Progress baseline is the one under visual regression.

async function seedHistory(page, sessions, experience = 'expert'){
  await page.evaluate(async ({ rows, level, onboarding }) => {
    const mod = await import('/src/lib/store.js');
    const store = mod.loadStore();
    store.history = rows;
    // Onboarding is completed implicitly: without it the onboarding dialog
    // still covers the app and swallows the tab clicks. The point of these
    // tests is the Progress cards, not the first-run flow (covered elsewhere).
    if(!store.onboarding) store.onboarding = onboarding;
    store.preferences = { ...(store.preferences || {}), experience: level };
    mod.saveStore(store);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const { whenPersisted } = await import('/src/lib/storage.js');
    await whenPersisted();
  }, { rows: sessions, level: experience, onboarding: { goal: 'strength', equipment: ['dumbbells', 'bench'], location: 'home', level: 'Beginner', daysPerWeek: 3, availableMinutes: 45 } });
  await page.reload();
}

// A flat 4-week lopsided block: chest every week, nothing for the other
// goal-priority muscles. Verdicts must be RELATIVE, so the same shape at a
// bigger total has to give the same answer.
function lopsided(weight){
  const rows = [];
  for(let w = 0; w < 4; w++){
    const d = new Date(Date.UTC(2026, 6, 6 + w * 7)).toISOString().slice(0, 10);
    rows.push({
      id: `s-${weight}-${w}`, dateISO: d, savedAt: `${d}T10:00:00.000Z`,
      blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '10', weightKg: weight }, { reps: '10', weightKg: weight }] }],
    });
  }
  return rows;
}

// These cards are plain <section> + <h3>, matching every other Progress card
// (one card is not a page region). So target them by heading and scope the
// assertions to the enclosing section.
const card = (page, name) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) }).first();

test.describe('Progress insight cards', () => {
  test('Volume balance renders for lopsided weeks and names the real muscle', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await seedHistory(page, lopsided(20));

    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();

    const c = card(page, 'Volume balance');
    await expect(c).toBeVisible({ timeout: 5000 });
    // The advice names a muscle that actually exists in the training data,
    // and the flagged row shows the share vs the expected share.
    await expect(c).toContainText(/Chest/);
    await expect(c).toContainText('%');
    await expect(c).toContainText(/sets\/wk/);
    // It must not claim to be a prescription.
    await expect(c).toContainText(/not a prescription/i);
  });

  test('Volume balance verdicts do not change with total load', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await seedHistory(page, lopsided(20));

    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    const light = await card(page, 'Volume balance').innerText();

    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await seedHistory(page, lopsided(60));
    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    const heavy = await card(page, 'Volume balance').innerText();

    // Same muscles, same verdicts — only the weights behind them differ.
    const muscles = (t) => (t.match(/(Chest|Back|Legs|Glutes|Shoulders|Arms|Core|Cardio|Full body)/g) || []).join('|');
    expect(muscles(heavy)).toBe(muscles(light));
    expect(heavy).toContain('2 sets/wk');
    expect(light).toContain('2 sets/wk');
  });

  test('Left/right balance renders only when sides are actually tagged', async ({ page }) => {
    const rows = lopsided(20);
    // Tag sides on a unilateral lift with a ~11% gap.
    rows.push({
      id: 's-unilateral', dateISO: '2026-07-08', savedAt: '2026-07-08T10:00:00.000Z',
      blocks: [{ exerciseId: 'bulgarian-split-squat', sets: [
        { reps: '10', weightKg: 10, side: 'L' },
        { reps: '8', weightKg: 10, side: 'R' },
      ] }],
    });

    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await seedHistory(page, rows);

    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    const c = card(page, 'Left/right balance');
    await expect(c).toBeVisible({ timeout: 5000 });
    await expect(c).toContainText(/behind/i);
    await expect(c).toContainText(/L \/ R|Left|Right/);
    // It tells the user the number is only as good as their tagging.
    await expect(c).toContainText(/tagged/i);
  });

  test('no imbalance card when no sides are tagged', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await seedHistory(page, lopsided(20));

    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
    // The engine must not invent an imbalance it cannot see.
    await expect(card(page, 'Left/right balance')).toHaveCount(0);
  });

  test('no volume-balance card with under two weeks of data', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    // One week only: balance is unjudgeable, so the card must be absent.
    await seedHistory(page, lopsided(20).slice(0, 1));

    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
    await expect(card(page, 'Volume balance')).toHaveCount(0);
  });

  test('both cards stay hidden at the standard experience level', async ({ page }) => {
    // The expert gate is the product IA, not an accident: it is also what keeps
    // the standard-level Progress visual baseline stable.
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await seedHistory(page, lopsided(20), 'standard');

    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
    await expect(card(page, 'Volume balance')).toHaveCount(0);
    await expect(card(page, 'Left/right balance')).toHaveCount(0);
  });
});
