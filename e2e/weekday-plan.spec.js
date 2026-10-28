import { test, expect } from '@playwright/test';
// Smoke: the Training days card renders on Train when a programme is active.
test('training days card toggles weekdays', async ({ page }) => {
  await page.goto('/');
  const train = page.getByRole('button', { name: /^train$/i }).first();
  if (await train.count()) await train.click();
  const card = page.getByTestId('weekday-plan');
  if (!(await card.count())) test.skip(true, 'no active programme in this fixture');
  await card.getByRole('button', { name: 'Mon' }).click();
  await expect(page.getByTestId('weekday-msg')).toBeVisible();
});
