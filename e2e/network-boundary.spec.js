import { test, expect } from '@playwright/test';
import { INTEGRATIONS_ON, NEEDS_DEFAULT_BUILD } from './helpers/integrations.js';

// The network-boundary guarantee, proven rather than asserted.
//
// This drives the app the way a brand-new user does — onboarding, log a real
// session, export a backup, then visit every tab — with a hard interceptor on
// every request. Anything crossing an origin the build did not declare fails
// the test instead of silently working.
//
// WHAT THIS PROVES (and what it does not — docs/PRIVACY.md states the same
// boundary in user-facing terms):
//   * No third-party origin is contacted during a normal first-run session.
//   * The ONE documented exception is the exercise-illustration CDN, which
//     serves public SVG frames and receives no user data. That host is the
//     only non-self origin this app may reach, and it is allowlisted in CSP.
//   * Because the default build compiles the optional integrations out, the
//     AI coach, classifier.dev and Pulse cannot be reached at all — not by
//     misconfiguration, not by stale consent, not by a click.
//
// WHAT IT DOES NOT PROVE: that no code *could* call out after an explicit,
// separately-consented user action (WebDAV sync is user-supplied host by
// design and is exercised in sync.spec.js), nor anything about endpoints the
// browser extension or OS might add. It covers the default-settings path only.

const ALLOWED_CROSS_ORIGIN = [
  // Public exercise illustration frames. No cookies, no user data, no account.
  'bryllim.github.io',
];

const IGNORED_SCHEMES = ['data:', 'blob:', 'about:'];

function originOf(url){
  try{ return new URL(url).origin; }catch{ return null; }
}

async function withCrossOriginRecorder(page, run){
  // The app's own origin, taken from the config baseURL rather than page.url()
  // — page.url() is empty during the very first navigation, and getting that
  // wrong made the recorder block the main document itself.
  const APP_ORIGIN = new URL(test.info().project.use.baseURL || 'http://127.0.0.1:5187').origin;
  const violations = [];
  const thirdPartySeen = [];

  await page.route('**/*', async (route)=>{
    const url = route.request().url();
    const origin = originOf(url);

    if(!origin || IGNORED_SCHEMES.some(s=> url.startsWith(s))){
      return route.continue();
    }

    if(origin === APP_ORIGIN){
      return route.continue();
    }

    const host = new URL(url).host;
    const allowed = ALLOWED_CROSS_ORIGIN.some(h=> host === h || host.endsWith(`.${h}`));
    if(!allowed){
      violations.push({ url, method: route.request().method(), resourceType: route.request().resourceType() });
      // Block it so a violation cannot succeed by accident, and so the app
      // behaves as it would under a strict network.
      return route.abort('blockedbyclient');
    }
    thirdPartySeen.push({ url, resourceType: route.request().resourceType() });
    return route.continue();
  });

  await run();
  return { violations, thirdPartySeen };
}

async function completeOnboarding(page){
  await page.goto('/');
  await expect(page.getByRole('dialog', { name:'Onboarding' })).toBeVisible({ timeout:15_000 });
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

  const consent = page.getByRole('dialog', { name:'Local measurement consent' });
  if(await consent.isVisible().catch(()=> false)){
    await consent.getByRole('button', { name:'No thanks' }).click();
    await expect(consent).toBeHidden();
  }
}

async function logARealSession(page){
  await page.evaluate(async ()=>{
    const storeModule = await import('/src/lib/store.js');
    const storageModule = await import('/src/lib/storage.js');
    const store = storeModule.loadStore();
    storeModule.saveStore({
      ...store,
      history:[{
        id:'boundary-session',
        dateISO:'2026-09-20',
        savedAt:'2026-09-20T09:00:00.000Z',
        title:'Boundary session',
        blocks:[{ exerciseId:'bench-press-dumbbell', sets:[{ reps:'8', weightKg:'20', rpe:'7', completed:true }] }],
      }],
    });
    await storageModule.whenPersisted();
  });
  await page.reload();
}

