import { test, expect } from "@playwright/test";
import fs from "node:fs";

// More → Data → Export for Hevy: the workouts a lifter logged in Arise leave as
// Hevy's own CSV; workouts that were imported from Hevy stay out by default so
// Hevy is not sent its own data back as duplicates.
async function completeOnboarding(page) {
  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "Onboarding" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Get stronger/i }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Gym" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel(/Dumbbells/i).click();
  await page.getByLabel(/Bench/i).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Intermediate" }).click();
  await page.getByRole("button", { name: "3×" }).click();
  await page.getByRole("button", { name: "45 min" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: /Save & continue/i }).click();
  await expect(page.getByRole("dialog", { name: "Onboarding" })).toBeHidden();
}

test("Export for Hevy writes Hevy's CSV and holds back Hevy-origin workouts", async ({ page }) => {
  await completeOnboarding(page);
  await page.evaluate(async () => {
    const storeModule = await import("/src/lib/store.js");
    const storageModule = await import("/src/lib/storage.js");
    const store = storeModule.loadStore();
    const mk = (id, dateISO, note, title) => ({
      id, dateISO, title, note, durationMinutes: 40,
      savedAt: `${dateISO}T10:00:00Z`,
      blocks: [{ exerciseId: "chest-press-machine", sets: [{ reps: "10", weightKg: "50", rpe: "8", completed: true }, { reps: "9", weightKg: "50", rpe: "9", completed: true }] }],
    });
    storeModule.saveStore({
      ...store,
      preferences: { ...(store.preferences || {}), telemetryEnabled: false },
      history: [
        mk("hevy-2026-09-02-abc", "2026-09-02", "Imported from Hevy CSV", "Push (Hevy)"),
        mk("own-1", "2026-09-04", "", "Upper A"),
      ],
    });
    await storageModule.whenPersisted();
  });
  await page.reload();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByTestId("hevy-export-open").click();

  const sheet = page.getByTestId("hevy-export-sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByTestId("hevy-range-all").click();
  const summary = sheet.getByTestId("hevy-export-summary");
  await expect(summary).toContainText("1 workout");
  await expect(summary).toContainText("2 sets");

  // Counting the Hevy-origin workout in adds it back.
  await sheet.getByTestId("hevy-include-imported").check();
  await expect(summary).toContainText("2 workouts");
  await sheet.getByTestId("hevy-include-imported").uncheck();

  const download = page.waitForEvent("download");
  await sheet.getByTestId("hevy-download").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^arise-for-hevy-.*\.csv$/);
  const text = fs.readFileSync(await file.path(), "utf8");
  expect(text.split("\n")[0]).toContain('"exercise_title"');
  expect(text).toContain('"Chest Press (Machine)"');
  expect(text).toContain('"Upper A"');
  expect(text).not.toContain("Push");

  // The newest exported day is remembered on this device for next time.
  await expect(sheet.getByTestId("hevy-export-msg")).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  await page.getByTestId("hevy-export-open").click();
  await expect(page.getByTestId("hevy-range-since-last")).toBeVisible();
});
