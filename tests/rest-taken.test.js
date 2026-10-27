import test from "node:test";
import assert from "node:assert/strict";
import { restTakenByExercise } from "../src/lib/analytics.js";

const mk = (gaps, restSec = 120) => {
  let t = 1e12;
  const sets = [{ completed: true, doneAtMs: t }];
  for (const g of gaps) {
    t += g * 1000;
    sets.push({ completed: true, doneAtMs: t });
  }
  return { blocks: [{ exerciseId: "lat-pulldown", restSec, sets }] };
};

test("flags median rest under 60% of prescribed", () => {
  const r = restTakenByExercise([mk([50, 55, 60, 45])]);
  assert.equal(r[0].medianSec, 53);
  assert.equal(r[0].tooShort, true);
  assert.equal(r[0].prescribedSec, 120);
});
test("does not flag adequate rest or too few gaps; ignores noise gaps", () => {
  assert.equal(
    restTakenByExercise([mk([110, 120, 130, 100])])[0].tooShort,
    false,
  );
  assert.equal(restTakenByExercise([mk([50, 50])])[0].tooShort, false);
  assert.equal(restTakenByExercise([mk([3, 2000])]).length, 0);
});
test("legacy blocks without stamps are ignored", () => {
  assert.deepEqual(
    restTakenByExercise([
      {
        blocks: [
          {
            exerciseId: "x",
            restSec: 90,
            sets: [{ completed: true }, { completed: true }],
          },
        ],
      },
    ]),
    [],
  );
});
