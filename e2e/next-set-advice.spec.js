import { test, expect } from "@playwright/test";

test("next-set advice drops load after a set under the rep floor", async ({ page }) => {
  await page.goto("/");
  const a = await page.evaluate(async () => {
    const m = await import("/src/lib/gymMode.js");
    return m.nextSetAdvice({ reps: "8-12", sets: [{ completed: true, weightKg: 40, reps: 5 }, { weightKg: 40 }] }, { equipment: "machine" });
  });
  expect(a.direction).toBe("down");
  expect(a.loadKg).toBeLessThan(40);
});
