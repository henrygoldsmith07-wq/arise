import { test, expect } from '@playwright/test';

// Edit logged workouts: Progress → Edit logged workouts opens a sheet where a
// set can be corrected and a whole session deleted, all on device.
test('a logged set can be edited and a session deleted from Progress', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => new Promise((resolve) => {
    localStorage.clear(); sessionStorage.clear();
    const r = indexedDB.deleteDatabase('arise-idb-v1');
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  }));
  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Onboarding' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: /Explore with sample data/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await page.getByRole('button', { name: /^Progress$/ }).first().click();
  await page.getByRole('button', { name: 'Edit logged workouts' }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit workout history' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: /exercises$/ }).first().click();
  await sheet.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await sheet.getByLabel('Reps').fill('9');
  await sheet.getByRole('button', { name: 'Save set' }).click();
  await expect(sheet.getByRole('status')).toContainText('Set updated');
  await sheet.getByRole('button', { name: 'Delete whole session' }).click();
  await sheet.getByRole('button', { name: 'Yes, delete session' }).click();
  await expect(sheet.getByRole('status')).toContainText('Session deleted');
});
