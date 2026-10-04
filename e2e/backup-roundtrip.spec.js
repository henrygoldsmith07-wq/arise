import { test, expect } from '@playwright/test';

// The data-loss guarantee, proven end to end in a real browser against real
// IndexedDB: log sessions, export, destroy everything, restore, and assert the
// user-visible state is identical — not merely "import did not throw".
//
// `attributes` and PRs are derived from history, so they are the real risk
// surface: a restore that loses a decimal or reorders a set can silently change
// a user's Strength/Consistency attributes. Nothing here is mocked.

const BACKUP_INPUT = 'input[type=file][accept=".arise,.json,application/json"]';

async function completeOnboarding(page){
  await page.goto('/');
  await expect(page.getByRole('dialog', { name:'Onboarding' })).toBeVisible({ timeout:15_000 });
  await page.getByRole('button', { name:/Get stronger/i }).click();
  await page.getByRole('button', { name:'Next', exact:true }).click();
  await page.getByRole('button', { name:'Gym' }).click();
  await page.getByRole('button', { name:'Next', exact:true }).click();
  await page.getByLabel(/Dumbbells/i).click();
  await page.getByLabel(/Bench/i).click();
  await page.getByRole('button', { name:'Next', exact:true }).click();
  await page.getByRole('button', { name:'Intermediate' }).click();
  await page.getByRole('button', { name:'3×' }).click();
  await page.getByRole('button', { name:'45 min' }).click();
  await page.getByRole('button', { name:'Next', exact:true }).click();
  await page.getByRole('button', { name:/Save & continue/i }).click();
  await expect(page.getByRole('dialog', { name:'Onboarding' })).toBeHidden();
  // A fresh profile always has the local-measurement consent card up. Dismiss
  // it explicitly (it otherwise intercepts clicks on the tab bar).
  const consent = page.getByRole('dialog', { name:'Local measurement consent' });
  if(await consent.isVisible().catch(()=> false)){
    await consent.getByRole('button', { name:'No thanks' }).click();
    await expect(consent).toBeHidden();
  }
}

async function logSessions(page){
  await page.evaluate(async ()=>{
    const storeModule = await import('/src/lib/store.js');
    const storageModule = await import('/src/lib/storage.js');
    const store = storeModule.loadStore();
    storeModule.saveStore({
      ...store,
      preferences:{ ...(store.preferences || {}), telemetryEnabled:false },
      history:[
        {
          id:'round-trip-a',
          dateISO:'2026-09-01',
          savedAt:'2026-09-01T09:00:00.000Z',
          title:'Push A',
          blocks:[{ exerciseId:'bench-press-dumbbell', sets:[
            { reps:'8', weightKg:'20', rpe:'7', completed:true },
            { reps:'9', weightKg:'20', rpe:'8', completed:true },
          ] }],
        },
        {
          id:'round-trip-b',
          dateISO:'2026-09-08',
          savedAt:'2026-09-08T09:00:00.000Z',
          title:'Pull A',
          blocks:[{ exerciseId:'dumbbell-row', sets:[
            { reps:'10', weightKg:'24', rpe:'8', completed:true },
            { reps:'12', weightKg:'24', rpe:'9', completed:true },
          ] }],
        },
        {
          id:'round-trip-c',
          dateISO:'2026-09-15',
          savedAt:'2026-09-15T09:00:00.000Z',
          title:'Legs A',
          blocks:[{ exerciseId:'goblet-squat', sets:[
            { reps:'10', weightKg:'32', rpe:'8', completed:true },
          ] }],
        },
      ],
    });
    await storageModule.whenPersisted();
  });
  // Assert the write committed BEFORE reloading: otherwise a silent write
  // failure would be misreported as a backup/restore failure later.
  await page.waitForFunction(async ()=>{
    const { whenPersisted } = await import('/src/lib/storage.js');
    await whenPersisted();
    return ((await import('/src/lib/store.js')).loadStore().history || []).length === 3;
  }, undefined, { timeout:15_000 });
  await page.reload();
  // Re-assert AFTER the reload: the claim under test is that the sessions are
  // durably on this device, not merely in the in-memory cache.
  await page.waitForFunction(async ()=>{
    return ((await import('/src/lib/store.js')).loadStore().history || []).length === 3;
  }, undefined, { timeout:15_000 });
}

