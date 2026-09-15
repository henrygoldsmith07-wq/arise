import { test, expect } from '@playwright/test';

// Guided mode must enforce the SAME frozen randomised assignment as
// Standard/Gym: DP-assigned exercises show and execute the DP treatment,
// never-randomised exercises are excluded (assignedArm null — never a silent
// 'arise'), evidence records once across reload/resume, and nothing lands
// without measurement consent.

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

async function scheduleProgram(page){
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
}

// Enroll with exactly ONE assignment: the first scheduled exercise is forced
// to the given arm. Every other exercise stays never-randomised, which must
// yield assignedArm null in the ledger.
async function enrollGuidedStudy(page, { consent = true, arm = 'double-progression' } = {}){
  return page.evaluate(async ({ consent, arm }) => {
    const { loadStore, saveStore } = await import('/src/lib/store.js');
    const { enrollParticipant } = await import('/src/lib/studyEnrollment.js');
    const s = loadStore();
    const sess = (s.activeSchedule?.sessions || []).find(x => (x.blocks || []).length >= 2);
    if(!sess) return null;
    const participantId = 'ab'.repeat(8);
    const exIds = sess.blocks.map(b=> b.exerciseId);
    const base = enrollParticipant({ participantId, exerciseIds: exIds });
    const enrollment = { ...base, assignments: { [exIds[0]]: { arm, assignmentVersion: base.studyVersion || 'v1', assignedAtISO: new Date().toISOString() } } };
    s.preferences = { ...(s.preferences || {}), telemetryEnabled: consent };
    s.studyParticipantId = participantId;
    s.studyEnrollment = enrollment;
    saveStore(s);
    return { firstExercise: exIds[0], otherExercise: exIds.find(e=> e !== exIds[0]), participantId, arm };
  }, { consent, arm });
}

async function startGuided(page){
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  const optionsBtn = page.getByRole('button', { name: 'Options' });
  if(await optionsBtn.isVisible().catch(() => false)) await optionsBtn.click();
  await page.getByRole('button', { name: 'Guided mode' }).click();
  const runner = page.getByRole('dialog', { name: /Guided session/ });
  await expect(runner).toBeVisible({ timeout: 8000 });
  return runner;
}

test('guided enforces DP assignment, records once, excludes unassigned, survives reload', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await completeOnboarding(page);
  await scheduleProgram(page);
  const info = await enrollGuidedStudy(page, { consent: true });
  test.skip(!info, 'no multi-exercise scheduled session');
  await page.reload();
  const runner = await startGuided(page);

  // Treatment visible and executed on the assigned exercise.
  await expect(runner.getByText(/Study policy — double progression/)).toBeVisible({ timeout: 8000 });
  // Complete exactly ONE set, then crash-reload mid-exercise.
  await runner.getByRole('button', { name: 'Done — next' }).click();
  await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const { whenPersisted } = await import('/src/lib/storage.js');
    await whenPersisted();
  });
  await page.reload();
  await page.getByRole('button', { name: 'Resume' }).click();
  const runner2 = page.getByRole('dialog', { name: /Guided session/ });
  await expect(runner2).toBeVisible({ timeout: 8000 });
  await runner2.getByRole('button', { name: 'Done — next' }).click();
  // Burn through the remaining steps.
  for(let i = 0; i < 60; i++){
    const dn = runner2.getByRole('button', { name: 'Done — next' });
    if(await dn.isVisible().catch(() => false)) await dn.click();
    const skip = runner2.getByRole('button', { name: 'Skip rest' });
    if(await skip.isVisible().catch(() => false)) await skip.click();
    const sv = runner2.getByRole('button', { name: 'Save session' });
    if(await sv.isEnabled().catch(() => false)){ await sv.click(); break; }
  }
  await expect(runner2).toBeHidden({ timeout: 10000 });
  await page.evaluate(async () => { const { whenPersisted } = await import('/src/lib/storage.js'); await whenPersisted(); });

  const ledger = await page.evaluate(async (info) => {
    const { loadEvaluationLedger } = await import('/src/lib/longitudinal.js');
    return loadEvaluationLedger().map((r)=> ({ ex: r.exerciseId, arm: r.assignedArm, part: r.participantId, reps: r.recommendation?.reps ?? null, resolved: !!r.outcome }));
  }, info);

  const first = ledger.filter((r)=> r.ex === info.firstExercise);
  const other = ledger.filter((r)=> r.ex === info.otherExercise);
  expect(first.length).toBe(1, 'shown once across remount');
  expect(first[0].arm).toBe('double-progression');
  expect(first[0].part).toBe(info.participantId);
  expect(first[0].resolved).toBe(true, 'outcome resolved through the shared pipeline');
  expect(other.length).toBeGreaterThanOrEqual(1);
  for(const r of other){
    expect(r.arm, 'never-randomised exercise must NOT default to arise').not.toBe('arise');
    expect([null, 'double-progression']).toContain(r.arm);
  }
});

