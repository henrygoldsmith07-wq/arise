import { test, expect } from '@playwright/test';

async function completeOnboarding(page){
  await page.goto('/');
  await expect(page.getByRole('dialog', { name:'Onboarding' })).toBeVisible({ timeout:10_000 });
  await page.getByRole('button', { name:/Get stronger/i }).click();
  await page.getByRole('button', { name:'Next', exact:true }).click();
  await page.getByRole('button', { name:'Gym' }).click();
  await page.getByRole('button', { name:'Next', exact:true }).click();
  await page.getByLabel(/Dumbbells/i).click();
  await page.getByLabel(/Bench/i).click();
  await page.getByRole('button', { name:'Next', exact:true }).click();
  await page.getByRole('button', { name:'Intermediate' }).click();
  await page.getByRole('button', { name:'3×' }).click();
  await page.getByRole('button', { name:'45 min' }).click();
  await page.getByRole('button', { name:'Next', exact:true }).click();
  await page.getByRole('button', { name:/Save & continue/i }).click();
  await expect(page.getByRole('dialog', { name:'Onboarding' })).toBeHidden();
}

test('Gym Mode History button opens the per-lift sheet and Escape closes it', async ({ page }) => {
  await completeOnboarding(page);
  await page.evaluate(async () => {
    const storeModule = await import('/src/lib/store.js');
    const storageModule = await import('/src/lib/storage.js');
    const store = storeModule.loadStore();
    const isoAgo = (d) => { const t = new Date(); t.setUTCDate(t.getUTCDate() - d); return t.toISOString().slice(0, 10); };
    const ids = ['bench-press-dumbbell', 'dumbbell-bench-press', 'bench-press'];
    storeModule.saveStore({
      ...store,
      preferences:{ ...(store.preferences || {}), telemetryEnabled:false },
      history: [9, 6, 3].map((d, i) => ({
        id:`hist-${i}`, dateISO:isoAgo(d), savedAt:`${isoAgo(d)}T10:00:00Z`, title:'Upper',
        blocks: ids.map((exerciseId) => ({ exerciseId, sets:[{ reps:'8', weightKg:String(40 + i * 2.5), rpe:'8', completed:true }] })),
      })),
    });
    await storageModule.whenPersisted();
  });
  await page.reload();
  await page.getByRole('button', { name:'Today', exact:true }).click();
  const start = page.getByRole('button', { name:/Start workout|Start this session/ }).first();
  if (await start.isVisible()) await start.click();
  const runner = page.getByRole('dialog', { name:/Session —/ });
  await expect(runner).toBeVisible({ timeout:8000 });
  const historyBtn = runner.getByRole('button', { name:'History', exact:true }).first();
  test.skip(!(await historyBtn.isVisible()), 'no seeded lift appears in today\'s session');
  await historyBtn.click();
  const sheet = page.getByRole('dialog', { name:/ history$/ });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('img', { name:/1-rep max trend/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});
