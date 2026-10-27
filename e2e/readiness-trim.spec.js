import { test, expect } from "@playwright/test";

test("low readiness trims one set from 3+ set lifts, ok readiness does not", async ({ page }) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const m = await import("/src/lib/programming.js");
    const s = { blocks: [{ exerciseId: "a", sets: 3, reps: "8-12" }, { exerciseId: "b", sets: 2, reps: "10" }] };
    return {
      low: m.readinessTrimPlan(s, { score: 20 }).session.blocks.map((b) => b.sets),
      ok: m.readinessTrimPlan(s, { score: 80 }).changed,
    };
  });
  expect(r.low).toEqual([2, 2]);
  expect(r.ok).toBe(false);
});
