import { test, expect } from "@playwright/test";

test("next-set advice holds the load when the machine step is a big jump", async ({ page }) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const m = await import("/src/lib/gymMode.js");
    const blk = { reps: "8-12", sets: [{ completed: true, weightKg: 30, reps: 12, rir: 3 }, { weightKg: 30 }] };
    return m.nextSetAdvice(blk, { equipment: "machine", config: { machineIncrementKg: 10 } })?.direction;
  });
  expect(r).toBe("hold");
});