/** Everything a user would recognise as "my training" after a restore. */
async function readUserFacingState(page){
  return page.evaluate(async ()=>{
    const { loadStore } = await import('/src/lib/store.js');
    const { deriveAttributes, levelFromAttributes } = await import('/src/lib/attributes.js');
    const store = loadStore();
    const history = store.history || [];
    const attributes = deriveAttributes(history);
    return {
      history,
      attributes,
      // Values only: the rendered blurb is prose derived from the value, so
      // comparing the numeric layer is the honest equality claim.
      attributeValues: Object.fromEntries(attributes.map(a=> [a.id, a.value])),
      level: levelFromAttributes(attributes),
      schedule: store.activeSchedule || null,
      onboarding: store.onboarding || null,
    };
  });
}

test('export → wipe IndexedDB → restore reproduces history, attributes and level exactly', async ({ page })=>{
  await completeOnboarding(page);
  await logSessions(page);

  const before = await readUserFacingState(page);
  expect(before.history.length, 'sessions logged before the wipe').toBe(3);
  expect(before.attributeValues.strength, 'a real history derives a real strength attribute').toBeGreaterThan(12);

  // ── Export ──────────────────────────────────────────────────────────
  await page.getByRole('button', { name:'More', exact:true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name:'Export JSON', exact:true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path, 'an export file was actually produced').toBeTruthy();

  // ── Wipe: destroy IndexedDB AND localStorage, exactly like a "clear
  //    local data" or a wiped browser profile would. ────────────────────
  await page.evaluate(async ()=>{
    await new Promise((resolve)=>{
      const req = indexedDB.deleteDatabase('arise-idb-v1');
      req.onsuccess = ()=> resolve();
      req.onerror = ()=> resolve();
      req.onblocked = ()=> resolve();
    });
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();

  const wiped = await readUserFacingState(page);
  expect(wiped.history.length, 'history is really gone after the wipe').toBe(0);

  // ── Restore ─────────────────────────────────────────────────────────
  // A wiped device is a first-run device: onboarding and consent are back.
  // Complete them again so the import path is reachable — the point of the
  // test is that the BACKUP carries the training, not the onboarding profile.
  const dialog = page.getByRole('dialog', { name:'Onboarding' });
  if(await dialog.isVisible().catch(()=> false)) await completeOnboarding(page);
  await page.getByRole('button', { name:'More', exact:true }).click();
  // "Import backup" is a styled <label> wrapping the real input, so drive the
  // input directly rather than clicking the label.
  await page.locator(BACKUP_INPUT).first().setInputFiles(path);

  // Two-step import: preview first, apply only on explicit confirmation.
  await expect(page.getByRole('dialog', { name:'Import preview' })).toBeVisible({ timeout:10_000 });
  await page.getByRole('button', { name:/Apply Merge/i }).click();

  // Wait for the merged store to actually commit to IndexedDB before
  // reloading — reload is what proves durability, and racing it would be
  // testing the race, not the backup.
  await page.waitForFunction(async ()=>{
    const { whenPersisted } = await import('/src/lib/storage.js');
    await whenPersisted();
    const { loadStore } = await import('/src/lib/store.js');
    return (loadStore().history || []).length === 3;
  }, undefined, { timeout:15_000 });
  await page.reload();

  const after = await readUserFacingState(page);

  // Session identity and exact training numbers survive.
  expect(after.history.map(h=> h.id)).toEqual(before.history.map(h=> h.id));
  expect(after.history.map(h=> h.blocks.map(b=> b.exerciseId))).toEqual(
    before.history.map(h=> h.blocks.map(b=> b.exerciseId)));
  expect(after.history.flatMap(h=> h.blocks.flatMap(b=> b.sets.map(s=> [s.reps, s.weightKg])))).toEqual(
    before.history.flatMap(h=> h.blocks.flatMap(b=> b.sets.map(s=> [s.reps, s.weightKg]))));

  // The derived layer is identical, not merely plausible.
  expect(after.attributeValues).toEqual(before.attributeValues);
  expect(after.level).toEqual(before.level);
  expect(after.onboarding).toEqual(before.onboarding);
});

test('a hostile backup file is rejected without touching existing data', async ({ page })=>{
  await completeOnboarding(page);
  await logSessions(page);

  const before = await readUserFacingState(page);
  expect(before.history.length).toBe(3);

  // ── A file that explicitly belongs to another product ────────────────
  // Refused at the PREVIEW gate, not at apply time. Claiming `app` is
  // optional in this format (unbranded snapshots are supported), but a file
  // that names a different product is never ours to restore.
  const foreign = Buffer.from('{"app":"some-other-fitness-app","data":{"history":[{"id":"foreign","dateISO":"2026-01-01","blocks":[]}]}}');
  await page.getByRole('button', { name:'More', exact:true }).click();
  await page.locator(BACKUP_INPUT).first().setInputFiles({
    name:'foreign.json',
    mimeType:'application/json',
    buffer:foreign,
  });

  // No preview appears: the file is refused before any of it is shown.
  await expect(page.getByRole('dialog', { name:'Import preview' })).toHaveCount(0, { timeout:5_000 });

  const afterForeign = await readUserFacingState(page);
  expect(afterForeign.history.map(h=> h.id), 'existing history untouched by a foreign file').toEqual(before.history.map(h=> h.id));
  expect(afterForeign.attributeValues).toEqual(before.attributeValues);

  // ── Not JSON at all ──────────────────────────────────────────────────
  await page.locator(BACKUP_INPUT).first().setInputFiles({
    name:'garbage.json',
    mimeType:'application/json',
    buffer:Buffer.from('not json at all — just prose'),
  });
  await expect(page.getByRole('dialog', { name:'Import preview' })).toHaveCount(0, { timeout:5_000 });
  expect((await readUserFacingState(page)).history.map(h=> h.id)).toEqual(before.history.map(h=> h.id));

  // ── Prototype-pollution payload in an Arise-branded file ─────────────
  // This one IS previewable (it claims to be Arise and has a valid shape).
  // The guarantee under test is that merely opening the preview neither
  // pollutes the prototype chain nor mutates a single byte of real data.
  const hostile = Buffer.from('{"app":"arise","v":3,"__proto__":{"polluted":"yes"},"data":{"history":[{"id":"injected","dateISO":"2026-01-01","blocks":[]}]}}');
  await page.locator(BACKUP_INPUT).first().setInputFiles({
    name:'pollution.arise',
    mimeType:'application/json',
    buffer:hostile,
  });
  await expect(page.getByRole('dialog', { name:'Import preview' })).toBeVisible({ timeout:10_000 });

  expect(await page.evaluate(()=> ({}).polluted), 'Object.prototype not polluted').toBeUndefined();
  expect(await page.evaluate(()=> Object.prototype.polluted), 'Object.prototype not polluted').toBeUndefined();

  const afterPollution = await readUserFacingState(page);
  expect(afterPollution.history.map(h=> h.id), 'preview alone never mutates history').toEqual(before.history.map(h=> h.id));
  expect(afterPollution.attributeValues).toEqual(before.attributeValues);

  // Cancelling the preview discards it entirely.
  await page.getByRole('button', { name:'Cancel', exact:true }).click();
  await expect(page.getByRole('dialog', { name:'Import preview' })).toHaveCount(0, { timeout:5_000 });
  expect((await readUserFacingState(page)).history.map(h=> h.id)).toEqual(before.history.map(h=> h.id));
});