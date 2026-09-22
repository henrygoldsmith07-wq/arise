import { test, expect } from '@playwright/test';

async function completeOnboarding(page){
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => new Promise((resolve) => {
    try{
      const request = indexedDB.deleteDatabase('arise-idb-v1');
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    }catch{ resolve(); }
  }));
  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Onboarding' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: /Get stronger/i }).click();
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await dialog.getByRole('button', { name: 'Gym' }).click();
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await dialog.getByLabel(/Dumbbells/i).click();
  await dialog.getByLabel(/Bench/i).click();
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await dialog.getByRole('button', { name: 'Intermediate' }).click();
  await dialog.getByRole('button', { name: '3×' }).click();
  await dialog.getByRole('button', { name: '45 min' }).click();
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await dialog.getByRole('button', { name: /Save & continue/i }).click();
  await expect(dialog).toBeHidden();
}

async function openFeedback(page){
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Feedback & issue triage' })).toBeVisible();
}

test('feedback flows through redaction, opt-in cloud triage, uncertainty, and operator review', async ({ page }) => {
  await page.addInitScript(() => {
    window.__ariseShares = [];
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (payload) => { window.__ariseShares.push(payload); },
    });
  });
  await completeOnboarding(page);
  let requestBody = null;
  await page.route('**classifier.dev**', async (route) => {
    requestBody = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          label: 'incorrect exercise or training information',
          confidence: 0.72,
          scores: {
            'incorrect exercise or training information': 0.72,
            unknown: 1,
          },
        }],
      }),
    });
  });
  await openFeedback(page);

  const consent = page.getByRole('checkbox', { name: 'Cloud-assisted feedback categorisation' });
  await expect(consent).not.toBeChecked();
  await consent.check();
  expect(await page.evaluate(() => localStorage.getItem('arise.classifier.feedback.settings.v1'))).toBe('{"enabled":true}');
  expect(await page.evaluate(() => localStorage.getItem('arise.classifier.coach-routing.settings.v1'))).toBeNull();
  await page.getByLabel('Describe the issue or request').fill('The exercise information is wrong. Email sam@example.com token: SECRET');
  await page.getByRole('button', { name: 'Save feedback locally' }).click();

  await expect(page.getByTestId('feedback-result')).toContainText('content-error');
  await expect(page.getByTestId('feedback-result')).toContainText('72%');
  await expect(page.getByTestId('feedback-result')).toContainText('needs operator review');
  expect(requestBody.inputs).toEqual(['The exercise information is wrong. Email [redacted-email] [redacted-secret]']);
  expect(requestBody.labels).toContain('incorrect exercise or training information');
  expect(requestBody.labels).not.toContain('content-error');
  expect(requestBody.instructions).not.toContain('sam@example.com');
  expect(requestBody.instructions).not.toContain('SECRET');

  const operator = page.getByLabel('Local feedback review queue');
  await expect(operator).toContainText('content-error');
  await expect(operator).toContainText('Needs review');
  await expect(operator).toContainText('[redacted-email]');
  expect(await page.evaluate(() => window.__ariseShares)).toEqual([]);
  await operator.getByRole('button', { name: 'Share with developer' }).click();
  const preview = page.getByTestId('feedback-share-preview');
  await expect(preview).toContainText('Exactly this redacted report will leave the device');
  const previewPayload = JSON.parse(await preview.locator('pre').innerText());
  expect(Object.keys(previewPayload).sort()).toEqual(['appVersion', 'category', 'confidence', 'feedback', 'needsReview'].sort());
  expect(previewPayload.feedback).toContain('[redacted-email]');
  expect(previewPayload.feedback).not.toContain('SECRET');
  expect(await page.evaluate(() => window.__ariseShares)).toEqual([]);
  await preview.getByRole('button', { name: 'Share externally' }).click();
  await expect.poll(() => page.evaluate(() => window.__ariseShares.length)).toBe(1);
  expect(await page.evaluate(() => window.__ariseShares[0].text)).toBe(JSON.stringify(previewPayload, null, 2));
  await operator.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(operator).toContainText('Reviewed');

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('arise.feedback.v1')));
  expect(stored).toHaveLength(1);
  expect(JSON.stringify(stored)).not.toContain('sam@example.com');
  expect(JSON.stringify(stored)).not.toContain('SECRET');
  expect(stored[0]).not.toHaveProperty('scores');
  expect(stored[0]).not.toHaveProperty('response');
});

test('feedback classification stays local when cloud assistance is disabled', async ({ page }) => {
  await completeOnboarding(page);
  let calls = 0;
  await page.route('**classifier.dev**', async (route) => {
    calls += 1;
    await route.abort();
  });
  await openFeedback(page);
  const consent = page.getByRole('checkbox', { name: 'Cloud-assisted feedback categorisation' });
  await expect(consent).not.toBeChecked();
  await page.getByLabel('Describe the issue or request').fill('The export is broken');
  await page.getByRole('button', { name: 'Save feedback locally' }).click();

  await expect(page.getByTestId('feedback-result')).toContainText('bug');
  await expect(page.getByTestId('feedback-result')).toContainText('local-keywords');
  expect(calls).toBe(0);
  await expect(page.getByLabel('Local feedback review queue')).toContainText('local-keywords');
});

test('coach routing consent is independent and cloud escalation is ambiguous-only', async ({ page }) => {
  await completeOnboarding(page);
  let calls = 0;
  let requestBody = null;
  await page.route('**classifier.dev**', async (route) => {
    calls += 1;
    requestBody = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ label: 'a question about how to train or use the local training coach', confidence: 0.72 }] }),
    });
  });
  await openFeedback(page);

  const feedbackConsent = page.getByRole('checkbox', { name: 'Cloud-assisted feedback categorisation' });
  const coachConsent = page.getByRole('checkbox', { name: 'Cloud-assisted coach request routing' });
  await expect(feedbackConsent).not.toBeChecked();
  await expect(coachConsent).not.toBeChecked();
  await page.getByLabel('Ask a coach-routing question').fill('maybe this is a training question');
  await page.getByRole('button', { name: 'Route coach question' }).click();
  await expect(page.getByTestId('coach-route-result')).toContainText('clarify');
  expect(calls).toBe(0);

  await coachConsent.check();
  expect(await page.evaluate(() => localStorage.getItem('arise.classifier.feedback.settings.v1'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('arise.classifier.coach-routing.settings.v1'))).toBe('{"enabled":true}');
  await page.getByRole('button', { name: 'Route coach question' }).click();
  await expect(page.getByTestId('coach-route-result')).toContainText('clarify');
  expect(calls).toBe(1);
  expect(requestBody.inputs).toEqual(['maybe this is a training question']);
  expect(requestBody.labels).not.toContain('training-question');

  await page.getByLabel('Describe the issue or request').fill('The export is broken');
  await page.getByRole('button', { name: 'Save feedback locally' }).click();
  await expect(page.getByTestId('feedback-result')).toContainText('bug');
  expect(calls).toBe(1);
});
