import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stallDeloadSuggestion } from "../src/lib/stallDeload.js";

const S = (i, kg, reps = 8) => ({
  id: `s${i}`,
  dateISO: `2026-09-${String(10 + i).padStart(2, "0")}`,
  blocks: [{ exerciseId: "chest-press", sets: [{ reps, weightKg: kg }] }],
});

describe("stallDeloadSuggestion", () => {
  it("flags three sessions with no e1RM gain and proposes ~10% less", () => {
    const r = stallDeloadSuggestion(
      [S(1, 50), S(2, 55), S(3, 55), S(4, 55), S(5, 55)],
      "chest-press",
    );
    assert.equal(r.stalled, true);
    assert.equal(r.reps, 8);
    assert.ok(r.loadKg < 55 && r.loadKg >= 48, String(r.loadKg));
  });
  it("does not flag a lift that is still progressing", () => {
    assert.equal(
      stallDeloadSuggestion(
        [S(1, 50), S(2, 52.5), S(3, 55), S(4, 57.5)],
        "chest-press",
      ).stalled,
      false,
    );
  });
  it("needs more than the window of history", () => {
    assert.equal(
      stallDeloadSuggestion([S(1, 50), S(2, 50), S(3, 50)], "chest-press")
        .reason,
      "not-enough-history",
    );
  });
  it("ignores other exercises", () => {
    assert.equal(
      stallDeloadSuggestion([S(1, 50), S(2, 50), S(3, 50), S(4, 50)], "row")
        .stalled,
      false,
    );
  });
});
