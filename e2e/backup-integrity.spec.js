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

test('only a successful full backup satisfies the weekly backup reminder', async ({ page }) => {
  await completeOnboarding(page);
  await page.evaluate(async () => {
    const storeModule = await import('/src/lib/store.js');
    const storageModule = await import('/src/lib/storage.js');
    const store = storeModule.loadStore();
    storeModule.saveStore({
      ...store,
      preferences:{ ...(store.preferences || {}), telemetryEnabled:false },
      history:[{
        id:'backup-reminder-old-session',
        dateISO:'2026-09-01',
        savedAt:'2026-09-01T12:00:00.000Z',
        title:'Old session',
        blocks:[{ exerciseId:'bench-press-dumbbell', sets:[{ reps:'8', weightKg:'20', rpe:'8', completed:true }] }],
      }],
    });
    await storageModule.whenPersisted();
  });
  await page.reload();
  await page.getByRole('button', { name:'More', exact:true }).click();

  const reminder = page.getByText('Time for a backup', { exact:true });
  await expect(reminder).toBeVisible({ timeout:10_000 });

  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name:'Export CSV', exact:true }).click();
  await csvDownload;
  expect(await page.evaluate(()=> localStorage.getItem('arise.lastFullBackupAt.v1'))).toBeNull();
  await expect(reminder).toBeVisible();

  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name:'Export JSON', exact:true }).click();
  await backupDownload;
  await expect.poll(()=> page.evaluate(()=> localStorage.getItem('arise.lastFullBackupAt.v1'))).not.toBeNull();
  await expect(reminder).toBeHidden();
});
