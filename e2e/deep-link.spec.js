import { test, expect } from '@playwright/test';

// Deep-link routing e2e.
//
// The router (src/lib/router.js) exists so that (a) a ?tab= deep link opens on
// that tab, and (b) the browser's BACK/FORWARD buttons cycle through the tabs
// visited in the session. Both are stated in the module's own contract, and
// both are things a person actually does — a bookmarked link, a home-screen
// shortcut, and the back button.
//
// These tests pin the whole contract. The back-button half was silently
// broken: App.jsx passed { replace: true } on every sync, so syncTabToUrl
// never reached its pushState branch and initialTabSeen was dead code.

const tabButton = (page, name) => page.getByRole('button', { name, exact: true });
const tabOf = (page) => page.evaluate(() => new URLSearchParams(window.location.search).get('tab'));

const WIPE = (page) => page.evaluate(() => new Promise((resolve) => {
  localStorage.clear();
  sessionStorage.clear();
  try{
    const r = indexedDB.deleteDatabase('arise-idb-v1');
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  }catch{ resolve(); }
}));

/** Reset to a genuine first run, then take the demo path (which records a
 *  profile), and assert the shell is up. Demo entry deliberately forces the
 *  Today tab, so anything that follows boot straight into a tab must navigate
 *  again rather than reuse this helper's landing tab. */
async function bootToShell(page){
  await page.goto('/');
  await WIPE(page);
  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Onboarding' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: /Explore with sample data/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Demo mode banner' })).toBeVisible({ timeout: 15_000 });
}

/** The bookmark scenario: a device that already has a profile (no onboarding
 *  modal) opens directly on the tab named in the URL. */
async function deepLink(page, tab){
  await bootToShell(page); // leave onboarding behind, profile recorded
  await page.goto(`/?tab=${tab}`);
  await expect(page.getByRole('region', { name: 'Demo mode banner' })).toBeVisible({ timeout: 15_000 });
}

test.describe('deep-link routing', () => {
  test('a ?tab= URL opens directly on that tab', async ({ page }) => {
    await deepLink(page, 'exercises');
    await expect(tabButton(page, 'Exercises')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Exercises' })).toBeVisible({ timeout: 10_000 });
    expect(await tabOf(page), 'the URL still names the tab').toBe('exercises');
  });

  test('an unknown ?tab= falls back to Today rather than breaking', async ({ page }) => {
    await bootToShell(page);
    await page.goto('/?tab=sideways');
    await expect(page.getByRole('region', { name: 'Demo mode banner' })).toBeVisible({ timeout: 15_000 });
    await expect(tabButton(page, 'Today')).toHaveAttribute('aria-current', 'page');
    expect(await tabOf(page), 'the bogus value is replaced, not persisted').toBe('today');
  });

  test('a missing ?tab= also resolves to Today', async ({ page }) => {
    await bootToShell(page);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Demo mode banner' })).toBeVisible({ timeout: 15_000 });
    await expect(tabButton(page, 'Today')).toHaveAttribute('aria-current', 'page');
  });

  test('the back button walks back through the tabs visited in the session', async ({ page }) => {
    await bootToShell(page);
    expect(await tabOf(page)).toBe('today');

    await tabButton(page, 'Train').click();
    await expect(tabButton(page, 'Train')).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => tabOf(page)).toBe('train');

    await tabButton(page, 'Progress').click();
    await expect(tabButton(page, 'Progress')).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => tabOf(page)).toBe('progress');

    // Back once → Train. Not a page exit, and not a doubled entry.
    await page.goBack();
    await expect(tabButton(page, 'Train')).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => tabOf(page)).toBe('train');

    // Back again → Today.
    await page.goBack();
    await expect(tabButton(page, 'Today')).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => tabOf(page)).toBe('today');

    // Forward replays the trail.
    await page.goForward();
    await expect.poll(() => tabOf(page)).toBe('train');
    await expect(tabButton(page, 'Train')).toHaveAttribute('aria-current', 'page');
  });

  test('back/forward does not stack duplicate history entries', async ({ page }) => {
    await bootToShell(page);

    await tabButton(page, 'Exercises').click();
    await expect.poll(() => tabOf(page)).toBe('exercises');
    await tabButton(page, 'More').click();
    await expect.poll(() => tabOf(page)).toBe('more');

    // Walk back. If a sync double-pushed, this trail is longer than the tab
    // changes the user actually performed — more 'exercises'/'today' entries
    // than expected before we leave the app.
    const seen = [];
    for (let i = 0; i < 4; i++){
      await page.goBack();
      await page.waitForTimeout(150);
      seen.push(await tabOf(page));
    }
    expect(seen, 'back walks exactly the visited tabs, in reverse order').toEqual(['exercises', 'today', null, null]);
  });

  test('the first load does not add a spurious back step', async ({ page }) => {
    // The mirror-image bug: fixing back/forward must not turn every sync into
    // a push, or the initial deep link leaves a duplicate entry and the first
    // back press lands on the same content the user is already looking at.
    await deepLink(page, 'progress');
    await expect(tabButton(page, 'Progress')).toHaveAttribute('aria-current', 'page');

    await page.goBack();
    expect(page.url(), 'the first back leaves the deep-linked tab entirely').not.toContain('tab=progress');
  });
});
