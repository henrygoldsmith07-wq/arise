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

// Deterministic fixture for treatment-REPLACEMENT proofs. The first assigned
// exercise gets two clean, on-target, low-effort prior exposures (8 × 22.5 kg
// at RPE 7 against an 8–12 target), so any honest progression treatment must
// move the target: repeating 8 × 22.5 exactly is not a recommendation a
// progression engine gives after an easy, met, target-range exposure. If the
// engine ever did return the identical pair, the fixture precondition below
// fails LOUDLY — that is a real signal, not something to paper over.
// The expected treatment is computed with the app's own pure functions and
// the exact same inputs GuidedRunner's guidedMeta uses at first reveal, so
// "displayed == treatment" is a genuine prediction made before the UI opens.
async function seedDeterministicStudyTarget(page, info){
  return page.evaluate(async (info) => {
    const { loadStore, saveStore } = await import('/src/lib/store.js');
    const { whenPersisted } = await import('/src/lib/storage.js');
    const s = loadStore();
    const sess = (s.activeSchedule?.sessions || []).find(x => (x.blocks || []).length >= 2);
    if(!sess || !info) return null;
    const ex0 = sess.blocks[0].exerciseId;
    const dateN = (daysBefore)=> new Date(Date.parse(`${sess.dateISO}T00:00:00Z`) - daysBefore * 86400000).toISOString().slice(0, 10);
    const exposure = (d, id)=> ({ id, dateISO: d, savedAt: `${d}T18:00:00.000Z`, blocks: [{
      exerciseId: ex0,
      sets: [{ reps: '8', weightKg: '22.5', rpe: '7', side: '', rom: '', assistedKg: '', completed: true }],
    }] });
    s.history = [exposure(dateN(7), 'fx-easy-1'), exposure(dateN(4), 'fx-easy-2')];
    sess.blocks[0].reps = '8–12';
    saveStore(s);
    await whenPersisted();
    const t = s.preferences || {};
    const policy = (await import('/src/lib/progressionPolicies.js')).POLICY_ORDER.includes(t.progressionPolicy) ? t.progressionPolicy : 'standard';
    const { initGuidedBlocks } = await import('/src/lib/guidedMode.js');
    const { treatmentRecommendation } = await import('/src/lib/treatment.js');
    const { runComparativeStudy } = await import('/src/lib/study.js');
    const guided = initGuidedBlocks({ ...sess, mode: 'guided' }, s.history, null);
    const scheduled = {
      reps: String(guided[0]?.sets?.[0]?.reps ?? ''),
      weightKg: String(guided[0]?.sets?.[0]?.weightKg ?? ''),
    };
    const rec = treatmentRecommendation({
      block: guided[0], history: s.history, asOfDateISO: sess.dateISO,
      plateConfig: s.onboarding?.plateConfig || null, study: runComparativeStudy(s.history),
      assignedArm: info.arm, policy,
    });
    if(!rec) return { scheduled, treatment: null };
    const norm = (v)=> v == null || v === '' || !(Number(v) > 0) ? null : String(Number(v));
    return { scheduled, treatment: { reps: rec.reps != null ? String(rec.reps) : null, load: norm(rec.load), assistKg: norm(rec.assistKg) } };
  }, info);
}

const pairOf = (o)=> `${o.reps ?? ''}|${o.load ?? o.weightKg ?? ''}`;

