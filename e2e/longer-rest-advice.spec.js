import { test, expect } from "@playwright/test";

test("longer-rest advice fires on a 3+ rep drop with short rest and respects a chosen preset", async ({ page }) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const m = await import("/src/lib/gymMode.js");
    const d = (reps) => ({ completed: true, reps });
    const block = { restSec: 90, sets: [d(12), d(8), {}] };
    return {
      fires: m.longerRestAdvice(block)?.seconds,
      chosen: m.longerRestAdvice(block, { hasUserPreset: true }),
    };
  });
  expect(r).toEqual({ fires: 120, chosen: null });
});
