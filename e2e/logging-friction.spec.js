import { test, expect } from '@playwright/test';

// RIR suggestion friction + measurement semantics. A carried RIR is a
// suggestion, never an observation: completing a set with a measured RIR
// offers it on the next row (Same / − / +), but NOTHING persists until the
// user confirms or types. Done alone never confirms. Load/reps carry stays
// fully automatic. Event counts below are the measured interaction cost:
// Same-confirm costs exactly one value-free action; typing costs one commit.

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

async function fillRemainingReps(runner){
  const repsInputs = runner.getByLabel(/^Reps set \d+$/);
  const n = await repsInputs.count();
  for(let i = 0; i < n; i++){
    if(!(await repsInputs.nth(i).inputValue())) await repsInputs.nth(i).fill('8');
  }
}

async function savedSets(page){
  return page.evaluate(async () => {
    const { loadStore } = await import('/src/lib/store.js');
    const store = loadStore();
    return store.history[store.history.length - 1]?.blocks?.[0]?.sets || null;
  });
}

async function logFirstSet(runner){
  const rirInputs = runner.getByLabel(/Reps in reserve set/);
  await expect(rirInputs.first()).toBeVisible({ timeout: 5000 });
  expect(await rirInputs.count()).toBeGreaterThanOrEqual(2);
  await runner.getByLabel(/^Reps set \d+$/).nth(0).fill('8');
  await runner.getByLabel(/Load set \d+ in kilograms/).nth(0).fill('20');
  await rirInputs.nth(0).fill('2');
  await runner.getByRole('button', { name: 'Done' }).nth(0).click();
  return rirInputs;
}

test('an unconfirmed RIR suggestion never reaches saved history', async ({ page }) => {
  await completeOnboarding(page);
  await enableTelemetry(page);
  const runner = await startWorkout(page);
  const rirInputs = await logFirstSet(runner);

  // The suggestion is offered — but the input stays empty (no observation).
  const suggestion = runner.getByRole('group', { name: 'Suggested RIR 2 for set 2' });
  await expect(suggestion).toBeVisible({ timeout: 5000 });
  await expect(rirInputs.nth(1)).toHaveValue('');

  // Done WITHOUT confirming: the set completes with no RIR recorded.
  await runner.getByRole('button', { name: 'Done' }).nth(1).click();
  await fillRemainingReps(runner);
  const saveBtn = runner.getByRole('button', { name: 'Save session' });
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await expect(runner).toBeHidden({ timeout: 8000 });

  const sets = await savedSets(page);
  expect(sets[0].rpe).toBe('8'); // RIR 2 → RPE 8, typed on set 1
  expect(sets[1].rpe).toBe('');  // suggestion ignored → unrecorded, never inferred
  const { counts } = await eventCounts(page);
  console.log(`friction counts (unconfirmed): ${JSON.stringify(counts)}`);
  expect(counts['rir-suggestion-shown'] || 0).toBeGreaterThanOrEqual(1);
  expect(counts['rir-suggestion-confirmed'] || 0).toBe(0);
  expect(counts['rir-field-commit'] || 0).toBe(1); // only set 1's typed entry
});

test('Same confirms in one tap; load/reps carry stays automatic', async ({ page }) => {
  await completeOnboarding(page);
  await enableTelemetry(page);
  const runner = await startWorkout(page);
  const rirInputs = await logFirstSet(runner);

  // Load + reps still arrive prefilled automatically.
  await expect(runner.getByLabel(/^Reps set \d+$/).nth(1)).toHaveValue('8');
  await expect(runner.getByLabel(/Load set \d+ in kilograms/).nth(1)).toHaveValue('20');

  // One tap confirms the suggestion; the input fills and the bar retires.
  await runner.getByRole('button', { name: 'Use suggested RIR 2 for set 2' }).click();
  await expect(rirInputs.nth(1)).toHaveValue('2');
  await expect(runner.getByRole('group', { name: 'Suggested RIR 2 for set 2' })).toBeHidden();

  await runner.getByRole('button', { name: 'Done' }).nth(1).click();
  await fillRemainingReps(runner);
  const saveBtn = runner.getByRole('button', { name: 'Save session' });
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await expect(runner).toBeHidden({ timeout: 8000 });

  const sets = await savedSets(page);
  expect(sets[1].rpe).toBe('8'); // confirmed RIR 2 persists as an observation
  const { counts } = await eventCounts(page);
  console.log(`friction counts (Same-confirm): ${JSON.stringify(counts)}`);
  expect(counts['rir-suggestion-confirmed'] || 0).toBe(1);
});

test('a typed RIR edit persists normally without confirming', async ({ page }) => {
  await completeOnboarding(page);
  await enableTelemetry(page);
  const runner = await startWorkout(page);
  const rirInputs = await logFirstSet(runner);

  await expect(runner.getByRole('group', { name: 'Suggested RIR 2 for set 2' })).toBeVisible({ timeout: 5000 });
  // Typing a different value overrides the suggestion — no confirm needed.
  await rirInputs.nth(1).fill('3');
  await runner.getByRole('button', { name: 'Done' }).nth(1).click();
  await fillRemainingReps(runner);
  const saveBtn = runner.getByRole('button', { name: 'Save session' });
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await expect(runner).toBeHidden({ timeout: 8000 });

  const sets = await savedSets(page);
  expect(sets[1].rpe).toBe('7'); // typed RIR 3 → RPE 7
  const { counts } = await eventCounts(page);
  console.log(`friction counts (typed-edit): ${JSON.stringify(counts)}`);
  expect(counts['rir-suggestion-confirmed'] || 0).toBe(0);
  expect(counts['rir-field-commit'] || 0).toBe(2); // one typed entry per set
});
