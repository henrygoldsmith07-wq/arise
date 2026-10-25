import test from "node:test";
import assert from "node:assert/strict";
import { coarseJumpChip } from "../src/lib/sessionRunnerModel.js";
import { recommendNext } from "../src/lib/progression.js";

const h = [
  {
    dateISO: "2026-10-01",
    blocks: [
      {
        exerciseId: "lat-pulldown",
        sets: [{ weightKg: 20, reps: 12, rpe: 8 }],
      },
    ],
  },
];
const rec = (inc) =>
  recommendNext({
    exerciseId: "lat-pulldown",
    history: h,
    targetReps: "8–12",
    asOfDateISO: "2026-10-06",
    plateConfig: {
      machineIncrementKg: inc,
      machineMinKg: inc,
      machineMaxKg: 100,
    },
  });

test("coarse stack produces a chip naming the held load and rep ceiling", () => {
  const chip = coarseJumpChip(rec(5));
  assert.match(chip.label, /Stay at 20 kg — add reps up to 15/);
  assert.match(chip.detail, /\+5 kg/);
});
test("ordinary or missing recommendations produce no chip", () => {
  assert.equal(coarseJumpChip(rec(1)), null);
  assert.equal(coarseJumpChip(null), null);
  assert.equal(coarseJumpChip({ load: 20, coarseJump: { jumpKg: 5 } }), null);
});
test("formatter is used so lb users see lb", () => {
  const chip = coarseJumpChip(rec(5), (kg) => `${kg * 2} lb`);
  assert.match(chip.label, /Stay at 40 lb/);
});
