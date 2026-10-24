import { test, expect } from '@playwright/test';
import { measureHitArea, gateVerdict } from './hit-target.js';

// Onboarding's exercise-preference step: the flat ~60-row list with ~24px
// Like/Avoid buttons became a grouped, searchable picker. This walks a phone
// user to it, finds Lat Pulldown by search, likes it, clears the search and
// checks the like survived (pressed + counted), and that Like/Avoid are real
// 44px touch targets.
test.use({ viewport: { width: 390, height: 844 } });

test.describe('Onboarding exercise preference picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
  });

  test('search, like, clear search keeps the like; Like/Avoid are 44px', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Onboarding' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: /Get stronger/i }).click();
    await dialog.getByRole('button', { name: 'Next' }).click(); // goal
    await dialog.getByRole('button', { name: 'Gym' }).click();
    await dialog.getByRole('button', { name: 'Next' }).click(); // location
    await dialog.getByRole('button', { name: /Full gym/ }).click();
    await dialog.getByRole('button', { name: 'Next' }).click(); // kit
    await dialog.getByRole('button', { name: 'Next' }).click(); // level & schedule
    await expect(dialog.getByText('Fine-tune preferences (optional)')).toBeVisible();

    const picker = dialog.getByTestId('exercise-preference-picker');
    const count = picker.getByTestId('exercise-picker-count');
    await expect(count).toContainText('0 liked');

    const search = picker.getByLabel('Search exercises');
    await search.fill('pulldown');
    const like = picker.getByRole('button', { name: 'Like Lat Pulldown', exact: true });
    const avoid = picker.getByRole('button', { name: 'Avoid Lat Pulldown', exact: true });
    await expect(like).toBeVisible();
    await expect(like).toHaveAttribute('aria-pressed', 'false');

    // 44px touch targets (size + not covered).
    for (const control of [like, avoid]) {
      const box = await control.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(43.5);
      expect(gateVerdict(await measureHitArea(page, control))).toBe('pass');
    }

    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await expect(count).toContainText('1 liked');

    // Avoid is mutually exclusive with Like.
    await avoid.click();
    await expect(avoid).toHaveAttribute('aria-pressed', 'true');
    await expect(like).toHaveAttribute('aria-pressed', 'false');
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await expect(avoid).toHaveAttribute('aria-pressed', 'false');

    // Empty state offers a clear-search action.
    await search.fill('zzqxv');
    await expect(picker.getByText('No exercises match “zzqxv”.')).toBeVisible();
    await picker.getByRole('button', { name: 'Clear search' }).first().click();
    await expect(search).toHaveValue('');

    // After clearing, the like is still counted — overall and on the Back group.
    await expect(count).toContainText('1 liked · 0 avoided');
    const backGroup = picker.getByRole('button', { name: /^Back \(\d+\)/ });
    await expect(backGroup).toContainText('1 liked · 0 avoided');
    await expect(backGroup).toHaveAttribute('aria-expanded', 'false');
    await backGroup.click();
    await expect(backGroup).toHaveAttribute('aria-expanded', 'true');
    await expect(like).toHaveAttribute('aria-pressed', 'true');

    // "Show my picks" narrows to the one liked exercise.
    await picker.getByRole('button', { name: 'Show my picks' }).click();
    await expect(count).toContainText('Showing 1 of');
    await expect(like).toBeVisible();
  });
});
