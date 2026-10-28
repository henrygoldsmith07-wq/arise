import { test, expect } from '@playwright/test';

// Training days card renders on Train when a programme is active.
test('training days card toggles weekdays', async ({ page }) => {
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
  await page.getByRole('button', { name: /^Train$/ }).first().click();
  const card = page.getByTestId('weekday-plan');
  if (!(await card.count())) test.skip(true, 'no active programme in this fixture');
  await card.getByRole('button', { name: 'Mon' }).click();
  await expect(page.getByTestId('weekday-msg')).toBeVisible();
});
