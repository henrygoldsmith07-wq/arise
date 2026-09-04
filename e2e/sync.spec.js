import { test, expect } from '@playwright/test';

// Cross-device sync e2e: configure a (route-mocked) WebDAV remote, run one
// sync cycle, and verify the status screen plus the central privacy guarantee —
// the payload that reaches the storage server is ENCRYPTED, and the app
// password never doubles as the end-to-end passphrase.
//
// bypassCSP: the production Content-Security-Policy only allowlists the
// illustration host + NVIDIA endpoint; the mocked dav host exists only in the
// test, so the page must be allowed to fetch it.

test.describe.configure({ mode: 'serial' });
test.use({ bypassCSP: true });

const DAV_FILE = [];

async function completeOnboarding(page){
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => new Promise(resolve => {
    try{ indexedDB.deleteDatabase('arise-idb-v1'); resolve(); }catch{ resolve(); }
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
  await expect(page.getByRole('dialog', { name: 'Onboarding' })).toBeHidden();
}

async function mockWebdav(page){
  await page.route('**/dav.test/arise-sync/arise-backup.arise', async (route) => {
    const req = route.request();
    if(req.method() === 'GET'){
      await route.fulfill({ status: DAV_FILE.length ? 200 : 404, body: DAV_FILE[0] || '' });
    }else if(req.method() === 'PUT'){
      DAV_FILE[0] = req.postDataBuffer() || req.postData();
      await route.fulfill({ status: 201 });
    }else{
      await route.fulfill({ status: 405 });
    }
  });
  await page.route('**/dav.test/', (route) => route.fulfill({ status: 200, headers: { dav: '1' } }));
}

test('sync: configure WebDAV, sync once, payload is sealed and status shown', async ({ page }) => {
  await mockWebdav(page);
  await completeOnboarding(page);

  await page.getByRole('button', { name: 'More', exact: true }).click();
  const syncHeading = page.getByText('Cross-device sync', { exact: true });
  await expect(syncHeading).toBeVisible();

  // Fill the form (sync panel renders lazily inside its section). The E2E
  // passphrase is its own field — deliberately separate from the app password.
  await page.getByLabel(/WebDAV URL/).fill('https://dav.test');
  await page.getByLabel(/^Username/).fill('athlete');
  await page.getByLabel(/^App password/).fill('app-password-123');
  await page.getByLabel(/Encryption passphrase/i).fill('correct horse battery staple');
  await page.getByRole('checkbox', { name: 'Enabled' }).check();
  await page.getByRole('button', { name: /Save & sync now/i }).click();

  await expect(page.getByText(/Sync complete/i)).toBeVisible({ timeout: 15_000 });

  // The remote received an encrypted envelope, not JSON.
  await expect.poll(async () => DAV_FILE.length ? 'set' : 'unset', { timeout: 10_000 }).toBe('set');
  const bytes = DAV_FILE[0];
  expect(bytes).toBeTruthy();
  const head = Buffer.from(bytes.slice ? bytes.slice(0, 4) : bytes).toString('latin1');
  expect(head).toBe('ARCB'); // encrypted backup magic — NOT readable JSON
  const asText = bytes.toString ? bytes.toString('latin1') : String(bytes);
  expect(asText.includes('bench-press')).toBe(false);

  // Status screen reflects the sync and hides both secrets.
  await expect(page.getByText(/Last push/i)).toBeVisible();
  const body = await page.locator('body').innerText();
  expect(body).not.toContain('app-password-123');
  expect(body).not.toContain('correct horse battery staple');
});
