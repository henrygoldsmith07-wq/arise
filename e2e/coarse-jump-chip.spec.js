import { test, expect } from "@playwright/test";

test("coarse-stack lift shows a stay-and-add-reps chip in the runner", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const m = await import("/src/lib/sessionRunnerModel.js");
    window.__chip = m.coarseJumpChip({
      load: 20,
      coarseJump: { jumpKg: 5, jumpPct: 25, ceiling: 15 },
    });
  });
  const chip = await page.evaluate(() => window.__chip);
  expect(chip.label).toContain("Stay at 20 kg");
});
