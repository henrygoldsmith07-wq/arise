import { test, expect } from '@playwright/test';

const FIXED_NOW = '2026-09-26T12:00:00.000Z';

async function freezeClock(page){
  await page.addInitScript((fixedIso) => {
    const RealDate = Date;
    const fixed = RealDate.parse(fixedIso);
    class FixedDate extends RealDate {
      constructor(...args){ super(...(args.length ? args : [fixed])); }
      static now(){ return fixed; }
    }
    Object.setPrototypeOf(FixedDate, RealDate);
    globalThis.Date = FixedDate;
  }, FIXED_NOW);
}

async function resetFreshUserState(page){
  await page.goto('/');
  await page.evaluate(() => new Promise((resolve) => {
    localStorage.clear();
    sessionStorage.clear();
    try{
      const request = indexedDB.deleteDatabase('arise-idb-v1');
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    }catch{ resolve(); }
  }));
  await page.reload();
}

async function seedVisualState(page, theme = 'light'){
  await resetFreshUserState(page);
  const dialog = page.getByRole('dialog', { name:'Onboarding' });
  await expect(dialog).toBeVisible({ timeout:10_000 });
  await dialog.getByRole('button', { name:/Explore with sample data/i }).click();
  await expect(page.getByRole('region', { name:'Demo mode banner' })).toBeVisible();
  await page.evaluate(async (nextTheme) => {
    const [{ loadStore, saveStore }, { whenPersisted }] = await Promise.all([
      import('/src/lib/store.js'),
      import('/src/lib/storage.js'),
    ]);
    const current = loadStore();
    saveStore({
      ...current,
      preferences:{ ...(current.preferences || {}), theme:nextTheme },
    });
    await whenPersisted();
  }, theme);
  await page.reload();
  await expect(page.getByRole('region', { name:'Demo mode banner' })).toBeVisible();
  await page.addStyleTag({ content:'img[src^="https://bryllim.github.io"]{visibility:hidden!important}' });
}

async function stableScreenshot(page, name){
  await expect(page.locator('#main')).toBeVisible();
  await page.waitForTimeout(250);
  await expect(page).toHaveScreenshot(name, {
    animations:'disabled',
    caret:'hide',
    scale:'css',
  });
}

test.describe('visual regression baselines', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(process.platform !== 'linux', 'CI/Linux is the visual-regression authority; desktop OS font rasterization differs');
    test.skip(testInfo.project.name !== 'chromium', 'single desktop baseline avoids device-specific raster noise');
    await page.setViewportSize({ width:1280, height:800 });
    await freezeClock(page);
  });

  for(const tab of ['Today', 'Train', 'Progress', 'More']){
    test(`${tab} light`, async ({ page }) => {
      await seedVisualState(page, 'light');
      await page.getByRole('button', { name:tab, exact:true }).click();
      await stableScreenshot(page, `${tab.toLowerCase()}-light.png`);
    });
  }

  test('Today dark', async ({ page }) => {
    await seedVisualState(page, 'dark');
    await page.getByRole('button', { name:'Today', exact:true }).click();
    await stableScreenshot(page, 'today-dark.png');
  });

  test('active workout', async ({ page }) => {
    await seedVisualState(page, 'light');
    await page.getByRole('button', { name:'Today', exact:true }).click();
    await page.getByRole('button', { name:/Start workout|Start this session/ }).first().click();
    await expect(page.getByRole('dialog', { name:/Session —/ })).toBeVisible({ timeout:8_000 });
    await stableScreenshot(page, 'active-workout-light.png');
  });
});
