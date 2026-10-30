import { test, expect } from "@playwright/test";

// Training notes journal in More: search across session notes and setup notes.
test("training notes sheet opens, filters and closes", async ({ page }) => {
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
    .getByRole("button", { name: /^More$/ })
    .first()
    .click();

  const open = page.getByTestId("notes-open");
  await open.scrollIntoViewIfNeeded();
  expect((await open.boundingBox()).height).toBeGreaterThanOrEqual(40);
  await open.click();

  const sheet = page.getByRole("dialog", { name: "Training notes" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("searchbox", { name: "Search notes" }).fill("zzzzqq");
  await expect(sheet.getByTestId("note-row")).toHaveCount(0);
  await expect(sheet.getByText("0 of")).toBeVisible();
  const chips = sheet.getByRole("group", { name: "Tag" }).getByRole("button");
  expect((await chips.first().boundingBox()).height).toBeGreaterThanOrEqual(44);
  await chips.first().click();
  await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});
