import { test, expect } from "@playwright/test";
import { awaitPersisted } from "./helpers.js";

// Optional body-weight log: Progress → Body weight. A weigh-in is stored on
// device, survives a reload, rejects impossible values, and can be removed.
test("a weigh-in can be logged, survives a reload and can be removed", async ({
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
  // Real onboarding, not sample data: demo mode deliberately never persists,
  // so a weigh-in logged there could not survive a reload.
  const dialog = page.getByRole("dialog", { name: "Onboarding" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
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
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await awaitPersisted(page);
  await page
    .getByRole("button", { name: /^Progress$/ })
    .first()
    .click();

  const card = page.getByTestId("bodyweight-card");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByTestId("bodyweight-latest")).toHaveText("Not logged");

  await card.getByTestId("bodyweight-input").fill("5");
  await card.getByTestId("bodyweight-save").click();
  await expect(card.getByTestId("bodyweight-error")).toBeVisible();

  await card.getByTestId("bodyweight-input").fill("68.5");
  await card.getByTestId("bodyweight-save").click();
  await expect(card.getByTestId("bodyweight-latest")).toContainText("68.5");
  await expect(card.getByTestId("bodyweight-save")).toHaveText("Update");

  await awaitPersisted(page);
  await page.evaluate(async () => {
    const { whenPersisted } = await import("/src/lib/storage.js");
    await whenPersisted();
  });
  await page.reload();
  await page
    .getByRole("button", { name: /^Progress$/ })
    .first()
    .click();
  await expect(page.getByTestId("bodyweight-latest")).toContainText("68.5");

  await page
    .getByTestId("bodyweight-card")
    .getByText(/Recent weigh-ins/)
    .click();
  await page
    .getByRole("button", { name: /Remove weigh-in/ })
    .first()
    .click();
  await expect(page.getByTestId("bodyweight-latest")).toHaveText("Not logged");
});
