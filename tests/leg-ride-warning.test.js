import test from "node:test";
import assert from "node:assert/strict";
import { legRideWarning, withoutLegBlocks } from "../src/lib/rideAwareSchedule.js";
import { EXERCISES } from "../src/lib/data.js";

const leg = EXERCISES.find(e => e.muscle === "Legs");
const up = EXERCISES.find(e => e.muscle === "Back" || e.muscle === "Chest");
const session = { blocks: [{ exerciseId: up.id }, { exerciseId: leg.id }] };

test("warns the day before a key ride", () => {
  // 2026-10-30 is Friday; Saturday (6) is a ride
  const w = legRideWarning(session, "2026-10-30", [6]);
  assert.equal(w.clash, "day-before");
  assert.equal(w.legExercises.length, 1);
  assert.match(w.message, /day before/);
});
test("warns on ride day, silent when clear or no legs", () => {
  assert.equal(legRideWarning(session, "2026-10-31", [6]).clash, "ride-day");
  assert.equal(legRideWarning(session, "2026-10-28", [6]), null);
  assert.equal(legRideWarning({ blocks: [{ exerciseId: up.id }] }, "2026-10-30", [6]), null);
  assert.equal(legRideWarning(session, "2026-10-30", []), null);
});
test("withoutLegBlocks strips legs but never empties", () => {
  assert.equal(withoutLegBlocks(session).blocks.length, 1);
  const only = { blocks: [{ exerciseId: leg.id }] };
  assert.equal(withoutLegBlocks(only), only);
});
