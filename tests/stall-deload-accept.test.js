import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  acceptDeloadTarget,
  clearDeloadTarget,
  activeDeloadTarget,
  applyDeloadTarget,
} from "../src/lib/stallDeload.js";
import { buildRunnerRecommendationMeta } from "../src/lib/runnerRecommendations.js";

const sug = { stalled: true, sessions: 3, fromKg: 55, loadKg: 50, reps: 8 };
const sess = (d) => ({
  id: d,
  dateISO: d,
  blocks: [{ exerciseId: "chest-press", sets: [{ reps: 8, weightKg: 55 }] }],
});

describe("accepted deload target", () => {
  it("stores one pin per lift and ignores non-stalled suggestions", () => {
    const p = acceptDeloadTarget(
      { restPresets: { a: 60 } },
      "chest-press",
      sug,
      "2026-10-24T10:00:00Z",
    );
    assert.equal(p.deloadTargets["chest-press"].loadKg, 50);
    assert.equal(p.restPresets.a, 60);
    assert.deepEqual(acceptDeloadTarget(p, "x", { stalled: false }, "t"), p);
    assert.equal(
      clearDeloadTarget(p, "chest-press").deloadTargets["chest-press"],
      undefined,
    );
  });
  it("overrides the recommendation until the lift is next logged", () => {
    const p = acceptDeloadTarget(
      {},
      "chest-press",
      sug,
      "2026-10-24T10:00:00Z",
    );
    const rec = { load: 55, reps: 8, reason: "x" };
    const hist = [sess("2026-10-20")];
    const out = applyDeloadTarget(rec, p.deloadTargets, "chest-press", hist);
    assert.equal(out.load, 50);
    assert.equal(out.deload, true);
    const spent = [...hist, sess("2026-10-26")];
    assert.equal(
      activeDeloadTarget(p.deloadTargets, "chest-press", spent),
      null,
    );
    assert.equal(
      applyDeloadTarget(rec, p.deloadTargets, "chest-press", spent),
      rec,
    );
  });
  it("runner meta shows the accepted target for that lift only", () => {
    const p = acceptDeloadTarget(
      {},
      "chest-press",
      sug,
      "2026-10-24T10:00:00Z",
    );
    const blocks = [{ exerciseId: "chest-press", sets: 3, reps: "8–12" }];
    const on = buildRunnerRecommendationMeta({
      blocks,
      history: [sess("2026-10-20")],
      dateISO: "2026-10-27",
      deloadTargets: p.deloadTargets,
    });
    assert.equal(on.recs.get("chest-press").load, 50);
    const off = buildRunnerRecommendationMeta({
      blocks,
      history: [sess("2026-10-20")],
      dateISO: "2026-10-27",
    });
    assert.notEqual(off.recs.get("chest-press")?.deload, true);
  });
});
