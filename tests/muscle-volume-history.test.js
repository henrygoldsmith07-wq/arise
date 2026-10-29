import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isHardSet,
  hardSetsIn,
  weeklyMuscleVolume,
  volumeStatus,
  musclesInWindow,
  underTrainedLastWeek,
  VOLUME_WEEKS,
} from "../src/lib/muscleVolumeHistory.js";

const CHEST = "chest-press-machine";
const ROW = "machine-row";
const sets = (n, extra = {}) =>
  Array.from({ length: n }, () => ({
    reps: "10",
    weightKg: "40",
    completed: true,
    ...extra,
  }));
const block = (exerciseId, n, extra) => ({ exerciseId, sets: sets(n, extra) });
let seq = 0;
const entry = (dateISO, blocks, extra = {}) => ({
  id: `h${++seq}`,
  dateISO,
  title: `S ${dateISO}`,
  blocks,
  ...extra,
});
// Thu 29 Oct 2026: week starts Mon 26 Oct.
const TODAY = "2026-10-29";

describe("isHardSet / hardSetsIn", () => {
  it("counts finished sets and drops skipped, undone, empty and easy (RPE < 5) ones", () => {
    assert.equal(
      isHardSet({ reps: "8", weightKg: "50", completed: true }),
      true,
    );
    assert.equal(
      isHardSet({ reps: "8", weightKg: "50", skipped: true }),
      false,
    );
    assert.equal(
      isHardSet({ reps: "8", weightKg: "50", completed: false }),
      false,
    );
    assert.equal(isHardSet({ reps: "", weightKg: "" }), false);
    assert.equal(isHardSet({ reps: "10", weightKg: "20", rpe: 3 }), false);
    assert.equal(isHardSet({ reps: "10", weightKg: "20", rpe: "" }), true);
    assert.equal(isHardSet({ reps: "10", weightKg: "20", rpe: 5 }), true);
    assert.equal(isHardSet({ reps: "6", assistedKg: "20" }), true);
    assert.equal(isHardSet(null), false);
  });

  it("credits the exercise main muscle only, and ignores cardio, core and unknown ids", () => {
    assert.deepEqual(hardSetsIn(block(CHEST, 3)), { muscle: "Chest", sets: 3 });
    assert.deepEqual(hardSetsIn(block("plank", 3)), { muscle: null, sets: 0 });
    assert.deepEqual(hardSetsIn(block("no-such-lift", 3)), {
      muscle: null,
      sets: 0,
    });
    assert.deepEqual(hardSetsIn({ exerciseId: CHEST }), {
      muscle: "Chest",
      sets: 0,
    });
  });
});

describe("weeklyMuscleVolume", () => {
  it("returns every week (oldest first, current last) even when empty", () => {
    const rows = weeklyMuscleVolume([], { todayISO: TODAY });
    assert.equal(rows.length, VOLUME_WEEKS);
    assert.equal(rows[rows.length - 1].weekISO, "2026-10-26");
    assert.equal(rows[0].weekISO, "2026-09-07");
    assert.equal(rows.filter((r) => r.current).length, 1);
    assert.ok(rows.every((r) => r.total === 0));
  });

  it("adds sets per muscle per Monday-start week and lists the sessions", () => {
    const history = [
      entry("2026-10-26", [block(CHEST, 4), block(ROW, 3)]),
      entry("2026-10-28", [block(CHEST, 2)]),
      entry("2026-10-25", [block(ROW, 5)]), // Sunday: previous week
    ];
    const rows = weeklyMuscleVolume(history, { todayISO: TODAY });
    const cur = rows[rows.length - 1],
      prev = rows[rows.length - 2];
    assert.deepEqual(cur.byMuscle, { Chest: 6, Back: 3 });
    assert.equal(cur.total, 9);
    assert.deepEqual(
      cur.sessions.map((s) => [s.dateISO, s.sets]),
      [
        ["2026-10-26", 7],
        ["2026-10-28", 2],
      ],
    );
    assert.deepEqual(prev.byMuscle, { Back: 5 });
  });

  it("ignores deleted sessions, malformed rows and dates outside the window", () => {
    const history = [
      entry("2026-10-27", [block(CHEST, 4)], {
        deletedAt: "2026-10-28T00:00:00Z",
      }),
      { id: "x", dateISO: "not-a-date", blocks: [block(CHEST, 4)] },
      entry("2025-01-01", [block(CHEST, 9)]),
      null,
      entry("2026-10-27", [block(CHEST, 1, { rpe: 2 })]),
    ];
    const rows = weeklyMuscleVolume(history, { todayISO: TODAY });
    assert.ok(rows.every((r) => r.total === 0));
    assert.deepEqual(weeklyMuscleVolume(history, { todayISO: "nope" }), []);
  });

  it("honours a custom window and flags deload weeks from the schedule", () => {
    const schedule = {
      mesocycle: null,
      blockPlan: { deload: { 2: true } },
      sessions: [
        { id: "a", week: 1, dateISO: "2026-10-19", blocks: [] },
        { id: "b", week: 2, dateISO: "2026-10-26", blocks: [] },
      ],
    };
    const rows = weeklyMuscleVolume([], {
      todayISO: TODAY,
      weeks: 3,
      schedule,
    });
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => r.deload),
      [false, false, true],
    );
  });
});

