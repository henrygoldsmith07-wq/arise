import { test, expect } from '@playwright/test';
import { dismissConsent } from './helpers.js';

// Supersets + per-exercise rest (backlog 35): pair two lifts and set a rest
// in My programme → Gym Mode alternates A1 → B1 with no rest in between →
// after the round ONE rest starts, using the value set in the editor.

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

const toSec = (text) => {
  const t = String(text).trim();
  const m = t.match(/^(\d+):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number(t.replace(/s$/, ''));
};

test('pair two lifts → Gym Mode alternates → rest uses the set value', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await completeOnboarding(page);
  await ensureProgramme(page);
  const dayTitle = await nextSessionTitle(page);
  expect(dayTitle).toBeTruthy();

  const editor = await openEditor(page, dayTitle);
  const rows = editor.getByRole('tabpanel').getByTestId('programme-exercise');
  expect(await rows.count()).toBeGreaterThanOrEqual(2);
  const nameA = (await rows.nth(0).locator('p.font-bold').innerText()).trim();
  const nameB = (await rows.nth(1).locator('p.font-bold').innerText()).trim();

  // Longer rest on A (two +15 s taps), then pair A with B.
  const restA = editor.getByRole('group', { name: `rest for ${nameA}` });
  const before = toSec(await restA.locator('span').innerText());
  await restA.getByRole('button', { name: `Increase rest for ${nameA}` }).click();
  await expect.poll(async () => toSec(await restA.locator('span').innerText())).toBe(before + 15);
  await restA.getByRole('button', { name: `Increase rest for ${nameA}` }).click();
  await expect.poll(async () => toSec(await restA.locator('span').innerText())).toBe(before + 30);
  const restB = toSec(await editor.getByRole('group', { name: `rest for ${nameB}` }).locator('span').innerText());
  const expected = Math.max(before + 30, restB);

  await rows.nth(0).getByRole('button', { name: `Pair ${nameA} with next` }).click();
  await expect(editor.getByTestId('programme-superset').first()).toContainText(`with ${nameB}`);
  await expect(rows.nth(1).getByRole('button', { name: `Unpair ${nameB}` })).toBeVisible();
  await editor.getByRole('button', { name: 'Close programme editor' }).click();
  await expect(editor).toBeHidden();
  await persisted(page);

  // Gym Mode on Today's session.
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: /Start workout|Start this session/ }).first().click();
  const runner = page.getByRole('dialog', { name: /Session —/ });
  await expect(runner).toBeVisible({ timeout: 8_000 });
  const gymToggle = runner.getByTitle(/^Gym mode: focus/);
  if((await gymToggle.getAttribute('aria-pressed')) !== 'true') await gymToggle.click();
  await expect(gymToggle).toHaveAttribute('aria-pressed', 'true');

  const badge = runner.getByTestId('superset-badge');
  await expect(badge).toContainText('A1');
  await expect(badge).toContainText(`Superset with ${nameB}`);
  const restEndsAt = () => page.evaluate(async () => {
    const { loadStore } = await import('/src/lib/store.js');
    return loadStore().activeWorkout?.restEndsAt || null;
  });

  // A1 → straight to B1, no rest.
  await runner.getByLabel(/^Reps set \d+$/).first().fill('8');
  await runner.getByRole('button', { name: 'Done' }).first().click();
  await expect(badge).toContainText('B1');
  await expect(badge).toContainText(`Superset with ${nameA}`);
  await persisted(page);
  expect(await restEndsAt()).toBeNull();

  // B1 → one rest for the pair, of the value set in the editor, then back to A2.
  await runner.getByLabel(/^Reps set \d+$/).first().fill('8');
  await runner.getByRole('button', { name: 'Done' }).first().click();
  await expect(badge).toContainText('A2');
  await expect.poll(async () => {
    const ends = await restEndsAt();
    return ends ? Math.round((ends - Date.now()) / 1000) : null;
  }, { timeout: 8_000 }).toBeGreaterThan(expected - 6);
  const left = Math.round(((await restEndsAt()) - Date.now()) / 1000);
  expect(left).toBeLessThanOrEqual(expected);
  await expect(runner.getByRole('button', { name: 'Skip rest' }).or(page.getByRole('button', { name: 'Skip rest' })).first()).toBeVisible();
});
