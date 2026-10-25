import { test, expect } from "@playwright/test";

test("guided helper fills pending sets from a found load", async ({ page }) => {
  await page.goto("/");
  const out = await page.evaluate(async () => {
    const m = await import("/src/lib/guidedMode.js");
    return m
      .applyFoundLoadToBlock(
        [{ sets: [{ weightKg: "" }, { weightKg: "" }] }],
        0,
        25,
      )
      .at(0)
      .sets.map((s) => s.weightKg);
  });
  expect(out).toEqual(["25", "25"]);
});
