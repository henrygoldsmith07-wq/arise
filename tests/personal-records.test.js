import test from "node:test";
import assert from "node:assert/strict";
import {
  REP_BANDS,
  prEvents,
  sessionPrs,
  latestSessionPrs,
  recordsWall,
  recentPrCount,
  filterWall,
  bandLabel,
} from "../src/lib/personalRecords.js";

const LAT = "lat-pulldown";
const CHEST = "chest-press-machine";
const set = (weightKg, reps, extra = {}) => ({ weightKg, reps, completed: true, ...extra });
const session = (id, dateISO, blocks, extra = {}) => ({ id, dateISO, title: id, blocks, ...extra });
const lift = (exerciseId, ...sets) => ({ exerciseId, sets });

test("rep bands are the usual rep-max table", () => {
  assert.deepEqual([...REP_BANDS], [1, 3, 5, 8, 12]);
  assert.equal(bandLabel(1), "1 rep");
  assert.equal(bandLabel(8), "8+ reps");
});

test("the first time a lift is logged is a baseline, not a PR", () => {
  const h = [session("a", "2026-10-01", [lift(LAT, set(40, 10))])];
  assert.deepEqual(prEvents(h), []);
});

test("a heavier set for the same band is a PR; ties and 0.5 kg steps are not", () => {
  const h = [
    session("a", "2026-10-01", [lift(LAT, set(40, 10))]),
    session("b", "2026-10-03", [lift(LAT, set(40, 10))]),
    session("c", "2026-10-05", [lift(LAT, set(40.5, 10))]),
    session("d", "2026-10-08", [lift(LAT, set(42.5, 10))]),
  ];
  const ev = prEvents(h);
  assert.equal(ev.length, REP_BANDS.filter((b) => b <= 10).length);
  assert.ok(ev.every((e) => e.sessionId === "d" && e.kg === 42.5 && e.previousKg === 40.5));
});

test("a heavier set for more reps fills the lower bands too, and one headline is kept per lift", () => {
  const h = [
    session("a", "2026-10-01", [lift(LAT, set(40, 5))]),
    session("b", "2026-10-08", [lift(LAT, set(45, 8))]),
  ];
  const prs = sessionPrs(h, "b");
  assert.equal(prs.length, 1);
  assert.equal(prs[0].band, 5, "bands the lift had before (1, 3, 5) are the ones beaten");
  assert.deepEqual(prs[0].bands, [1, 3, 5]);
  assert.equal(prs[0].kg, 45);
});

test("unlike-for-like sets never make a PR: assisted, technique-noted session, failed, skipped, deleted", () => {
  const base = session("a", "2026-10-01", [lift(LAT, set(40, 8))]);
  const cases = [
    session("b", "2026-10-08", [lift(LAT, set(60, 8, { assistedKg: 10 }))]),
    session("b", "2026-10-08", [lift(LAT, set(60, 8))], { note: "short ROM today, paused reps" }),
    session("b", "2026-10-08", [lift(LAT, set(60, 8, { completed: false }))]),
    session("b", "2026-10-08", [lift(LAT, set(60, 8, { skipped: true }))]),
    session("b", "2026-10-08", [lift(LAT, set(60, 8))], { deletedAt: "2026-10-09T00:00:00Z" }),
  ];
  for (const c of cases) assert.deepEqual(prEvents([base, c]), [], JSON.stringify(c).slice(0, 80));
});

test("a casual note about form does not block a PR", () => {
  const h = [
    session("a", "2026-10-01", [lift(LAT, set(40, 8))]),
    session("b", "2026-10-08", [lift(LAT, set(45, 8))], { note: "good form, felt strong" }),
  ];
  assert.ok(prEvents(h).length > 0);
});

