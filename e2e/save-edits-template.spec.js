import { test, expect } from '@playwright/test';
import { dismissConsent } from './helpers.js';

// Save My Programme edits as a template (backlog 34): edit a day → "Save as
// my template" → start a new block from that template → the edits are the
// new block's programme (no edit layer needed).

async function completeOnboarding(page){
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => new Promise(resolve => {
    try{
      const req = indexedDB.deleteDatabase('arise-idb-v1');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    }catch{ resolve(); }
  }));
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /Feel better/i }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /Gym/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel(/Bodyweight/i).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Beginner', exact: true }).click();
  await page.getByRole('button', { name: /3\u00d7/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /Save & continue/i }).click();
  await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeHidden();
  await dismissConsent(page);
}

// Make sure a programme is running (first-value onboarding normally starts one).
async function ensureProgramme(page){
  await page.getByRole('button', { name: 'Train', exact: true }).click();
  const current = page.locator('[aria-label="Current programme"]');
  const recCard = page.locator('[aria-label="Recommended for you"]');
  await expect(current.or(recCard)).toBeVisible({ timeout: 8_000 });
  if(!(await current.isVisible().catch(() => false))){
    await recCard.getByRole('button', { name: 'Start programme' }).click();
  }
  await expect(current).toBeVisible({ timeout: 8_000 });
  return current;
}

// The day the next session belongs to, so edits land on what Today shows.
async function nextSessionTitle(page){
  return page.evaluate(async () => {
    const { loadStore } = await import('/src/lib/store.js');
    const { sessionForToday, nextSession } = await import('/src/lib/schedule.js');
    const s = loadStore().activeSchedule;
    return (sessionForToday(s) || nextSession(s))?.title || null;
  });
}

async function persisted(page){
  await page.evaluate(async () => {
    const { whenPersisted } = await import('/src/lib/storage.js');
    await whenPersisted();
  });
}

async function openEditor(page, dayTitle){
  await page.getByRole('button', { name: /^Edit programme/ }).click();
  const editor = page.getByRole('dialog', { name: 'My programme' });
  await expect(editor).toBeVisible({ timeout: 8_000 });
  const tab = editor.getByRole('tab', { name: new RegExp(`^${dayTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
  await tab.click();
  return editor;
}

test('edit → save as my template → new block from it keeps the edits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await completeOnboarding(page);
  await ensureProgramme(page);
  const dayTitle = await nextSessionTitle(page);
  expect(dayTitle).toBeTruthy();

  const editor = await openEditor(page, dayTitle);
  const first = editor.getByRole('tabpanel').getByTestId('programme-exercise').first();
  const name = (await first.locator('p.font-bold').innerText()).trim();
  const before = Number(((await first.locator('p.tabular-nums').innerText()).match(/^(\d+)/) || [])[1]);
  await first.getByRole('button', { name: `Increase sets for ${name}` }).click();
  const sets = before + 1;
  await expect(first.locator('p.tabular-nums')).toContainText(`${sets} ×`);

  await editor.getByRole('button', { name: 'Save as my template' }).click();
  const prompt = page.getByRole('dialog', { name: 'Save as my template' });
  await expect(prompt).toBeVisible();
  await prompt.getByLabel('Template name').fill('E2E edits');
  await prompt.getByRole('button', { name: 'Save' }).click();
  await expect(editor.getByTestId('programme-editor-status')).toContainText('Saved “E2E edits”');
  await expect(editor.getByRole('button', { name: 'Copy share code' })).toBeVisible();
  await editor.getByRole('button', { name: 'Close programme editor' }).click();
  await expect(editor).toBeHidden();

  // Start a new block from the saved template, choosing NOT to keep a second copy.
  await page.getByRole('button', { name: 'Browse programmes' }).click();
  await page.getByRole('button', { name: /E2E edits/ }).first().click();
  await page.getByRole('button', { name: 'Schedule this program' }).click();
  const keep = page.getByRole('dialog', { name: 'Keep your programme edits?' });
  await expect(keep).toBeVisible();
  await keep.getByRole('button', { name: 'Not now' }).click();
  await page.getByRole('alertdialog', { name: 'Replace your customised programme?' }).getByRole('button', { name: 'Replace programme' }).click();
  await expect(page.getByTestId('programme-customised-badge')).toHaveCount(0);

  await persisted(page);
  const state = await page.evaluate(async ({ dayTitle, name }) => {
    const { loadStore } = await import('/src/lib/store.js');
    const { EXERCISE_BY_ID } = await import('/src/lib/data.js');
    const store = loadStore();
    const s = store.activeSchedule;
    const tpl = (store.customTemplates || []).find(t => t.name === 'E2E edits');
    const session = s.sessions.find(x => x.title === dayTitle);
    const block = session?.blocks.find(b => EXERCISE_BY_ID[b.exerciseId]?.name === name);
    return { fromTemplate: s.programId === tpl?.id, edits: Boolean(s.programmeEdits), sets: block?.sets ?? null, weeks: new Set(s.sessions.map(x => x.week)).size };
  }, { dayTitle, name });
  expect(state.fromTemplate).toBe(true);
  expect(state.edits).toBe(false);
  expect(state.sets).toBe(sets);
  expect(state.weeks).toBeGreaterThanOrEqual(1);
});
