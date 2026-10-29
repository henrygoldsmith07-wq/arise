import { test, expect } from "@playwright/test";

// Records wall on Progress: heaviest load per rep band for every lift logged.
// Sample data supplies several weeks of loaded sessions.
test("records wall lists lifts with rep-band bests, searches and closes", async ({
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

  const card = page.getByTestId("records-card");
  await expect(card).toBeVisible({ timeout: 15_000 });
  const open = card.getByTestId("records-open");
  const openBox = await open.boundingBox();
  expect(openBox.height).toBeGreaterThanOrEqual(44);
  await open.click();

  const wall = page.getByRole("dialog", { name: "Records wall" });
  await expect(wall).toBeVisible();
  const rows = wall.getByTestId("records-row");
  const total = await rows.count();
  expect(total).toBeGreaterThan(0);
  // Every lift shows all five rep bands.
  await expect(rows.first().locator("dt")).toHaveCount(5);

  // Search narrows the list; a nonsense query empties it.
  await wall.getByRole("searchbox", { name: "Search a lift" }).fill("zzzzqq");
  await expect(rows).toHaveCount(0);
  await expect(wall.getByText("No lifts match.")).toBeVisible();
  await wall.getByRole("searchbox", { name: "Search a lift" }).fill("");
  await expect(rows).toHaveCount(total);

  // Muscle chips are 44px tap targets and filter.
  const chips = wall.getByRole("group", { name: "Muscle" }).getByRole("button");
  const chipBox = await chips.nth(1).boundingBox();
  expect(chipBox.height).toBeGreaterThanOrEqual(44);
  await chips.nth(1).click();
  await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");

  await wall.getByRole("button", { name: "Done" }).click();
  await expect(wall).toBeHidden();
});