describe("summaries", () => {
  const rows = weeklyMuscleVolume(
    [
      entry("2026-10-19", [block(CHEST, 10), block(ROW, 4)]),
      entry("2026-10-12", [block(CHEST, 6)]),
      entry("2026-10-27", [block(ROW, 3)]),
    ],
    { todayISO: TODAY },
  );

  it("classes weekly sets against the 6–20 guide, leaving unguided muscles alone", () => {
    assert.equal(volumeStatus("Chest", 5), "under");
    assert.equal(volumeStatus("Chest", 6), "ok");
    assert.equal(volumeStatus("Chest", 20), "ok");
    assert.equal(volumeStatus("Chest", 21), "high");
    assert.equal(volumeStatus("Full body", 3), "none");
  });

  it("orders muscles by total", () => {
    assert.deepEqual(musclesInWindow(rows), ["Chest", "Back"]);
  });
});

describe("underTrainedLastWeek", () => {
  const trained = [
    entry("2026-10-05", [block(CHEST, 8), block(ROW, 8)]),
    entry("2026-10-12", [block(CHEST, 8), block(ROW, 8)]),
    entry("2026-10-14", [block(ROW, 2)]),
  ];

  it("nudges for a muscle trained recently that fell below the guide last week", () => {
    const history = [
      ...trained,
      entry("2026-10-19", [block(CHEST, 3), block(ROW, 8)]),
      entry("2026-10-21", [block(ROW, 3)]),
    ];
    assert.deepEqual(underTrainedLastWeek(history, { todayISO: TODAY }), [
      { muscle: "Chest", sets: 3 },
    ]);
  });

  it("stays quiet after a light week (fewer than two sessions) and for muscles never trained", () => {
    const light = [...trained, entry("2026-10-19", [block(ROW, 8)])];
    assert.deepEqual(underTrainedLastWeek(light, { todayISO: TODAY }), []);
    const noChest = [
      entry("2026-10-12", [block(ROW, 8)]),
      entry("2026-10-19", [block(ROW, 8)]),
      entry("2026-10-21", [block(ROW, 8)]),
    ];
    assert.deepEqual(underTrainedLastWeek(noChest, { todayISO: TODAY }), []);
  });

  it("never nags about legs, and skips a deload week", () => {
    const legs = [
      entry("2026-10-05", [block("leg-press", 10)]),
      entry("2026-10-19", [block("leg-press", 1)]),
      entry("2026-10-21", [block("leg-press", 1)]),
    ];
    assert.deepEqual(underTrainedLastWeek(legs, { todayISO: TODAY }), []);
    const schedule = {
      blockPlan: { deload: { 3: true } },
      sessions: [{ id: "s", week: 3, dateISO: "2026-10-19", blocks: [] }],
    };
    const history = [
      ...trained,
      entry("2026-10-19", [block(CHEST, 2), block(ROW, 8)]),
      entry("2026-10-21", [block(CHEST, 1)]),
    ];
    assert.equal(underTrainedLastWeek(history, { todayISO: TODAY }).length, 1);
    assert.deepEqual(
      underTrainedLastWeek(history, { todayISO: TODAY, schedule }),
      [],
    );
  });
});
