import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseBodyweightKg,
  liveBodyweights,
  upsertBodyweight,
  removeBodyweight,
  bodyweightOn,
  bodyweightAsOf,
  mergeBodyweightLogs,
  bodyweightTrend,
  bodyweightSparkline,
  isBodyweightLift,
  effectiveLoadKg,
  relativeStrength,
} from "../src/lib/bodyweightLog.js";
import { mergeStoresWithConflicts } from "../src/lib/sync.js";
import { mergeStores } from "../src/lib/export.js";
import { reconcileStoreSnapshots } from "../src/lib/storeReconcile.js";
import { IMPORT_ALLOW_KEYS } from "../src/lib/exportPolicy.js";
import { repairStore } from "../src/lib/integrity.js";

const T = "2026-10-01T10:00:00.000Z";
const log = (...pairs) =>
  pairs.reduce(
    (acc, [d, kg]) => upsertBodyweight(acc, { dateISO: d, kg, nowISO: T }),
    [],
  );
const sess = (dateISO, exerciseId, sets) => ({
  id: `${dateISO}-${exerciseId}`,
  dateISO,
  blocks: [{ exerciseId, sets }],
});

describe("bodyweight log", () => {
  it("parses kg text and rejects impossible values", () => {
    assert.equal(parseBodyweightKg("62,45"), 62.5);
    assert.equal(parseBodyweightKg(" 70 "), 70);
    assert.equal(parseBodyweightKg("5"), null);
    assert.equal(parseBodyweightKg("900"), null);
    assert.equal(parseBodyweightKg(""), null);
    assert.equal(parseBodyweightKg(null), null);
    assert.equal(parseBodyweightKg("abc"), null);
  });

  it("keeps one row per day and ignores unusable input", () => {
    let l = upsertBodyweight([], {
      dateISO: "2026-10-01",
      kg: "70",
      nowISO: T,
    });
    l = upsertBodyweight(l, { dateISO: "2026-10-01", kg: "70.4", nowISO: T });
    assert.equal(l.length, 1);
    assert.equal(bodyweightOn(l, "2026-10-01").kg, 70.4);
    assert.equal(upsertBodyweight(l, { dateISO: "2026-10-02", kg: "5" }), l);
    assert.equal(upsertBodyweight(l, { dateISO: "nope", kg: "70" }), l);
  });

  it("removal leaves a tombstone that survives a merge with the older copy", () => {
    const base = log(["2026-10-01", 70]);
    const removed = removeBodyweight(
      base,
      "2026-10-01",
      "2026-10-02T00:00:00.000Z",
    );
    assert.deepEqual(liveBodyweights(removed), []);
    assert.equal(removed.length, 1);
    assert.deepEqual(liveBodyweights(mergeBodyweightLogs(removed, base)), []);
    assert.deepEqual(liveBodyweights(mergeBodyweightLogs(base, removed)), []);
  });

  it("merge keeps the newest edit per day and is order independent", () => {
    const a = [
      { dateISO: "2026-10-01", kg: 70, updatedAt: "2026-10-01T08:00:00.000Z" },
    ];
    const b = [
      { dateISO: "2026-10-01", kg: 71, updatedAt: "2026-10-01T09:00:00.000Z" },
      { dateISO: "2026-10-02", kg: 70.5, updatedAt: T },
    ];
    const ab = mergeBodyweightLogs(a, b),
      ba = mergeBodyweightLogs(b, a);
    assert.deepEqual(ab, ba);
    assert.equal(bodyweightOn(ab, "2026-10-01").kg, 71);
    assert.equal(ab.length, 2);
    const tieA = [{ dateISO: "2026-10-03", kg: 70, updatedAt: T }],
      tieB = [{ dateISO: "2026-10-03", kg: 72, updatedAt: T }];
    assert.deepEqual(
      mergeBodyweightLogs(tieA, tieB),
      mergeBodyweightLogs(tieB, tieA),
    );
  });

  it("asOf uses the latest weigh-in on or before the day, else the earliest", () => {
    const l = log(["2026-10-05", 70], ["2026-10-12", 71]);
    assert.equal(bodyweightAsOf(l, "2026-10-10").kg, 70);
    assert.equal(bodyweightAsOf(l, "2026-10-12").kg, 71);
    assert.equal(bodyweightAsOf(l, "2026-09-01").kg, 70);
    assert.equal(bodyweightAsOf([], "2026-09-01"), null);
  });

  it("trend compares week averages and refuses to guess early", () => {
    assert.equal(bodyweightTrend([], "2026-10-29").direction, "none");
    assert.equal(
      bodyweightTrend(log(["2026-10-28", 70], ["2026-10-29", 71]), "2026-10-29")
        .direction,
      "early",
    );
    const up = log(
      ["2026-10-02", 70],
      ["2026-10-04", 70.2],
      ["2026-10-27", 72],
      ["2026-10-29", 72.2],
    );
    const t = bodyweightTrend(up, "2026-10-29");
    assert.equal(t.direction, "up");
    assert.equal(t.changeKg, 2);
    assert.equal(t.latest.kg, 72.2);
    const flat = log(["2026-10-02", 70], ["2026-10-29", 70.3]);
    assert.equal(bodyweightTrend(flat, "2026-10-29").direction, "steady");
    const down = log(["2026-10-02", 72], ["2026-10-29", 70.5]);
    assert.equal(bodyweightTrend(down, "2026-10-29").direction, "down");
  });

  it("sparkline needs two weigh-ins", () => {
    assert.equal(bodyweightSparkline(log(["2026-10-01", 70])), null);
    assert.match(
      bodyweightSparkline(log(["2026-10-01", 70], ["2026-10-02", 71])),
      /^\d/,
    );
  });

  it("knows which lifts move your body", () => {
    for (const id of [
      "pull-up",
      "chin-up",
      "weighted-pull-up",
      "assisted-pull-up",
      "assisted-chin-up",
      "neutral-grip-pull-up",
      "dip",
      "chest-dip",
      "weighted-dip",
      "assisted-dip",
    ])
      assert.equal(isBodyweightLift(id), true, id);
    for (const id of [
      "lat-pulldown",
      "machine-dip",
      "tricep-dip-bench",
      "chair-dip",
      "scapular-pull-up",
      "negative-pull-up",
      "bench-press",
    ])
      assert.equal(isBodyweightLift(id), false, id);
  });

  it("effective load: body + added − assistance on bodyweight lifts", () => {
    assert.equal(effectiveLoadKg("pull-up", { weightKg: "10" }, 70), 80);
    assert.equal(
      effectiveLoadKg(
        "assisted-pull-up",
        { weightKg: "", assistedKg: "25" },
        70,
      ),
      45,
    );
    assert.equal(
      effectiveLoadKg("assisted-pull-up", { assistedKg: "90" }, 70),
      null,
    );
    assert.equal(effectiveLoadKg("pull-up", { weightKg: "" }, null), null);
    assert.equal(effectiveLoadKg("lat-pulldown", { weightKg: "45" }, 70), 45);
    assert.equal(effectiveLoadKg("lat-pulldown", { weightKg: "" }, 70), null);
  });

  it("relative strength shows a heavier lifter who did not really get stronger", () => {
    const l = log(["2026-08-20", 60], ["2026-10-25", 66]);
    const history = [
      sess("2026-08-20", "machine-chest-press", [
        { reps: "10", weightKg: "40" },
      ]),
      sess("2026-10-25", "machine-chest-press", [
        { reps: "10", weightKg: "44" },
      ]),
    ];
    const [row] = relativeStrength(history, l, "2026-10-28");
    assert.equal(row.exerciseId, "machine-chest-press");
    assert.ok(row.e1rmChangeKg > 0, "absolute e1RM went up");
    assert.equal(row.bodyChangeKg, 6);
    assert.equal(row.verdict, "flat");
    assert.equal(row.beforeRatio, 0.89);
    assert.equal(row.ratio, 0.89);
  });

  it("puts an assisted and a weighted pull-up on the same scale", () => {
    const l = log(["2026-08-20", 70], ["2026-10-25", 70]);
    const history = [
      sess("2026-08-20", "assisted-pull-up", [
        { reps: "5", weightKg: "", assistedKg: "30" },
      ]),
      sess("2026-10-25", "pull-up", [{ reps: "5", weightKg: "" }]),
    ];
    const rows = relativeStrength(history, l, "2026-10-28");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].exerciseId, "pull-up");
    assert.equal(rows[0].bodyweightLift, true);
    assert.equal(rows[0].ratio, 1.17);
  });

  it("returns nothing without a log, orders by recent frequency", () => {
    const history = [
      sess("2026-10-25", "machine-row", [{ reps: "10", weightKg: "40" }]),
    ];
    assert.deepEqual(relativeStrength(history, [], "2026-10-28"), []);
    const l = log(["2026-10-20", 65]);
    const h2 = [
      sess("2026-10-20", "machine-row", [{ reps: "10", weightKg: "40" }]),
      sess("2026-10-22", "machine-row", [{ reps: "10", weightKg: "40" }]),
      sess("2026-10-22", "cable-curl", [{ reps: "10", weightKg: "60" }]),
    ];
    const rows = relativeStrength(h2, l, "2026-10-28");
    assert.equal(rows[0].exerciseId, "machine-row");
    assert.equal(rows[0].verdict, "new");
  });
});

describe("bodyweight log across the store", () => {
  it("is importable, defaulted by integrity, merged by sync and three-way reconcile", () => {
    assert.ok(IMPORT_ALLOW_KEYS.includes("bodyweightLog"));
    assert.deepEqual(repairStore({ version: 1 }).bodyweightLog, []);
    const cur = { bodyweightLog: log(["2026-10-01", 70]) };
    const imp = { bodyweightLog: log(["2026-10-02", 71]) };
    assert.equal(mergeStores(cur, imp).bodyweightLog.length, 2);
    assert.equal(mergeStoresWithConflicts(cur, imp).bodyweightLog.length, 2);
    const merged = reconcileStoreSnapshots({ bodyweightLog: [] }, cur, imp);
    assert.equal(merged.bodyweightLog.length, 2);
  });
});
