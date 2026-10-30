// NotesJournalSheet — search every session note, tag chip and machine setup
// note in one place. Built on this device from history; nothing is uploaded.
import { useMemo, useState } from "react";
import { useDialogA11y } from "../lib/a11y.js";
import { EXERCISE_BY_ID } from "../lib/data.js";
import { buildNoteIndex, searchNotes, TAG_FILTERS } from "../lib/noteSearch.js";

const KINDS = [
  ["all", "All"],
  ["session", "Sessions"],
  ["setup", "Machine setups"],
];

export default function NotesJournalSheet({
  history = [],
  setupNotes = {},
  onClose,
}) {
  const a11y = useDialogA11y({ active: true, onClose });
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [tag, setTag] = useState(null);
  const index = useMemo(
    () =>
      buildNoteIndex(
        history,
        setupNotes,
        (id) => EXERCISE_BY_ID[id]?.name || id,
      ),
    [history, setupNotes],
  );
  const rows = useMemo(
    () => searchNotes(index, { query, kind, tag }),
    [index, query, kind, tag],
  );
  const chip = (on) =>
    `min-h-11 rounded-full border px-3 text-xs font-bold ${on ? "bg-ink text-bg border-ink" : "bg-surface border-line text-ink3"}`;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        ref={a11y.rootRef}
        onKeyDown={a11y.trapTab}
        role="dialog"
        aria-modal="true"
        aria-label="Training notes"
        data-testid="notes-journal"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 space-y-3"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-ink">Training notes</h2>
          <button
            ref={a11y.closeRef}
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 text-xs font-bold px-3 rounded-full border border-line"
          >
            Close
          </button>
        </div>
        <input
          type="search"
          aria-label="Search notes"
          placeholder="Search e.g. shoulder, seat 4"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full min-h-11 rounded-xl border border-line bg-surface2 px-3 text-sm"
        />
        <div
          role="group"
          aria-label="Kind of note"
          className="flex flex-wrap gap-1.5"
        >
          {KINDS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={kind === id}
              onClick={() => setKind(id)}
              className={chip(kind === id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Tag" className="flex flex-wrap gap-1.5">
          {TAG_FILTERS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tag === t.id}
              onClick={() => setTag(tag === t.id ? null : t.id)}
              className={chip(tag === t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink3" aria-live="polite">
          {rows.length} of {index.length} notes
        </p>
        <ul className="space-y-2">
          {rows.map((e) => (
            <li
              key={e.id}
              data-testid="note-row"
              className="rounded-xl border border-line p-3"
            >
              <div className="flex justify-between gap-2 text-[11px] text-ink3">
                <span className="font-bold text-ink2">{e.title}</span>
                <span>{e.date}</span>
              </div>
              {e.tags.length > 0 && (
                <p className="mt-1 text-[11px] text-ink3">
                  {e.tags
                    .map((t) => TAG_FILTERS.find((f) => f.id === t)?.label)
                    .join(", ")}
                </p>
              )}
              {e.text && <p className="mt-1 text-xs text-ink2">{e.text}</p>}
            </li>
          ))}
        </ul>
        {rows.length === 0 && (
          <p className="text-xs text-ink3">
            {index.length
              ? "No notes match."
              : "No notes yet. Add one when you finish a session or from a lift’s setup note."}
          </p>
        )}
      </div>
    </div>
  );
}
