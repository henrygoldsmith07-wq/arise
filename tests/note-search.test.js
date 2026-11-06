import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNoteIndex,
  searchNotes,
  queryWords,
} from "../src/lib/noteSearch.js";
import { buildGuidedPayload } from "../src/lib/guidedMode.js";

// Saved sessions use dateISO/title (sessionRunnerModel, guidedMode); "a" keeps
// the older date/name shape to cover both.
const history = [
  {
    id: "a",
    date: "2026-09-01",
    name: "Upper A",
    note: "Left shoulder twinge on press",
    noteTags: ["pain-discomfort"],
  },
  {
    id: "b",
    dateISO: "2026-10-10",
    title: "Upper B",
    note: "Felt strong · great pump",
    noteTags: ["felt-strong"],
  },
  { id: "c", dateISO: "2026-10-20", title: "Pull", note: "Imported from Hevy CSV" },
  {
    id: "d",
    dateISO: "2026-10-25",
    title: "Chest",
    note: "Pain / discomfort",
    noteTags: ["pain-discomfort"],
  },
  {
    id: "e",
    dateISO: "2026-10-26",
    title: "Gone",
    note: "shoulder",
    deletedAt: "2026-10-27T10:00:00Z",
  },
];
const setup = {
  "chest-press": {
    seat: "4",
    note: "strap on pad",
    updatedAt: "2026-10-12T10:00:00Z",
  },
  row: { updatedAt: "2026-10-01T00:00:00Z" },
};
const idx = buildNoteIndex(history, setup, (id) =>
  id === "chest-press" ? "Chest press" : id,
);

test("index skips imports, deleted sessions and tombstoned setups; newest first", () => {
  assert.deepEqual(
    idx.map((e) => e.id),
    ["session-d", "setup-chest-press", "session-b", "session-a"],
  );
});
test("chip text is not duplicated in the note body", () => {
  assert.equal(idx.find((e) => e.sessionId === "b").text, "great pump");
  assert.equal(idx.find((e) => e.sessionId === "d").text, "");
});
test("word-start AND matching", () => {
  assert.deepEqual(
    searchNotes(idx, { query: "shoul" }).map((e) => e.sessionId ?? e.id),
    ["a"],
  );
  assert.deepEqual(searchNotes(idx, { query: "ump" }), []);
  assert.deepEqual(
    searchNotes(idx, { query: "left press" }).map((e) => e.sessionId ?? e.id),
    ["a"],
  );
  assert.deepEqual(
    searchNotes(idx, { query: "strap seat" }).map((e) => e.sessionId ?? e.id),
    ["setup-chest-press"],
  );
});
test("kind and tag filters combine with the query", () => {
  assert.equal(searchNotes(idx, { kind: "setup" }).length, 1);
  assert.deepEqual(
    searchNotes(idx, { tag: "pain-discomfort" }).map((e) => e.sessionId ?? e.id),
    ["d", "a"],
  );
  assert.deepEqual(
    searchNotes(idx, { tag: "pain-discomfort", query: "left" }).map(
      (e) => e.sessionId,
    ),
    ["a"],
  );
});

test("saved sessions show their dateISO and title", () => {
  const b = idx.find((e) => e.sessionId === "b");
  assert.equal(b.date, "2026-10-10");
  assert.equal(b.title, "Upper B");
  assert.deepEqual(
    searchNotes(idx, { query: "upper b" }).map((e) => e.sessionId),
    ["b"],
  );
});
test("same-day entries list the later-logged one first", () => {
  const i = buildNoteIndex([
    { id: "x", dateISO: "2026-10-01", note: "am" },
    { id: "y", dateISO: "2026-10-01", note: "pm" },
  ]);
  assert.deepEqual(
    i.map((e) => e.sessionId),
    ["y", "x"],
  );
});
test("doubled chip prefix from older Guided saves is stripped", () => {
  const [e] = buildNoteIndex([
    {
      id: "g",
      dateISO: "2026-10-02",
      note: "Felt strong · Felt strong · quick one",
      noteTags: ["felt-strong"],
    },
  ]);
  assert.equal(e.text, "quick one");
});
test("accents, curly apostrophes and non-Latin words match", () => {
  const i = buildNoteIndex([
    { id: "u", dateISO: "2026-10-03", note: "Épaule gauche, didn’t brace" },
    { id: "v", dateISO: "2026-10-04", note: "плечо болит" },
  ]);
  const ids = (query) => searchNotes(i, { query }).map((e) => e.sessionId);
  assert.deepEqual(ids("epaule"), ["u"]);
  assert.deepEqual(ids("didn't"), ["u"]);
  assert.deepEqual(ids("плеч"), ["v"]);
  assert.deepEqual(ids("лечо"), []);
  assert.deepEqual(queryWords("'shoulder'"), ["shoulder"]);
});
test("a real saved Guided session indexes with its date, title and note", () => {
  const payload = buildGuidedPayload({
    session: { id: "s1", dateISO: "2026-10-05", programId: "p", title: "Upper", blocks: [] },
    blocks: [
      {
        exerciseId: "chest-press-machine",
        reps: "8-10",
        restSec: 90,
        sets: [{ reps: "10", weightKg: "40", completed: true }],
      },
    ],
    note: "seat felt low",
    noteTags: ["felt-strong"],
    startedAtISO: "2026-10-05T10:00:00.000Z",
    nowISO: "2026-10-05T10:40:00.000Z",
    performedDateISO: "2026-10-05",
  });
  const [e] = buildNoteIndex([payload]);
  assert.equal(e.date, "2026-10-05");
  assert.equal(e.title, "Upper");
  assert.equal(e.text, "seat felt low");
  assert.deepEqual(e.tags, ["felt-strong"]);
});
