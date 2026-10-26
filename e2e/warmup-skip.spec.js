import { test, expect } from "@playwright/test";

test("warm-up skip memory drops ramp sets for the remembered lift only", async ({
  page,
}) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const m = await import("/src/lib/gymMode.js");
    const prefs = { skipWarmups: m.setWarmupSkip(null, "chest-press", true) };
    const block = {
      exerciseId: "chest-press",
      warmups: [{ reps: 8, weightKg: 20 }],
    };
    return {
      skipped: m.effectiveWarmups(block, prefs).length,
      other: m.effectiveWarmups({ ...block, exerciseId: "row" }, prefs).length,
    };
  });
  expect(r).toEqual({ skipped: 0, other: 1 });
});
