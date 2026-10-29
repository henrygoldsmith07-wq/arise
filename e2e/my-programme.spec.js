import { test, expect } from '@playwright/test';
import { dismissConsent } from './helpers.js';

// My Programme editor e2e: onboard → Train → Edit programme → swap an
// exercise, change sets, reorder → reload → edits persist → Today and Gym
// Mode run the swapped exercise with the new set count → Reset all restores.

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

test.describe('My Programme editor', () => {
  test('swap, sets and reorder persist across reload and reach Today and Gym Mode', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await completeOnboarding(page);
    await ensureProgramme(page);
    const dayTitle = await nextSessionTitle(page);
    expect(dayTitle).toBeTruthy();

    let editor = await openEditor(page, dayTitle);
    const panel = editor.getByRole('tabpanel');
    const firstName = (await panel.getByTestId('programme-exercise').first().locator('p.font-bold').innerText()).trim();

    // Swap the first exercise for the top-ranked alternative.
    await panel.getByRole('button', { name: `Swap ${firstName}`, exact: true }).click();
    const swapSheet = editor.getByRole('region', { name: 'Swap exercise' });
    await expect(swapSheet).toBeVisible();
    const option = swapSheet.getByRole('button', { name: /^Swap to / }).first();
    const newName = ((await option.getAttribute('aria-label')) || '').replace(/^Swap to /, '');
    expect(newName).not.toBe('');
    await option.click();
    await expect(editor.getByTestId('programme-editor-status')).toContainText('Swap');

    // Change its sets: read the current count, add one.
    const swapped = editor.getByRole('tabpanel').getByTestId('programme-exercise').first();
    await expect(swapped).toContainText(newName);
    await expect(swapped).toContainText('Edited');
    const before = Number(((await swapped.locator('p.tabular-nums').innerText()).match(/^(\d+)/) || [])[1]);
    await swapped.getByRole('button', { name: `Increase sets for ${newName}` }).click();
    const sets = before + 1;
    await expect(swapped.locator('p.tabular-nums')).toContainText(`${sets} ×`);

    // Reorder: move it down one slot.
    await editor.getByRole('button', { name: `Move ${newName} down` }).click();
    await expect(editor.getByRole('tabpanel').getByTestId('programme-exercise').nth(1)).toContainText(newName);

    // Undo is offered for the last change.
    await expect(editor.getByRole('button', { name: /^Undo Move/ })).toBeVisible();
    await editor.getByRole('button', { name: 'Close programme editor' }).click();
    await expect(editor).toBeHidden();
    await expect(page.getByTestId('programme-customised-badge')).toBeVisible();

    // Reload: everything is still there.
    await persisted(page);
    await page.reload();
    await page.getByRole('button', { name: 'Train', exact: true }).click();
    await expect(page.getByTestId('programme-customised-badge')).toBeVisible({ timeout: 8_000 });
    editor = await openEditor(page, dayTitle);
    const second = editor.getByRole('tabpanel').getByTestId('programme-exercise').nth(1);
    await expect(second).toContainText(newName);
    await expect(second.locator('p.tabular-nums')).toContainText(`${sets} ×`);
    await editor.getByRole('button', { name: 'Close programme editor' }).click();

    // Today shows the swapped exercise with the new set count.
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    const row = page.getByTestId('today-block').filter({ hasText: newName });
    await expect(row).toBeVisible({ timeout: 8_000 });
    await expect(row).toContainText(`${sets}×`);
    await expect(row).toContainText('your swap');

    // Gym Mode runs it with that many set rows.
    const startBtn = page.getByRole('button', { name: /Start workout|Start this session/ }).first();
    await startBtn.click();
    const runner = page.getByRole('dialog', { name: /Session —/ });
    await expect(runner).toBeVisible({ timeout: 8_000 });
    await expect(runner.getByText(newName).first()).toBeVisible();
    await expect.poll(async () => page.evaluate(async (name) => {
      const { loadStore } = await import('/src/lib/store.js');
      const { EXERCISE_BY_ID } = await import('/src/lib/data.js');
      const block = (loadStore().activeWorkout?.blocks || []).find(b => EXERCISE_BY_ID[b.exerciseId]?.name === name);
      return block ? block.sets.length : null;
    }, newName), { timeout: 8_000 }).toBe(sets);
  });

  test('Reset all restores the programme, survives reload, and undo brings edits back', async ({ page }) => {
    await completeOnboarding(page);
    await ensureProgramme(page);
    const dayTitle = await nextSessionTitle(page);
    const original = await page.evaluate(async () => {
      const { loadStore } = await import('/src/lib/store.js');
      return JSON.stringify(loadStore().activeSchedule.sessions.map(s => s.blocks.map(b => [b.exerciseId, b.sets, b.reps])));
    });

    const editor = await openEditor(page, dayTitle);
    const first = editor.getByRole('tabpanel').getByTestId('programme-exercise').first();
    const name = (await first.locator('p.font-bold').innerText()).trim();
    await first.getByRole('button', { name: `Increase sets for ${name}` }).click();
    await expect(first).toContainText('Edited');

    await editor.getByRole('button', { name: 'Reset all to template' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Reset all edits?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Reset all' }).click();
    await expect(editor.getByRole('tabpanel').getByTestId('programme-exercise').first()).not.toContainText('Edited');
    await expect(editor.getByRole('button', { name: 'Reset all to template' })).toHaveCount(0);
    await expect(editor.getByRole('button', { name: /^Undo Reset all/ })).toBeVisible();

    const afterReset = await page.evaluate(async () => {
      const { loadStore } = await import('/src/lib/store.js');
      return JSON.stringify(loadStore().activeSchedule.sessions.map(s => s.blocks.map(b => [b.exerciseId, b.sets, b.reps])));
    });
    expect(afterReset).toBe(original);

    // Undo brings the edit back, a second reset clears it again.
    await editor.getByRole('button', { name: /^Undo Reset all/ }).click();
    await expect(editor.getByRole('tabpanel').getByTestId('programme-exercise').first()).toContainText('Edited');
    await editor.getByRole('button', { name: 'Reset all to template' }).click();
    await page.getByRole('alertdialog', { name: 'Reset all edits?' }).getByRole('button', { name: 'Reset all' }).click();
    await editor.getByRole('button', { name: 'Close programme editor' }).click();
    await expect(page.getByTestId('programme-customised-badge')).toHaveCount(0);

    await persisted(page);
    await page.reload();
    await page.getByRole('button', { name: 'Train', exact: true }).click();
    await expect(page.locator('[aria-label="Current programme"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('programme-customised-badge')).toHaveCount(0);
  });

  test('switching programme with edits asks first', async ({ page }) => {
    await completeOnboarding(page);
    await ensureProgramme(page);
    const dayTitle = await nextSessionTitle(page);
    const editor = await openEditor(page, dayTitle);
    const first = editor.getByRole('tabpanel').getByTestId('programme-exercise').first();
    const name = (await first.locator('p.font-bold').innerText()).trim();
    await first.getByRole('button', { name: `Increase sets for ${name}` }).click();
    await editor.getByRole('button', { name: 'Close programme editor' }).click();

    await page.getByRole('button', { name: 'Clear schedule' }).click();
    // First the offer to keep the edits as a template, then the warning.
    const keep = page.getByRole('dialog', { name: 'Keep your programme edits?' });
    await expect(keep).toBeVisible();
    await keep.getByRole('button', { name: 'Not now' }).click();
    const warn = page.getByRole('alertdialog', { name: 'Replace your customised programme?' });
    await expect(warn).toBeVisible();
    await warn.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('programme-customised-badge')).toBeVisible();
  });
});
