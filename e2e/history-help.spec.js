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


test('Progress e1RM help opens, closes on Escape,', async ({ page }) => {
  await completeOnboarding(page);
  await page.evaluate(async () => {
    const storeModule = await import('/src/lib/store.js');
    const storageModule = await import('/src/lib/storage.js');
    const store = storeModule.loadStore();
    const isoAgo = (d) => { const t = new Date(); t.setUTCDate(t.getUTCDate() - d); return t.toISOString().slice(0, 10); };
    storeModule.saveStore({
      ...store,
      preferences:{ ...(store.preferences || {}), telemetryEnabled:false },
      history: [50, 52.5, 55].map((kg, i) => ({
        id:`h-${i}`, dateISO:isoAgo(9 - i * 3), savedAt:`${isoAgo(9 - i * 3)}T10:00:00Z`, title:'Upper',
        blocks:[{ exerciseId:'bench-press-dumbbell', sets:[{ reps:'8', weightKg:String(kg), rpe:'8', completed:true }] }],
      })),
    });
    await storageModule.whenPersisted();
  });
  await page.reload();
  await page.getByRole('button', { name:/^Progress$/i }).click();
  const help = page.getByRole('button', { name:/What is .*(1RM|e1RM)/i }).first();
  await expect(help).toBeVisible({ timeout:10_000 });
  const box = await help.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await help.click();
  await expect(page.getByRole('note').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('note')).toHaveCount(0);
}); 
