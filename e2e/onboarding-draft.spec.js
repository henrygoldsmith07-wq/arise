import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('Onboarding draft survives an accidental close', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
  });

  test('Esc then reopen restores answers and step; Start over resets', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Onboarding' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /Get stronger/i }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Gym' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Set up' }).first().click();
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('onboarding-restored')).toBeVisible();
    await expect(page.getByText('Step 2 of')).toBeVisible();

    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.getByText('Step 1 of')).toBeVisible();
    await expect(page.getByTestId('onboarding-restored')).toBeHidden();
  });
});
