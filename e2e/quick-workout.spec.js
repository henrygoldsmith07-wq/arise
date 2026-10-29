import { test, expect } from "@playwright/test";

// Quick workout: pick lifts on Today, start an unplanned session. Sample data
// supplies a history so "Same as last time" and "Rested muscles" have lifts.
test("a quick workout can be assembled from a shortcut and started", async ({ page }) => {
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

  await page.getByTestId("quick-workout-open").click();
  const sheet = page.getByTestId("quick-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("quick-start")).toBeDisabled();

  await sheet.getByTestId("quick-upper").click();
  await expect(sheet.getByTestId("quick-note")).toContainText(/Upper body/);
  const picked = sheet.getByTestId("quick-picked").getByRole("listitem");
  expect(await picked.count()).toBeGreaterThan(0);

  // Remove one, add one by search, start.
  await picked.first().getByRole("button", { name: /^Remove / }).click();
  await sheet.getByTestId("quick-search").fill("curl");
  await sheet.getByTestId("quick-results").getByRole("button").first().click();
  const count = await picked.count();
  await sheet.getByTestId("quick-start").click();

  await expect(sheet).toBeHidden();
  const runner = page.getByRole("dialog", { name: /Session —/ });
  await expect(runner).toBeVisible({ timeout: 10_000 });
  await expect(runner).toContainText("Quick workout");
  expect(count).toBeGreaterThan(0);
});
