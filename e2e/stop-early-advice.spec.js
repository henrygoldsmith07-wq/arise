import { test, expect } from "@playwright/test";

test("stop-early advice flags two low sets and lists pending sets", async ({ page }) => {
  await page.goto("/");
  const a = await page.evaluate(async () => {
    const m = await import("/src/lib/gymMode.js");
    return m.stopEarlyAdvice({ reps: "8-12", sets: [{ completed: true, reps: 6 }, { completed: true, reps: 5 }, {}, {}] });
  });
  expect(a.pendingIndexes).toEqual([2, 3]);
});
