#!/usr/bin/env node
// scripts/screenshots.mjs — regenerate the docs screenshot gallery.
//
// Drives the REAL app through onboarding and a scheduled program (same flow
// as e2e/arise.spec.js) and captures the screens the docs reference, in both
// themes. Output: docs/screenshots/*.png + docs/screenshots/README.md index.
//
// The data on screen is the synthetic fixture this script creates — the
// gallery is illustrative, never a user's data. Re-run after meaningful UI
// changes:
//
//   npm run screenshots
//
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.SHOT_URL || 'http://localhost:4173';
const OUT = path.resolve('docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });

const SHOTS = [];

async function shot(page, name, label){
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  SHOTS.push({ name, label, file });
  console.log(`  ✓ ${name}`);
}

async function completeOnboarding(page){
  await page.goto(BASE + '/?e2e=1');
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => new Promise((resolve) => {
    // The canonical store is IndexedDB (arise-idb-v1); delete it whole so the
    // gallery starts from a true first boot, then clear the flags layer.
    const req = indexedDB.deleteDatabase('arise-idb-v1');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }));
  await page.reload();

  await page.getByRole('dialog', { name: 'Onboarding' }).waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: /Get stronger/i }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Gym' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel(/Dumbbells/i).click();
  await page.getByLabel(/Bench/i).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Intermediate' }).click();
  await page.getByRole('button', { name: '3×' }).click();
  await page.getByRole('button', { name: '45 min' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /Save & continue/i }).click();
  await page.getByRole('dialog', { name: 'Onboarding' }).waitFor({ state: 'hidden', timeout: 10_000 });
}

async function scheduleProgram(page){
  await page.getByRole('button', { name: 'Train' }).click();
  // One button per program card — strict mode needs .first().
  const generateBtn = page.getByRole('button', { name: /Generate from profile/i }).first();
  if (await generateBtn.isVisible().catch(() => false)) await generateBtn.click();
  await page.waitForTimeout(400);
  const scheduleBtn = page.getByRole('button', { name: /Schedule this program/i }).first();
  if (await scheduleBtn.isVisible().catch(() => false)) await scheduleBtn.click();
  await page.getByText(/Start: \d{4}-\d{2}-\d{2}/).waitFor({ timeout: 10_000 });
}

async function logOneSession(page){
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  const startBtn = page.getByRole('button', { name: /Start today.s session|Start this session/ }).first();
  if (await startBtn.isVisible().catch(() => false)) await startBtn.click();
  const runner = page.getByRole('dialog', { name: /Session —/ });
  await runner.waitFor({ timeout: 10_000 });
  // Save requires EVERY set to carry reps, so fill them all; mark a handful
  // complete so the session has volume to show in Progress.
  const repInputs = runner.getByPlaceholder('8');
  const reps = await repInputs.count();
  const loadInputs = runner.getByPlaceholder('kg');
  const loads = await loadInputs.count();
  for (let i = 0; i < reps; i++){
    await repInputs.nth(i).fill(String(8 + (i % 2)));
    if (i < loads) await loadInputs.nth(i).fill(String(20 + 2.5 * (i % 6)));
  }
  // Rows re-render as sets complete, so query fresh each click instead of
  // pinning nth() indices.
  for (let guard = 0; guard < 10; guard++){
    const doneButtons = runner.getByRole('button', { name: /^Done/ });
    if (!(await doneButtons.count())) break;
    if (guard >= 4) break; // marking a handful is plenty for the gallery
    await doneButtons.first().click();
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(400);
  await shot(page, 'session-runner', 'Session runner — logging a set');
  // Saving navigates to Progress itself; the runner overlay blocks the tab
  // bar, so do not click the nav while it is open.
  await page.getByRole('button', { name: 'Save session' }).click();
  // Saving switches the app to Progress.
  await page.getByRole('heading', { name: 'Progress' }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);
}

async function gotoTab(page, tab){
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.getByRole('heading', { name: tab }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(700); // let charts/illustrations settle
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();

  await completeOnboarding(page);
  await shot(page, 'today', 'Today — the session for today');
  await gotoTab(page, 'Train');
  await shot(page, 'train', 'Train — programs and templates');
  await gotoTab(page, 'Exercises');
  await shot(page, 'exercises', 'Exercises — library and filters');

  await scheduleProgram(page);
  await shot(page, 'today-scheduled', 'Today with the scheduled session');

  await logOneSession(page);
  await shot(page, 'progress', 'Progress — volume, streaks, PRs');

  // Explicit "light" renders identically to system light, so only the dark
  // theme needs its own capture (Progress above is the light reference).
  for (let i = 0; i < 4; i++){
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    if (isDark) break;
    await page.getByRole('button', { name: /Change theme/ }).click();
    await page.waitForTimeout(700);
  }
  if (!(await page.evaluate(() => document.documentElement.classList.contains('dark')))) throw new Error('theme did not reach dark');
  await page.waitForTimeout(600);
  await shot(page, 'theme-dark', 'Theme — dark mode');

  await ctx.close();

  const md = [
    '# Screenshot gallery', '',
    'Captured from the real app by `npm run screenshots` (Playwright drives',
    'onboarding, a scheduled program and a logged session; the data is the',
    'synthetic fixture the script creates). Re-run after meaningful UI changes.', '',
    ...SHOTS.flatMap((s) => [`## ${s.label}`, '', `![${s.label}](./${path.basename(s.file)})`, '']),
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'README.md'), md);
  console.log(`\n${SHOTS.length} screenshots + index written to docs/screenshots/`);
} finally {
  await browser.close();
}
