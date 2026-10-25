import test from "node:test";
import assert from "node:assert/strict";
import {
  suggestWorkingLoad,
  needsWorkingWeight,
  parseRepRange,
  snapDown,
} from "../src/lib/workingWeight.js";

test("parseRepRange reads ranges and singles", () => {
  assert.deepEqual(parseRepRange("8–12"), [8, 12]);
  assert.deepEqual(parseRepRange("10"), [10, 10]);
  assert.deepEqual(parseRepRange(""), [8, 12]);
});

test("machine: 10 reps @ 3 RIR at 30kg suggests a lower-or-equal snapped load", () => {
  const r = suggestWorkingLoad({
    loadKg: 30,
    reps: 10,
    rir: 3,
    targetReps: "8–12",
    equipment: "machine",
  });
  assert.equal(r.ok, true);
  // e1rm = 30*(1+13/30)=43; raw = 43/(1+10/30)=32.25
  assert.ok(r.loadKg <= r.rawKg && r.rawKg - r.loadKg < 2.5 + 1e-9);
  assert.equal(r.loadKg % 2.5, 0);
  assert.equal(r.confidence, "medium");
});

test("never rounds up past the estimate (dumbbells)", () => {
  const r = suggestWorkingLoad({
    loadKg: 13,
    reps: 10,
    rir: 2,
    targetReps: "8–12",
    equipment: "dumbbell",
  });
  assert.equal(r.ok, true);
  assert.ok(r.loadKg <= r.rawKg + 1e-9);
  assert.ok(
    [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22.5, 25, 27.5, 30].includes(r.loadKg),
  );
});

test("unknown RIR is cautious and flagged low confidence", () => {
  const known = suggestWorkingLoad({
    loadKg: 40,
    reps: 10,
    rir: 5,
    equipment: "machine",
  });
  const unknown = suggestWorkingLoad({
    loadKg: 40,
    reps: 10,
    rir: "",
    equipment: "machine",
  });
  assert.ok(unknown.loadKg < known.loadKg);
  assert.equal(unknown.confidence, "low");
  assert.match(unknown.note, /cautious/);
});

test("rejects junk input honestly", () => {
  assert.equal(suggestWorkingLoad({ loadKg: 0, reps: 10 }).ok, false);
  assert.equal(suggestWorkingLoad({ loadKg: 20, reps: 0 }).ok, false);
  assert.equal(suggestWorkingLoad({ loadKg: 20, reps: 2.5 }).ok, false);
});

test("very high rep trials are flagged low confidence", () => {
  const r = suggestWorkingLoad({
    loadKg: 10,
    reps: 20,
    rir: 2,
    equipment: "machine",
  });
  assert.equal(r.confidence, "low");
  assert.match(r.note, /15 reps/);
});

test("snapDown is below raw on barbell", () => {
  const v = snapDown(47.3, { equipment: "barbell" });
  assert.ok(v <= 47.3 && v > 40);
});

test("needsWorkingWeight only for untouched loaded lifts with no history", () => {
  const block = {
    exerciseId: "lat-pulldown",
    sets: [{ reps: "", weightKg: "" }],
  };
  const base = {
    block,
    takesLoad: true,
    history: [],
    recommendation: { load: null },
  };
  assert.equal(needsWorkingWeight(base), true);
  assert.equal(needsWorkingWeight({ ...base, takesLoad: false }), false);
  assert.equal(
    needsWorkingWeight({ ...base, recommendation: { load: 40 } }),
    false,
  );
  assert.equal(
    needsWorkingWeight({
      ...base,
      block: { ...block, sets: [{ reps: "", weightKg: "30" }] },
    }),
    false,
  );
  assert.equal(
    needsWorkingWeight({
      ...base,
      history: [
        { blocks: [{ exerciseId: "lat-pulldown", sets: [{ weightKg: 35 }] }] },
      ],
    }),
    false,
  );
  assert.equal(
    needsWorkingWeight({
      ...base,
      history: [
        { blocks: [{ exerciseId: "other", sets: [{ weightKg: 35 }] }] },
      ],
    }),
    true,
  );
});

import { warmupsFromFoundLoad } from "../src/lib/workingWeight.js";

test("warmupsFromFoundLoad builds a ramp strictly below the found load", () => {
  const r = warmupsFromFoundLoad({
    exerciseId: "chest-press",
    loadKg: 40,
    targetReps: "8–12",
  });
  assert.ok(r.length >= 2);
  assert.ok(r.every((w) => Number(w.weightKg) < 40));
  const ws = r.map((w) => Number(w.weightKg));
  assert.deepEqual(
    ws,
    [...ws].sort((a, b) => a - b),
  );
});

test("warmupsFromFoundLoad gives no ramp for zero, blank or bad loads", () => {
  for (const loadKg of [0, "", null, "abc", -5]) {
    assert.deepEqual(
      warmupsFromFoundLoad({ exerciseId: "x", loadKg, targetReps: "8" }),
      [],
    );
  }
});
