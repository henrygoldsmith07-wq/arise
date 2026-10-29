import { test, expect } from "@playwright/test";

// Weekly volume on Progress: hard sets per week from the logged history, a
// tappable bar per week and a muscle-by-muscle detail. Sample data supplies
// about five weeks of logged sessions.
test("weekly volume shows eight weeks and a detail for the tapped week", async ({
  page,
}) => {
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
  await dialog
    .getByRole("button", { name: /Explore with sample data/i })
    .click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await page
    .getByRole("button", { name: /^Progress$/ })
    .first()
    .click();

  const card = page.getByTestId("weekly-volume");
  await expect(card).toBeVisible({ timeout: 15_000 });
  const bars = card.getByTestId("weekly-volume-bar");
  await expect(bars).toHaveCount(8);
  // Newest week is selected first and says it is still in progress.
  await expect(card.getByTestId("weekly-volume-detail")).toContainText(
    "(so far)",
  );

  // An older week with sessions shows muscles and its sessions.
  const older = bars.nth(4);
  await older.click();
  await expect(older).toHaveAttribute("aria-pressed", "true");
  const detail = card.getByTestId("weekly-volume-detail");
  await expect(detail).not.toContainText("(so far)");
  await expect(detail).toContainText(/hard sets/);
  // Every bar is a 44px-tall tap target.
  const box = await older.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
});