test('guided enforces DP assignment, records once, excludes unassigned, survives reload', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await completeOnboarding(page);
  await scheduleProgram(page);
  const info = await enrollGuidedStudy(page, { consent: true });
  test.skip(!info, 'no multi-exercise scheduled session');
  const fx = await seedDeterministicStudyTarget(page, info);
  expect(fx?.treatment, 'engine produced a DP treatment for the seeded fixture').toBeTruthy();
  expect(pairOf(fx.treatment), 'fixture must guarantee scheduled != DP treatment before Guided starts').not.toBe(pairOf(fx.scheduled));
  await page.reload();
  const runner = await startGuided(page);

  // Treatment visible, and it REPLACED the scheduled values (prediction made
  // before the UI opened — fails if Guided ever stops applying the arm).
  await expect(runner.getByText(/Study policy — double progression/)).toBeVisible({ timeout: 8000 });
  const shownReps = await runner.getByLabel('Reps', { exact: true }).inputValue();
  const shownLoad = (await runner.getByLabel('Load in kilograms').inputValue().catch(() => '')) || '';
  expect(shownReps, 'displayed reps equal the predicted DP treatment').toBe(fx.treatment.reps);
  if(fx.treatment.load != null) expect(shownLoad).toBe(fx.treatment.load);
  expect(`${shownReps}|${shownLoad}`, 'the scheduled target was REPLACED').not.toBe(pairOf(fx.scheduled));
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

test('guided REPLACES the scheduled target with the assigned Arise treatment: predicted = displayed = recorded = performed = resolved', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await completeOnboarding(page);
  await scheduleProgram(page);
  const info = await enrollGuidedStudy(page, { consent: true, arm: 'arise' });
  test.skip(!info, 'no multi-exercise scheduled session');
  const fx = await seedDeterministicStudyTarget(page, info);
  expect(fx?.treatment, 'engine produced a treatment for the seeded fixture').toBeTruthy();
  // Fixture precondition: the assigned treatment is NOT the scheduled target.
  expect(pairOf(fx.treatment), 'fixture must guarantee scheduled != treatment before Guided starts').not.toBe(pairOf(fx.scheduled));

  await page.reload();
  const runner = await startGuided(page);
  await expect(runner.getByText(/Study policy — Arise/)).toBeVisible({ timeout: 8000 });

  // Displayed Guided values: predicted treatment, provably NOT the scheduled
  // target — this fails if Guided ever stops applying the assigned arm.
  const shownReps = await runner.getByLabel('Reps', { exact: true }).inputValue();
  const shownLoad = (await runner.getByLabel('Load in kilograms').inputValue().catch(() => '')) || '';
  expect(shownReps, 'displayed reps equals the predicted Arise treatment').toBe(fx.treatment.reps);
  if(fx.treatment.load != null) expect(shownLoad, 'displayed load equals the predicted Arise treatment').toBe(fx.treatment.load);
  expect(`${shownReps}|${shownLoad}`, 'the scheduled target was REPLACED, not displayed').not.toBe(pairOf(fx.scheduled));

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

  // Full causal chain from one fixture:
  //   assigned arm → generated recommendation → displayed values →
  //   performed saved set → prospective ledger prescription → resolved outcome
  // (plus the frozen first-visible snapshot on the saved block).
  const chain = await page.evaluate(async (info) => {
    const { loadStore } = await import('/src/lib/store.js');
    const { loadEvaluationLedger } = await import('/src/lib/longitudinal.js');
    const last = loadStore().history[loadStore().history.length - 1];
    const performedBlock = last.blocks.find(b=> b.exerciseId === info.firstExercise) || { sets: [] };
    const performed = performedBlock.sets?.[0] || null;
    const ledgerRow = loadEvaluationLedger().find(r=> r.exerciseId === info.firstExercise) || null;
    return { performed, performedPrescription: performedBlock.prescription || null, ledgerRow };
  }, info);
  expect(chain.ledgerRow, 'arise arm recorded').toBeTruthy();
  expect(chain.ledgerRow.assignedArm).toBe('arise');
  expect(chain.ledgerRow.participantId).toBe(info.participantId, 'prospective evidence carries the pseudonymous participant');

  const rec = chain.ledgerRow.recommendation;
  // prospective ledger prescription == predicted treatment == displayed
  expect(String(rec.reps)).toBe(fx.treatment.reps);
  expect(shownReps, 'ledger prescription matches displayed').toBe(fx.treatment.reps);
  if(fx.treatment.load != null){
    expect(String(Number(rec.load))).toBe(fx.treatment.load);
    expect(shownLoad).toBe(fx.treatment.load);
  }
  if(fx.treatment.assistKg != null){
    expect(String(Number(rec.assistKg))).toBe(fx.treatment.assistKg);
  }
  // performed saved set == predicted/displayed values
  expect(chain.performed, 'first set was performed').toBeTruthy();
  expect(String(chain.performed.reps)).toBe(fx.treatment.reps);
  if(fx.treatment.load != null) expect(String(Number(chain.performed.weightKg))).toBe(fx.treatment.load);
  if(fx.treatment.assistKg != null) expect(String(Number(chain.performed.assistedKg))).toBe(fx.treatment.assistKg);
  // frozen prescription snapshot on the performed block == same treatment
  expect(String(chain.performedPrescription?.prescribedReps)).toBe(fx.treatment.reps);
  if(fx.treatment.load != null) expect(String(Number(chain.performedPrescription?.prescribedLoadKg))).toBe(fx.treatment.load);
  // resolved outcome evaluated against the applied target
  const outcome = chain.ledgerRow.outcome;
  expect(outcome, 'outcome resolved through the shared pipeline').toBeTruthy();
  expect(Number(outcome.reps), 'performed reps landed on the treated target').toBe(Number(fx.treatment.reps));
  if(fx.treatment.load != null) expect(Number(outcome.load)).toBe(Number(fx.treatment.load));
  expect(outcome.followed, 'performed work matches the shown treatment').toBe(true);
  expect(outcome.assignedMet, 'outcome resolves met against the applied target').toBe(true);
});
