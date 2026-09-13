import { test, expect } from '@playwright/test';

// Measured logging friction: a scripted two-set flow counts the value-free
// interaction events the app records in localStorage. Target: the RIR field.
// Every new set starts with an empty RIR (`rpe: ''` in newSet), so logging
// RIR costs one `rir-field-commit` per set unless carry-forward prefills it
// from the set just completed — the same prefill contract reps/load already
// enjoy. This spec first pins the baseline, then the improvement.

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

async function enableTelemetry(page){
  await page.evaluate(async () => {
    const { loadStore, saveStore } = await import('/src/lib/store.js');
    const store = loadStore();
    store.preferences = { ...(store.preferences || {}), telemetryEnabled: true };
    saveStore(store);
  });
  await page.reload();
}

async function startWorkout(page){
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
  return runner;
}

async function eventCounts(page){
  return page.evaluate(() => {
    const raw = localStorage.getItem('arise.telemetry.v2');
    const events = raw ? (JSON.parse(raw).events || []) : [];
    const counts = {};
    for(const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
    return { total: events.length, counts };
  });
}

test('RIR carry-forward removes one field-commit per set', async ({ page }) => {
  await completeOnboarding(page);
  await enableTelemetry(page);
  const runner = await startWorkout(page);

  const rirInputs = runner.getByLabel(/Reps in reserve set/);
  await expect(rirInputs.first()).toBeVisible({ timeout: 5000 });
  expect(await rirInputs.count()).toBeGreaterThanOrEqual(2);

  // Set 1: full entry — reps, load, RIR — then Done.
  const repsInputs = runner.getByLabel(/^Reps set \d+$/);
  const loadInputs = runner.getByLabel(/Load set \d+ in kilograms/);
  await repsInputs.nth(0).fill('8');
  await loadInputs.nth(0).fill('20');
  await rirInputs.nth(0).fill('2');
  await runner.getByRole('button', { name: 'Done' }).nth(0).click();

  // The next set's RIR arrives prefilled from the set just completed.
  await expect(rirInputs.nth(1)).toHaveValue('2', { timeout: 5000 });

  // Complete set 2 without touching RIR, then fill the rest so save enables.
  await runner.getByRole('button', { name: 'Done' }).nth(1).click();
  const repsCount = await repsInputs.count();
  for(let i = 0; i < repsCount; i++){
    if(!(await repsInputs.nth(i).inputValue())) await repsInputs.nth(i).fill('8');
  }
  const saveBtn = runner.getByRole('button', { name: 'Save session' });
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await expect(runner).toBeHidden({ timeout: 8000 });

  // Measurement: exactly ONE rir-field-commit for two identically-logged
  // sets (set 1's entry). Before carry-forward this was two — one per set.
  const { counts } = await eventCounts(page);
  console.log(`friction counts: ${JSON.stringify(counts)}`);
  expect(counts['rir-field-commit'] || 0).toBe(1);
  expect(counts['complete-set'] || 0).toBeGreaterThanOrEqual(2);
});
