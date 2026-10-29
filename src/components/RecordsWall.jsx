import { useMemo, useState } from "react";
import { useDialogA11y } from "../lib/a11y.js";
import { asUnit, fmtWeight } from "../lib/units.ts";
import { isoToday } from "../lib/programming.js";
import {
  REP_BANDS,
  bandLabel,
  filterWall,
  recordsWall,
} from "../lib/personalRecords.js";

const day = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

// Progress: every lift's all-time bests by rep band. Derived from the history on
// this device, so fixing or deleting a set updates the wall straight away.
export default function RecordsWall({ store }) {
  const unit = asUnit(store.preferences?.units);
  const today = isoToday();
  const rows = useMemo(
    () => recordsWall(store.history || [], { todayISO: today }),
    [store.history, today],
  );
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  const recent = rows.filter((r) => r.recent);
  return (
    <section
      className="rounded-2xl border border-line bg-surface p-4 space-y-3"
      aria-label="Records"
      data-testid="records-card"
    >
      <div>
        <h3 className="text-sm font-black">Records</h3>
        <p className="text-[11px] text-ink3">
          Heaviest load for 1, 3, 5, 8 and 12+ reps, per lift.{" "}
          {recent.length
            ? `${recent.length} lift${recent.length > 1 ? "s" : ""} set a PR in the last 30 days.`
            : "No new PRs in the last 30 days."}
        </p>
      </div>
      <ul className="space-y-1.5">
        {rows.slice(0, 3).map((r) => (
          <Headline key={r.exerciseId} r={r} unit={unit} />
        ))}
      </ul>
      <button
        type="button"
        className="btn btn-secondary w-full min-h-11 rounded-xl px-3 text-xs font-bold"
        data-testid="records-open"
        onClick={() => setOpen(true)}
      >
        Open the records wall ({rows.length} lift{rows.length > 1 ? "s" : ""})
      </button>
      {open && (
        <Wall rows={rows} unit={unit} onClose={() => setOpen(false)} />
      )}
    </section>
  );
}

function Headline({ r, unit }) {
  const top = r.bestE1rm;
  return (
    <li className="flex items-center gap-2 rounded-xl border border-line bg-surface2 px-3 py-2 text-sm">
      <span className="font-bold truncate">{r.name}</span>
      {r.recent && (
        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-black text-success">
          PR {day(r.lastPrISO)}
        </span>
      )}
      <span className="ml-auto tabular-nums text-xs text-ink2">
        {fmtWeight(top.kg, unit)} × {top.reps}
      </span>
    </li>
  );
}

function Wall({ rows, unit, onClose }) {
  const a11y = useDialogA11y({ active: true, onClose });
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState("");
  const muscles = useMemo(
    () => [...new Set(rows.map((r) => r.muscle))].sort(),
    [rows],
  );
  const shown = useMemo(
    () => filterWall(rows, { query, muscle }),
    [rows, query, muscle],
  );
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        ref={a11y.rootRef}
        onKeyDown={a11y.trapTab}
        role="dialog"
        aria-modal="true"
        aria-label="Records wall"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 space-y-3"
        data-testid="records-wall"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold">Records wall</h2>
          <button
            ref={a11y.closeRef}
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 rounded-full border border-line px-3 text-xs font-bold"
          >
            Done
          </button>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a lift"
          aria-label="Search a lift"
          className="min-h-11 w-full rounded-xl border border-line bg-surface2 px-3 text-sm"
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Muscle">
          {["", ...muscles].map((m) => (
            <button
              key={m || "all"}
              type="button"
              aria-pressed={muscle === m}
              onClick={() => setMuscle(m)}
              className={`min-h-11 rounded-full border px-3 text-xs font-semibold ${muscle === m ? "border-ink bg-ink text-bg" : "border-line bg-surface2"}`}
            >
              {m || "All"}
            </button>
          ))}
        </div>
        {!shown.length && (
          <p className="text-xs text-ink3">No lifts match.</p>
        )}
        <ul className="space-y-2">
          {shown.map((r) => (
            <li
              key={r.exerciseId}
              className="rounded-xl border border-line bg-surface2 p-3 space-y-2"
              data-testid="records-row"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-bold">{r.name}</span>
                <span className="text-[11px] text-ink3">
                  {r.prCount} PR{r.prCount === 1 ? "" : "s"}
                  {r.lastPrISO ? ` · last ${day(r.lastPrISO)}` : ""}
                </span>
              </div>
              <dl className="grid grid-cols-5 gap-1 text-center">
                {REP_BANDS.map((band) => {
                  const b = r.bands[band];
                  return (
                    <div key={band} className="rounded-lg bg-surface px-1 py-1.5">
                      <dt className="text-[10px] text-ink3">{bandLabel(band)}</dt>
                      <dd className="text-xs font-black tabular-nums">
                        {b ? fmtWeight(b.kg, unit) : "—"}
                      </dd>
                      {b && (
                        <dd className="text-[10px] text-ink3">{day(b.dateISO)}</dd>
                      )}
                    </div>
                  );
                })}
              </dl>
              <p className="text-[11px] text-ink3">
                Best estimated max {fmtWeight(r.bestE1rm.e1rm, unit)} (
                {fmtWeight(r.bestE1rm.kg, unit)} × {r.bestE1rm.reps},{" "}
                {day(r.bestE1rm.dateISO)})
              </p>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-ink3">
          Assisted sets, skipped or failed sets and sessions noted as a
          technique or range change are not counted.
        </p>
      </div>
    </div>
  );
}