test('guided without measurement consent: treatment still enforced, zero evidence', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await completeOnboarding(page);
  await scheduleProgram(page);
  const info = await enrollGuidedStudy(page, { consent: false });
  test.skip(!info, 'no multi-exercise scheduled session');
  await page.reload();
  const runner = await startGuided(page);
  await expect(runner.getByText(/Study policy — double progression/)).toBeVisible({ timeout: 8000 });
  await runner.getByRole('button', { name: 'Done — next' }).click();
  const rows = await page.evaluate(() => import('/src/lib/longitudinal.js').then(m=> m.loadEvaluationLedger().length));
  expect(rows).toBe(0);
});

test('guided applies the ARISE assignment too: displayed = recorded = performed', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await completeOnboarding(page);
  await scheduleProgram(page);
  const info = await enrollGuidedStudy(page, { consent: true, arm: 'arise' });
  test.skip(!info, 'no multi-exercise scheduled session');
  await page.reload();
  const runner = await startGuided(page);
  await expect(runner.getByText(/Study policy — Arise/)).toBeVisible({ timeout: 8000 });

  // What the participant SEES on the active step (treated prefill):
  const shownReps = await runner.getByLabel('Reps', { exact: true }).inputValue();
  const shownLoad = await runner.getByLabel('Load in kilograms').inputValue().catch(() => '');

  await runner.getByRole('button', { name: 'Done — next' }).click();
  for(let i = 0; i < 60; i++){
    const dn = runner.getByRole('button', { name: 'Done — next' });
    if(await dn.isVisible().catch(() => false)) await dn.click();
    const skip = runner.getByRole('button', { name: 'Skip rest' });
    if(await skip.isVisible().catch(() => false)) await skip.click();
    const sv = runner.getByRole('button', { name: 'Save session' });
    if(await sv.isEnabled().catch(() => false)){ await sv.click(); break; }
  }
  await expect(runner).toBeHidden({ timeout: 10000 });
  await page.evaluate(async () => { const { whenPersisted } = await import('/src/lib/storage.js'); await whenPersisted(); });

  const compare = await page.evaluate(async (info) => {
    const { loadStore } = await import('/src/lib/store.js');
    const { loadEvaluationLedger } = await import('/src/lib/longitudinal.js');
    const last = loadStore().history[loadStore().history.length - 1];
    const performed = last.blocks.find(b=> b.exerciseId === info.firstExercise)?.sets?.[0] || null;
    const ledgerRow = loadEvaluationLedger().find(r=> r.exerciseId === info.firstExercise) || null;
    return { performed, ledgerRow };
  }, info);
  expect(compare.ledgerRow, 'arise arm recorded').toBeTruthy();
  expect(compare.ledgerRow.assignedArm).toBe('arise');
  const rec = compare.ledgerRow.recommendation;
  expect(String(rec.reps)).toBe(shownReps, 'recorded prescription matches the displayed target');
  expect(String(compare.performed.reps)).toBe(shownReps, 'performed work matches the displayed target');
  if(rec.load != null && Number(rec.load) > 0){
    expect(String(rec.load)).toBe(shownLoad);
    expect(String(compare.performed.weightKg)).toBe(shownLoad);
  }
  expect(compare.ledgerRow.outcome?.assignedMet, 'outcome resolved against the applied target').toBe(true);
});
