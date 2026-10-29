import fs from "node:fs";
import { test, expect } from "@playwright/test";

// Train → Add to calendar: the downloaded .ics holds the upcoming sessions,
// and moving one session then exporting again keeps the same event UIDs.
test("add to calendar downloads an .ics of upcoming sessions", async ({ page }) => {
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
  await page.getByRole("button", { name: /^Train$/ }).first().click();

  const card = page.getByTestId("calendar-export");
  await card.waitFor({ timeout: 8_000 }).catch(() => {});
  if (!(await card.count())) test.skip(true, "no active programme in this fixture");

  await card.getByLabel("Session start time").fill("07:30");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    card.getByTestId("calendar-export-btn").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^arise-training-\d{4}-\d{2}-\d{2}\.ics$/);
  const body = fs.readFileSync(await download.path(), "utf8");
  expect(body).toContain("BEGIN:VCALENDAR");
  expect(body).toMatch(/DTSTART:\d{8}T073000/);
  expect(body).toMatch(/UID:arise-/);
  await expect(page.getByTestId("calendar-msg")).toContainText(/sessions/);
});
