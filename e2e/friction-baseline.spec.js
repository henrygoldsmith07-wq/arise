import { test, expect } from '@playwright/test';
import { loadBaselines, checkLive, formatReport } from '../benchmark/friction-baselines.js';
import { measureHitArea, gateVerdict } from './hit-target.js';

// Executable baselines: docs/friction-baseline.json is validated on load
// (schema + every derived delta/%/direction recomputed — hand-maintained
// claims that disagree fail before any probe runs), and each probe's live
// metrics are checked against its guardrails. Reports print the validated
// stored claims; wall-clock timings are apparatus timings, never gated and
// never presented as human performance.
const DOC = loadBaselines();

function liveCounts(probe){
  return {
    inputFocus: probe.focus?.inputFocus ?? NaN,
    focusin: probe.focus?.focusin ?? NaN,
    loadCommits: probe.counts['load-field-commit'] || 0,
    rirCommits: probe.counts['rir-field-commit'] || 0,
    completes: probe.counts['complete-set'] || 0,
  };
}

// True 44px gate, shared with hit-target-gate.spec.js (which calibrates it
// against known-geometry synthetic controls): effective span ≥43.5 plus
// central-42px coverage probes.
async function expectHit44(page, locator, label){
  const measured = await measureHitArea(page, locator);
  const verdict = gateVerdict(measured);
  expect(verdict, `${label} true 44px gate (span ${Math.round(measured.w * 10) / 10}×${Math.round(measured.h * 10) / 10}, probes ${measured.hits.map(Number).join('')})`).toBe('pass');
}

// Friction baseline probe (per mode): a FIXED scripted flow whose telemetry
// action counts are deterministic. Rerun after any logging-flow change and
// diff the counts. Wall-clock timings below are apparatus timings (Playwright
// speed), not human times — the comparable signals are the ACTION counts and
// the focus/keyboard cycles. Telemetry carries no entered values by design.

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
    store.preferences = { ...(store.preferences || {}), telemetryEnabled: true, telemetryOptions: { sessionTimings: true } };
    saveStore(store);
  });
  await page.reload();
}

