import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNoteIndex,
  searchNotes,
  queryWords,
} from "../src/lib/noteSearch.js";

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
    date: "2026-10-10",
    name: "Upper B",
    note: "Felt strong · great pump",
    noteTags: ["felt-strong"],
  },
  { id: "c", date: "2026-10-20", name: "Pull", note: "Imported from Hevy CSV" },
  {
    id: "d",
    date: "2026-10-25",
    name: "Chest",
    note: "Pain / discomfort",
    noteTags: ["pain-discomfort"],
  },
  {
    id: "e",
    date: "2026-10-26",
    name: "Gone",
    note: "shoulder",
    deleted: true,
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
    ["d", "setup-chest-press", "b", "a"],
  );
});
test("chip text is not duplicated in the note body", () => {
  assert.equal(idx.find((e) => e.id === "b").text, "great pump");
  assert.equal(idx.find((e) => e.id === "d").text, "");
});
test("word-start AND matching", () => {
  assert.deepEqual(
    searchNotes(idx, { query: "shoul" }).map((e) => e.id),
    ["a"],
  );
  assert.deepEqual(searchNotes(idx, { query: "ump" }), []);
  assert.deepEqual(
    searchNotes(idx, { query: "left press" }).map((e) => e.id),
    ["a"],
  );
  assert.deepEqual(
    searchNotes(idx, { query: "strap seat" }).map((e) => e.id),
    ["setup-chest-press"],
  );
});
test("kind and tag filters combine with the query", () => {
  assert.equal(searchNotes(idx, { kind: "setup" }).length, 1);
  assert.deepEqual(
    searchNotes(idx, { tag: "pain-discomfort" }).map((e) => e.id),
    ["d", "a"],
  );
  assert.deepEqual(
    searchNotes(idx, { tag: "pain-discomfort", query: "left" }).map(
      (e) => e.id,
    ),
    ["a"],
  );
});
