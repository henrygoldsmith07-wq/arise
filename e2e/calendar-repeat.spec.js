import { test, expect } from "@playwright/test";

// Progress: the training calendar marks trained days, and Repeat on a history
// row starts that session's lifts as a Quick workout.
test("training calendar and repeat-a-workout", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        localStorage.clear();
        sessionStorage.clear();
        const r = indexedDB.deleteDatabase("arise-idb-v1");
        r.onsuccess = r.onerror = r.onblocked = () => resolve();
      }),
  );
  await page.reload();
  const dialog = page.getByRole("dialog", { name: "Onboarding" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: /Explore with sample data/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Progress$/ }).first().click();

  const cal = page.getByTestId("training-calendar");
  await cal.scrollIntoViewIfNeeded();
  await expect(cal).toBeVisible();
  // Walk back until a month with training shows (demo history is recent).
  for (let i = 0; i < 3 && !(await cal.locator('[aria-label$=", trained"]').count()); i++) {
    await cal.getByRole("button", { name: "Previous month" }).click();
  }
  await expect(cal.locator('[aria-label$=", trained"]').first()).toBeVisible();
  expect((await cal.getByRole("button", { name: "Previous month" }).boundingBox()).height).toBeGreaterThanOrEqual(43.5);

  const repeat = page.getByRole("button", { name: /^Repeat / }).first();
  await repeat.scrollIntoViewIfNeeded();
  await repeat.click();
  await expect(page.getByRole("dialog", { name: /Session — Quick workout/ })).toBeVisible({ timeout: 8_000 });
});
