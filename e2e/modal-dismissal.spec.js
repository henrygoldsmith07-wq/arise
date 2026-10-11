import { test, expect } from '@playwright/test';

// Keyboard dismissal for the modals that mount their own a11y hook
// (useDialogA11y) rather than the shared Dialog.jsx primitives.
//
// useDialogA11y used to trap Tab and restore focus but had NO Escape handler,
// so a keyboard user could reach a modal and could not leave it. Dialog.jsx has
// always closed on Escape; this pins the parity for the template builder.
//
// TeachingPanel's `variant="dialog"` modal shares the fixed hook, but both real
// call sites pass variant="inline", which is a non-modal disclosure by design —
// so the builder is the reachable modal and the one asserted here.

async function completeOnboarding(page){
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  // Clear the IndexedDB cache too — once hydrated it is canonical.
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
  await page.getByRole('button', { name: '3×' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /Save & continue/i }).click();
  await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeHidden({ timeout: 10_000 });
}

test('Escape closes the template builder without saving it', async ({ page }) => {
  await completeOnboarding(page);

  await page.getByRole('button', { name: 'Train' }).click();
  await expect(page.getByRole('heading', { name: 'Train' })).toBeVisible();

  // Train → Build my own & my templates → + New template.
  await page.getByRole('button', { name: /Build my own/i }).click();
  const opener = page.getByRole('button', { name: '+ New template' });
  await expect(opener).toBeVisible();
  await opener.click();

  const builder = page.getByRole('dialog', { name: 'Template builder' });
  await expect(builder).toBeVisible();

  // Focus starts inside the dialog, on its close control — the hook's mount
  // behaviour, unchanged by the Escape addition.
  await expect(page.getByRole('button', { name: 'Close builder' })).toBeFocused();

  // Escape only ever CANCELS. Assert the dialog closes AND that no template was
  // created — a save would leave an "Edit <name>" entry in the list. The
  // templates panel itself stays open: Escape closes the topmost modal only.
  await page.keyboard.press('Escape');
  await expect(builder).toBeHidden();

  await expect(page.getByRole('button', { name: '+ New template' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Edit /i })).toHaveCount(0);
});

test('Escape is inert outside a modal', async ({ page }) => {
  // The hook's listener is scoped to `active`; a stray Escape on plain Train
  // must not dismiss or navigate anything.
  await completeOnboarding(page);
  await page.getByRole('button', { name: 'Train' }).click();
  await expect(page.getByRole('heading', { name: 'Train' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Train' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Build my own/i })).toBeVisible();
});
