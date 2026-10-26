import { test, expect } from "@playwright/test";

test("extra-set advice fires only when every set topped the range with spare reps", async ({ page }) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const m = await import("/src/lib/gymMode.js");
    const d = (reps, rir) => ({ completed: true, reps, rir });
    return {
      easy: !!m.extraSetAdvice({ reps: "8-12", sets: [d(12, 3), d(12, 3)] }),
      hard: !!m.extraSetAdvice({ reps: "8-12", sets: [d(12, 3), d(12, 1)] }),
    };
  });
  expect(r).toEqual({ easy: true, hard: false });
});
