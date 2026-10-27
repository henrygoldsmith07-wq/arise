import { test, expect } from "@playwright/test";

test("shorter-rest advice fires when reps hold with reps in reserve on long rest and respects a chosen preset", async ({ page }) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const m = await import("/src/lib/gymMode.js");
    const d = (reps, rir) => ({ completed: true, reps, rir });
    const block = { restSec: 180, sets: [d(12, 3), d(12, 4), {}] };
    return {
      fires: m.shorterRestAdvice(block)?.seconds,
      chosen: m.shorterRestAdvice(block, { hasUserPreset: true }),
    };
  });
  expect(r).toEqual({ fires: 120, chosen: null });
});
