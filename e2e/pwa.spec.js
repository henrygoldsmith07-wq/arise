import { test, expect } from '@playwright/test';

// PWA e2e: manifest contract, install-card platform behaviour, shortcut
// routing, and offline shell resilience. Real-device specifics (splash
// PNGs, haptics, safe-area pixels) live in docs/device-test-matrix.md.

test('manifest is served, valid, and carries the home-screen shortcuts', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBeTruthy();
  const manifest = await res.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.id).toBe('/');
  const names = manifest.shortcuts.map((s) => s.name);
  expect(names).toContain("Start today's workout");
  expect(names).toContain('Quick log');
  for(const shortcut of manifest.shortcuts){
    const icon = await request.get(shortcut.icons[0].src.replace('./', '/'));
    expect(icon.ok()).toBeTruthy();
  }
  // maskable + any icons resolve
  for(const icon of manifest.icons){
    const res2 = await request.get(icon.src.replace('./', '/'));
    expect(res2.ok()).toBeTruthy();
  }
});

test('iOS splash images are linked and served', async ({ page, request }) => {
  await page.goto('/');
  const hrefs = await page.locator('link[rel="apple-touch-startup-image"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  expect(hrefs.length).toBeGreaterThanOrEqual(8);
  for(const href of hrefs){
    const res = await request.get(href);
    expect(res.ok()).toBeTruthy();
  }
});

test('install card shows browser guidance, hides when standalone is emulated', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => new Promise(resolve => { try{ const req = indexedDB.deleteDatabase('arise-idb-v1'); req.onsuccess = req.onerror = req.onblocked = () => resolve(); }catch{ resolve(); } }));
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
  await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeHidden();

  // Desktop Chromium without a fired beforeinstallprompt → menu instructions.
  await expect(page.getByTestId('install-card')).toBeVisible();
  await expect(page.getByText(/Install from your browser menu/)).toBeVisible();
  // Dismiss persists for the session.
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByTestId('install-card')).toBeHidden();

  // Standalone (installed app) → card absent even after reload. Simulate the
  // installed display mode via the iOS-legacy flag the module honours.
  await context.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { value: true }); });
  await page.reload();
  await expect(page.getByTestId('install-card')).toHaveCount(0);
});

test('home-screen shortcut URLs route to the right tab and scrub themselves', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeVisible({ timeout: 10_000 });
  const dialog = page.getByRole('dialog', { name: 'Onboarding' });
  await dialog.getByRole('button', { name: /Feel better/i }).click();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: /Gym/ }).click();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByLabel(/Bodyweight/i).click();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: 'Beginner', exact: true }).click();
  await dialog.getByRole('button', { name: '3×' }).click();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: /Save & continue/i }).click();

  // Now launch through the shortcut URL — the installed-app "Quick log" tap.
  await page.goto('/?shortcut=quick-log');
  await expect(page.getByRole('heading', { name: /Train/i }).first()).toBeVisible({ timeout: 8_000 });
  expect(new URL(page.url()).searchParams.get('shortcut')).toBeNull();
});

test('offline: cached shell still boots the app', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeVisible({ timeout: 10_000 });

  // Wait for the service worker to claim, then sever the network.
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15_000 });
  await context.setOffline(true);
  await page.reload();
  // The shell must come from the SW cache — onboarding dialog renders again.
  await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeVisible({ timeout: 15_000 });
  await context.setOffline(false);
});
