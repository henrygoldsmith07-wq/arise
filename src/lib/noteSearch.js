// noteSearch.js — one searchable journal over everything a lifter wrote down:
// session notes (free text + tag chips) and per-lift setup notes. Pure; the
// data never leaves the device. Matching is case- and accent-insensitive
// ("epaule" finds "épaule"), every typed word must appear (AND), and a word
// matches at a word start so "shoul" finds "left shoulder" but "ear" does not
// find "heart".
import { NOTE_PROMPTS } from "./sessionNotes.js";

const TAG_LABEL = Object.fromEntries(NOTE_PROMPTS.map((p) => [p.id, p.label]));
export const TAG_FILTERS = NOTE_PROMPTS.map((p) => ({
  id: p.id,
  label: p.label,
}));

function norm(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words of a query; punctuation-only input gives []. */
export function queryWords(q) {
  return norm(q)
    .split(/[^\p{L}\p{N}°']+/u)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
function wordStartMatch(hay, word) {
  let i = hay.indexOf(word);
  while (i !== -1) {
    if (i === 0 || !WORD_CHAR.test(hay[i - 1])) return true;
    i = hay.indexOf(word, i + 1);
  }
  return false;
}

/**
 * Build the index. Sessions: any history item with a note or tags (the tag
 * chips are stripped from the stored note string so they are not shown twice;
 * older Guided saves stored them twice, so every leading copy goes).
 * Setup notes: any non-tombstone entry. Newest first; on the same date the
 * later entry (history is oldest-first) comes first.
 */
export function buildNoteIndex(
  history = [],
  setupNotes = {},
  nameOf = (id) => id,
) {
  const out = [];
  for (const h of Array.isArray(history) ? history : []) {
    if (!h || typeof h !== "object" || h.deletedAt) continue;
    const tags = (Array.isArray(h.noteTags) ? h.noteTags : []).filter(
      (t) => TAG_LABEL[t],
    );
    let text = String(h.note || "").trim();
    if (/^Imported from Hevy/i.test(text)) text = "";
    const chipText = tags.map((t) => TAG_LABEL[t]).join(", ");
    while (chipText && text.startsWith(chipText))
      text = text
        .slice(chipText.length)
        .replace(/^\s*·\s*/, "")
        .trim();
    if (!text && !tags.length) continue;
    // Saved sessions carry dateISO/title; date/name are older/imported shapes.
    const date = String(h.dateISO || h.date || "").slice(0, 10);
    const title = String(h.title || h.name || h.dayName || "Session");
    out.push({
      kind: "session",
      id: `session-${h.id ?? `${date}-${out.length}`}`,
      sessionId: h.id ?? null,
      date,
      title,
      text,
      tags,
      hay: norm(`${text} ${chipText} ${title}`),
    });
  }
  for (const [exId, e] of Object.entries(
    setupNotes && typeof setupNotes === "object" ? setupNotes : {},
  )) {
    if (!e || typeof e !== "object") continue;
    const parts = ["seat", "pin", "grip", "angle", "note"]
      .filter((k) => e[k])
      .map(
        (k) =>
          `${k === "note" ? "Note" : k[0].toUpperCase() + k.slice(1)} ${e[k]}`,
      );
    if (!parts.length) continue;
    const title = String(nameOf(exId) || exId);
    out.push({
      kind: "setup",
      id: `setup-${exId}`,
      exerciseId: exId,
      date: String(e.updatedAt || "").slice(0, 10),
      title,
      text: parts.join(" · "),
      tags: [],
      hay: norm(`${title} ${parts.join(" ")}`),
    });
  }
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) =>
      b.e.date > a.e.date ? 1 : b.e.date < a.e.date ? -1 : b.i - a.i,
    )
    .map((x) => x.e);
}

/** Filter the index: kind 'all' | 'session' | 'setup', optional tag id, query. */
export function searchNotes(
  index,
  { query = "", kind = "all", tag = null } = {},
) {
  const words = queryWords(query);
  return index.filter((e) => {
    if (kind !== "all" && e.kind !== kind) return false;
    if (tag && !e.tags.includes(tag)) return false;
    return words.every((w) => wordStartMatch(e.hay, w));
  });
}
