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

test('accepting the stalled-lift deload pins it as the next target and can be undone', async ({ page }) => {
  await completeOnboarding(page);
  await page.evaluate(async () => {
    const storeModule = await import('/src/lib/store.js');
    const storageModule = await import('/src/lib/storage.js');
    const store = storeModule.loadStore();
    const kgs = [50, 55, 55, 55, 55];
    storeModule.saveStore({
      ...store,
      preferences:{ ...(store.preferences || {}), telemetryEnabled:false },
      history: kgs.map((kg, i) => ({
        id:`stall-${i}`,
        dateISO:`2026-09-${String(10 + i).padStart(2, '0')}`,
        savedAt:`2026-09-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
        title:'Upper',
        blocks:[{ exerciseId:'bench-press-dumbbell', sets:[{ reps:'8', weightKg:String(kg), rpe:'8', completed:true }] }],
      })),
    });
    await storageModule.whenPersisted();
  });
  await page.reload();
  await page.getByRole('button', { name:/^Progress$/i }).click();
  await expect(page.getByTestId('stall-deload')).toBeVisible({ timeout:10_000 });
  await page.getByTestId('stall-deload-accept').click();
  await expect(page.getByTestId('stall-deload-undo')).toBeVisible();
  await page.evaluate(async () => { const m = await import('/src/lib/storage.js'); await m.whenPersisted(); });
  await page.reload();
  await page.getByRole('button', { name:/^Progress$/i }).click();
  await expect(page.getByTestId('stall-deload-undo')).toBeVisible();
  await page.getByTestId('stall-deload-undo').click();
  await expect(page.getByTestId('stall-deload-accept')).toBeVisible();
});