test("deleting the PR session takes the PR (and the wall entry) away", () => {
  const a = session("a", "2026-10-01", [lift(LAT, set(40, 8))]);
  const b = session("b", "2026-10-08", [lift(LAT, set(45, 8))]);
  const todayISO = "2026-10-10";
  assert.equal(recordsWall([a, b], { todayISO })[0].bands[8].kg, 45);
  const gone = { ...b, deletedAt: "2026-10-09T00:00:00Z" };
  assert.equal(recordsWall([a, gone], { todayISO })[0].bands[8].kg, 40);
  assert.equal(recentPrCount([a, gone], { todayISO }), 0);
});

test("a typo-fixed history is re-read: the old inflated set no longer sets the record", () => {
  const typo = session("a", "2026-10-01", [lift(LAT, set(400, 8))]);
  const fixed = session("a", "2026-10-01", [lift(LAT, set(40, 8))]);
  assert.equal(recordsWall([typo], { todayISO: "2026-10-02" })[0].bands[8].kg, 400);
  assert.equal(recordsWall([fixed], { todayISO: "2026-10-02" })[0].bands[8].kg, 40);
});

test("the wall lists band bests, best e1RM, PR count and recency, newest PR first", () => {
  const h = [
    session("a", "2026-09-01", [lift(LAT, set(40, 10)), lift(CHEST, set(30, 10))]),
    session("b", "2026-09-08", [lift(LAT, set(42.5, 10)), lift(CHEST, set(30, 10))]),
    session("c", "2026-10-20", [lift(CHEST, set(35, 10), set(45, 3))]),
  ];
  const rows = recordsWall(h, { todayISO: "2026-10-25" });
  assert.deepEqual(rows.map((r) => r.exerciseId), [CHEST, LAT]);
  const chest = rows[0];
  assert.equal(chest.recent, true);
  assert.equal(chest.bands[3].kg, 45);
  assert.equal(chest.bands[12], undefined, "nothing logged at 12+ reps");
  assert.equal(chest.bestE1rm.kg, 45);
  assert.ok(chest.prCount >= 1);
  const lat = rows[1];
  assert.equal(lat.recent, false);
  assert.equal(lat.bands[8].kg, 42.5);
  assert.equal(lat.bands[8].dateISO, "2026-09-08");
  assert.equal(recentPrCount(h, { todayISO: "2026-10-25" }), 1);
});

test("latestSessionPrs only reports a recent newest session", () => {
  const h = [
    session("a", "2026-10-01", [lift(LAT, set(40, 8))]),
    session("b", "2026-10-08", [lift(LAT, set(45, 8))]),
  ];
  assert.equal(latestSessionPrs(h, { todayISO: "2026-10-09" }).sessionId, "b");
  assert.equal(latestSessionPrs(h, { todayISO: "2026-10-20" }), null);
  assert.equal(latestSessionPrs([], { todayISO: "2026-10-20" }), null);
  const flat = [h[0], session("c", "2026-10-09", [lift(LAT, set(40, 8))])];
  assert.equal(latestSessionPrs(flat, { todayISO: "2026-10-09" }), null);
});

test("string reps like '8-10' use the leading number, and unusable rows are ignored", () => {
  const h = [
    session("a", "2026-10-01", [lift(LAT, set(40, "8-10"))]),
    session("b", "2026-10-08", [lift(LAT, set(45, "8-10"), set("", 5), set(50, 0))]),
    null,
    { id: "x" },
  ];
  const ev = prEvents(h);
  assert.ok(ev.length > 0 && ev.every((e) => e.kg === 45));
});

test("filterWall narrows by name and muscle", () => {
  const h = [session("a", "2026-10-01", [lift(LAT, set(40, 8)), lift(CHEST, set(30, 8))])];
  const rows = recordsWall(h, { todayISO: "2026-10-02" });
  assert.equal(filterWall(rows, { query: "lat" }).length, 1);
  assert.equal(filterWall(rows, { muscle: rows.find((r) => r.exerciseId === CHEST).muscle }).length >= 1, true);
  assert.equal(filterWall(rows, { query: "zzz" }).length, 0);
  assert.equal(filterWall(rows).length, 2);
});
