import { test, expect } from "@playwright/test";

// Lift goals on Progress: set a target for a logged lift, see an honest status
// line, edit and remove it. Sample data supplies the logged history.
test("a lift goal can be set, shows a status line and can be removed", async ({
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

  const card = page.getByTestId("lift-goals-card");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByTestId("lift-goal-add").click();

  // Impossible targets are refused with a reason.
  await card.getByTestId("lift-goal-lift").selectOption({ index: 1 });
  await card.getByTestId("lift-goal-load").fill("0");
  await card.getByTestId("lift-goal-save").click();
  await expect(card.getByTestId("lift-goal-error")).toBeVisible();

  await card.getByTestId("lift-goal-load").fill("500");
  await card.getByTestId("lift-goal-reps").fill("5");
  await card.getByTestId("lift-goal-save").click();
  await expect(card.getByTestId("lift-goal-form")).toBeHidden();
  await expect(card.getByTestId("lift-goal-status")).toBeVisible();
  await expect(card.getByTestId("lift-goal-line")).not.toHaveText("");

  await card.getByRole("button", { name: /Remove goal for/ }).click();
  await expect(card.getByTestId("lift-goal-status")).toHaveCount(0);
});