async function startStandardWorkout(page){
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

async function startFocusCounters(page){
  await page.evaluate(() => {
    window.__focusLog = { focusin: 0, inputFocus: 0 };
    document.addEventListener('focusin', (e) => {
      window.__focusLog.focusin++;
      const t = e.target;
      if(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) window.__focusLog.inputFocus++;
    });
  });
}

const VALUE_KEYS = ['target', 'suggestedTarget', 'load', 'loadKg', 'reps', 'rir', 'weightKg', 'assistedKg', 'assistKg', 'value'];

async function readProbe(page){
  return page.evaluate((valueKeys) => {
    const raw = localStorage.getItem('arise.telemetry.v2');
    const events = raw ? (JSON.parse(raw).events || []) : [];
    const counts = {};
    let saveMs = null;
    let valueLeak = null;
    for(const e of events){
      counts[e.type] = (counts[e.type] || 0) + 1;
      if(e.type === 'session:save' && Number.isFinite(e.durationMs)) saveMs = e.durationMs;
      for(const k of valueKeys){
        if(k in e && !valueLeak) valueLeak = `${e.type}.${k}`;
      }
    }
    return { counts, saveMs, valueLeak, focus: window.__focusLog || null };
  }, VALUE_KEYS);
}

async function fillRemainingReps(runner){
  const repsInputs = runner.getByLabel(/^Reps set \d+$/);
  const n = await repsInputs.count();
  for(let i = 0; i < n; i++){
    if(!(await repsInputs.nth(i).inputValue())) await repsInputs.nth(i).fill('8');
  }
}

test('baseline probe — standard mode two-set flow', async ({ page }) => {
  await completeOnboarding(page);
  await enableTelemetry(page);
  const runner = await startStandardWorkout(page);
  await startFocusCounters(page);

  const rirInputs = runner.getByLabel(/Reps in reserve set/);
  await expect(rirInputs.first()).toBeVisible({ timeout: 5000 });
  await runner.getByLabel(/^Reps set \d+$/).nth(0).fill('8');
  await runner.getByLabel(/Load set \d+ in kilograms/).nth(0).fill('20');
  await rirInputs.nth(0).fill('2');
  await runner.getByRole('button', { name: 'Done' }).nth(0).click();
  // Same-confirm the suggested RIR, complete set 2, fill the rest, save.
  const same = runner.getByRole('button', { name: /Use suggested RIR/ });
  if(await same.isVisible().catch(() => false)) await same.click();
  await runner.getByRole('button', { name: 'Done' }).nth(1).click();
  await fillRemainingReps(runner);
  const saveBtn = runner.getByRole('button', { name: 'Save session' });
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await expect(runner).toBeHidden({ timeout: 8000 });

  const probe = await readProbe(page);
  console.log(`BASELINE standard: ${JSON.stringify(probe)}`);
  expect(probe.counts['complete-set']).toBeGreaterThanOrEqual(2);
  // Focus-skip: set 2 arrives prefilled with an RIR suggestion pending, so
  // no auto-focus fires and the keyboard stays down (was 4 input focuses).
  expect(probe.focus.inputFocus).toBe(3);
  expect(probe.valueLeak).toBeNull();
  console.log(formatReport(checkLive(DOC, 'standard-two-set', liveCounts(probe))));
});

test('baseline probe — gym mode two-set flow', async ({ page }) => {
  await completeOnboarding(page);
  await enableTelemetry(page);
  const runner = await startStandardWorkout(page);
  await runner.locator('button[title*="Gym mode"]').click();
  await startFocusCounters(page);

  const doneBtns = runner.getByRole('button', { name: 'Done' });
  await expect(doneBtns.first()).toBeVisible({ timeout: 5000 });
  // Set 1 via the row inputs, then Done; set 2 the same.
  const rirInputs = runner.getByLabel(/Reps in reserve set/);
  await runner.getByLabel(/^Reps set \d+$/).first().fill('8');
  await runner.getByLabel(/Load set \d+ in kilograms/).first().fill('20');
  if(await rirInputs.first().isVisible().catch(() => false)) await rirInputs.first().fill('2');
  await doneBtns.first().click();
  const same = runner.getByRole('button', { name: /Use suggested RIR/ });
  if(await same.isVisible().catch(() => false)) await same.click();
  const done2 = runner.getByRole('button', { name: 'Done' });
  if(await done2.count() > 1) await done2.nth(1).click();
  else await done2.first().click();
  await fillRemainingReps(runner);
  const saveBtn = runner.getByRole('button', { name: 'Save session' });
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await expect(runner).toBeHidden({ timeout: 8000 });

  const probe = await readProbe(page);
  console.log(`BASELINE gym: ${JSON.stringify(probe)}`);
  expect(probe.counts['complete-set']).toBeGreaterThanOrEqual(2);
  expect(probe.focus.inputFocus).toBe(3);
  expect(probe.valueLeak).toBeNull();
  console.log(formatReport(checkLive(DOC, 'gym-two-set', liveCounts(probe))));
});

test('swap friction — open → select → logging resumed', async ({ page }) => {
  await completeOnboarding(page);
  await enableTelemetry(page);
  const runner = await startStandardWorkout(page);
  await startFocusCounters(page);

  // One completed set under the original exercise, so the swap splits.
  await runner.getByLabel(/^Reps set \d+$/).nth(0).fill('8');
  await runner.getByRole('button', { name: 'Done' }).nth(0).click();

  const focusBefore = await page.evaluate(() => ({ ...window.__focusLog }));
  await runner.getByRole('button', { name: 'Swap', exact: true }).first().click();
  const options = runner.locator('[aria-label="Exercise substitutions"] button').filter({ hasText: 'Use' });
  test.skip(await options.count() === 0, 'no substitution available for this kit');
  await options.first().click();

  // Resume lands focused inside the replacement block (stable identity, not
  // the old index) — measured, not assumed.
  const focusedLabel = await expect.poll(async () => page.evaluate(() => document.activeElement?.getAttribute?.('aria-label') || ''), { timeout: 5000 }).toMatch(/^Reps set \d+$/);
  void focusedLabel;
  const probe = await readProbe(page);
  const focusAfter = probe.focus;
  const swapCommit = await page.evaluate(() => {
    const raw = localStorage.getItem('arise.telemetry.v2');
    const events = raw ? (JSON.parse(raw).events || []) : [];
    return events.find((e) => e.type === 'swap-commit') || null;
  });
  console.log(`friction swap: ${JSON.stringify({ counts: probe.counts, focusDelta: { focusin: focusAfter.focusin - focusBefore.focusin, inputFocus: focusAfter.inputFocus - focusBefore.inputFocus }, commitElapsedMs: swapCommit?.elapsedMs ?? null })}`);
  // Guardrailed against the executable baseline (2 logged actions minimum by
  // construction; resume focus measured, never assumed).
  console.log(formatReport(checkLive(DOC, 'swap-resume', {
    swapOpens: probe.counts['swap-open'] || 0,
    swapCommits: probe.counts['swap-commit'] || 0,
    resumeFocus: focusAfter.focusin - focusBefore.focusin,
  })));
  // Timing consent is on in probes, so the open→commit interval is recorded
  // (apparatus time here — the comparable signal is that it EXISTS and the
  // path costs exactly 2 logged actions).
  expect(Number.isFinite(swapCommit?.elapsedMs)).toBe(true);
  expect(probe.valueLeak).toBeNull();
});

test('touch targets meet the 44px one-thumb bar', async ({ page }) => {
  await completeOnboarding(page);
  await enableTelemetry(page);
  const runner = await startStandardWorkout(page);

  // RIR suggestion bar: Same / − / + must each clear a true 44×44.
  const rirInputs = runner.getByLabel(/Reps in reserve set/);
  await expect(rirInputs.first()).toBeVisible({ timeout: 5000 });
  await runner.getByLabel(/^Reps set \d+$/).nth(0).fill('8');
  await runner.getByLabel(/Load set \d+ in kilograms/).nth(0).fill('20');
  await rirInputs.nth(0).fill('2');
  await runner.getByRole('button', { name: 'Done' }).nth(0).click();
  const same = runner.getByRole('button', { name: /Use suggested RIR/ });
  await expect(same).toBeVisible({ timeout: 5000 });
  for(const name of [/Use suggested RIR/, /Decrease suggested RIR/, /Increase suggested RIR/]){
    await expectHit44(page, runner.getByRole('button', { name }).first(), String(name));
  }
  // High-frequency runner controls: Done, both rep steppers, Swap, + Set,
  // the remove-× (expanded hit area) and the keypad launcher.
  await expectHit44(page, runner.getByRole('button', { name: 'Done' }).first(), 'Done');
  await expectHit44(page, runner.getByRole('button', { name: /Decrease reps set/ }).first(), 'reps stepper −');
  await expectHit44(page, runner.getByRole('button', { name: /Increase reps set/ }).first(), 'reps stepper +');
  await expectHit44(page, runner.getByRole('button', { name: 'Swap', exact: true }).first(), 'Swap');
  await expectHit44(page, runner.getByRole('button', { name: '+ Set' }).first(), '+ Set');
  await expectHit44(page, runner.getByRole('button', { name: /Remove set/ }).first(), 'remove set ×');
  // No control may cover another: the load-keypad launcher must be the
  // hit target at its own center (previously the reps steppers spilled over
  // it on narrow viewports, so tapping the keypad decreased reps instead).
  const kbOpen = runner.getByRole('button', { name: /Open load keypad/ }).first();
  await kbOpen.scrollIntoViewIfNeeded().catch(() => {});
  const hit = await kbOpen.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return at?.getAttribute?.('aria-label') || at?.tagName || 'none';
  });
  expect(hit).toMatch(/Open load keypad/);
  // Load keypad Done (close) must also clear 44px. The rest countdown ticks
  // every second beside it, so the open tap retries past layout shifts.
  const keypadOpen = runner.getByRole('button', { name: /Open load keypad/ }).first();
  await keypadOpen.scrollIntoViewIfNeeded().catch(() => {});
  await expect(async () => {
    try{ await keypadOpen.click({ timeout: 2_500 }); }
    catch{ await keypadOpen.click({ force: true, timeout: 2_500 }); }
  }).toPass({ timeout: 15_000 });
  const keypadDone = runner.getByRole('group', { name: /Load keypad/ }).getByRole('button', { name: 'Done', exact: true });
  await expectHit44(page, keypadDone, 'keypad Done');
});