// Visit every tab.
//
// The click is forced on purpose. This test is about the network boundary, not
// about hit-target geometry, and a pending third-party image can keep the
// layout unsettled long enough for Playwright's actionability check to give up
// on an otherwise perfectly good tab button. Waiting out actionability here
// made the test flaky without testing anything this spec claims to test.
async function visitAllTabs(page){
  for(const tab of ['Train','Exercises','Progress','More','Today']){
    const button = page.getByRole('button', { name:tab, exact:true });
    await button.waitFor({ state:'visible', timeout:15_000 });
    await button.click({ force:true, timeout:15_000 });
    await page.waitForTimeout(500);
  }
  // Give any lazy chunk time to fetch its own data before we judge.
  await page.waitForTimeout(800);
}

test('a default-settings session contacts no third-party origin', async ({ page })=>{
  const { violations, thirdPartySeen } = await withCrossOriginRecorder(page, async ()=>{
    await completeOnboarding(page);
    await logARealSession(page);

    // Export a backup — a genuinely outbound-capable code path.
    await page.getByRole('button', { name:'More', exact:true }).click({ force:true });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name:'Export JSON', exact:true }).click();
    await download;

    await visitAllTabs(page);
  });

  expect(
    violations,
    `default-settings flow must not contact any undeclared origin, but these did:\n${
      violations.map(v=> `  ${v.method} ${v.resourceType} ${v.url}`).join('\n') || '  (none)'}`
  ).toEqual([]);

  // Any third-party traffic that DID occur must be the documented illustration
  // host, and nothing else.
  const unexpected = thirdPartySeen.filter(s=> !ALLOWED_CROSS_ORIGIN.some(h=> s.url.includes(h)));
  expect(unexpected, 'only the documented illustration host may be reached').toEqual([]);
});

test('the shipped build compiles the optional integrations out', async ({ page })=>{
  test.skip(INTEGRATIONS_ON, NEEDS_DEFAULT_BUILD);
  await page.goto('/');
  const state = await page.evaluate(async ()=>{
    const { INTEGRATIONS_COMPILED_IN, INTEGRATIONS_LABEL } = await import('/src/lib/integrations.js');
    const classifier = await import('/src/lib/feedbackClassifier.js');
    const aiCoach = await import('/src/lib/aiCoach.js');
    return {
      compiledIn: INTEGRATIONS_COMPILED_IN,
      label: INTEGRATIONS_LABEL,
      feedbackEnabled: classifier.isFeedbackClassifierEnabled(),
      routingEnabled: classifier.isCoachRoutingEnabled(),
      // Ask the coach with a fake key. A build that has the integration
      // compiled out must refuse without touching the network.
      coach: await aiCoach.requestCoachInsight({ context:{ muscles:{ Chest:1 } }, apiKey:'not-a-real-key' }),
    };
  });

  expect(state.compiledIn, 'the default build has integrations compiled out').toBe(false);
  expect(state.feedbackEnabled).toBe(false);
  expect(state.routingEnabled).toBe(false);
  expect(state.coach.ok).toBe(false);
  expect(state.coach.notAvailable, 'the refusal is "not in this build", not "no API key"').toBe(true);
});

test('even a stale consent grant cannot open the network', async ({ page })=>{
  test.skip(INTEGRATIONS_ON, NEEDS_DEFAULT_BUILD);
  await page.goto('/');
  // Simulate a user who opted in on an older build, then got a build without
  // the integration. The consent key survives; the build gate must win.
  const result = await page.evaluate(async ()=>{
    localStorage.setItem('arise.classifier.feedback.settings.v1', JSON.stringify({ enabled:true }));
    localStorage.setItem('arise.classifier.coach-routing.settings.v1', JSON.stringify({ enabled:true }));
    const classifier = await import('/src/lib/feedbackClassifier.js');
    let networkAttempted = false;
    const outcome = await classifier.classifyText('my log is broken', {
      labels:['bug','other'],
      cloudOnlyIfLocalUncertain:true,
      fetchImpl:()=>{ networkAttempted = true; throw new Error('network must not be reached'); },
    });
    return {
      feedbackEnabled: classifier.isFeedbackClassifierEnabled(),
      routingEnabled: classifier.isCoachRoutingEnabled(),
      outcome,
      networkAttempted,
    };
  });

  expect(result.feedbackEnabled, 'stale consent does not re-enable a compiled-out integration').toBe(false);
  expect(result.routingEnabled).toBe(false);
  expect(result.networkAttempted, 'no request is attempted even with consent stored').toBe(false);
  expect(result.outcome.ok, 'the classifier still answers locally').toBe(true);
  expect(result.outcome.cloudAttempted).toBe(false);
});