test('touch targets — gym and guided high-frequency controls', async ({ page }) => {
  await completeOnboarding(page);
  await enableTelemetry(page);
  const runner = await startStandardWorkout(page);
  // Gym parity: the same row controls render in focus mode — same bar.
  await runner.locator('button[title*="Gym mode"]').click();
  await expectHit44(page, runner.getByRole('button', { name: 'Done' }).first(), 'gym Done');
  await expectHit44(page, runner.getByRole('button', { name: 'Swap', exact: true }).first(), 'gym Swap');
});

test('baseline probe — guided mode two-step flow', async ({ page }) => {
  await completeOnboarding(page);
  await enableTelemetry(page);
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
  const optionsBtn = page.getByRole('button', { name: 'Options' });
  if(await optionsBtn.isVisible().catch(() => false)) await optionsBtn.click();
  await page.getByRole('button', { name: 'Guided mode' }).click();
  const runner = page.getByRole('dialog', { name: /Guided session/ });
  await expect(runner).toBeVisible({ timeout: 8000 });
  // Guided header + step controls clear the same 44px bar.
  await expectHit44(page, runner.getByRole('button', { name: /Sound cues/ }), 'guided sound cues');
  const voiceBtn = runner.getByRole('button', { name: /Voice coach/ });
  if(await voiceBtn.isVisible().catch(() => false)) await expectHit44(page, voiceBtn, 'guided voice coach');
  await expectHit44(page, runner.getByRole('button', { name: 'Done — next' }), 'guided Done-next');
  await startFocusCounters(page);

  page.on('dialog', (d) => d.accept());
  for(let step = 0; step < 2; step++){
    const load = runner.getByLabel('Load in kilograms');
    const reps = runner.getByLabel('Reps', { exact: true });
    if(await load.isVisible().catch(() => false) && !(await load.inputValue())) await load.fill('20');
    if(await reps.isVisible().catch(() => false) && !(await reps.inputValue())) await reps.fill('8');
    await runner.getByRole('button', { name: 'Done — next' }).click();
    const skip = runner.getByRole('button', { name: 'Skip rest' });
    if(await skip.isVisible().catch(() => false)){
      if(step === 0) await expectHit44(page, skip, 'guided Skip rest');
      await skip.click();
    }
  }
  const saveBtn = runner.getByRole('button', { name: 'Save session' });
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await expect(runner).toBeHidden({ timeout: 8000 });

  const probe = await readProbe(page);
  console.log(`BASELINE guided: ${JSON.stringify(probe)}`);
  expect(probe.counts['complete-set']).toBeGreaterThanOrEqual(2);
  // Same-exercise carry-forward: step 2's load arrives prefilled, so only
  // step 1's entry commits (was 2) and only one input focus fires (was 2).
  expect(probe.counts['load-field-commit']).toBe(1);
  expect(probe.focus.inputFocus).toBe(1);
  expect(probe.valueLeak).toBeNull();
  console.log(formatReport(checkLive(DOC, 'guided-two-step', liveCounts(probe))));
});
