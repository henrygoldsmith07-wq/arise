import { useMemo, useState } from "react";
import { EXERCISE_BY_ID } from "../lib/data.js";
import { isoToday } from "../lib/programming.js";
import { asUnit, fmtWeight } from "../lib/units.ts";
import {
  bandLabel,
  latestSessionPrs,
  markPrSeen,
  readPrSeen,
} from "../lib/personalRecords.js";

// Today: what your last session beat, for three days or until you dismiss it.
export default function NewPrCard({ store }) {
  const unit = asUnit(store.preferences?.units);
  const [seen, setSeen] = useState(readPrSeen);
  const res = useMemo(
    () => latestSessionPrs(store.history || [], { todayISO: isoToday() }),
    [store.history],
  );
  if (!res || seen === res.sessionId) return null;
  return (
    <div
      className="rounded-2xl border border-success/40 bg-success/10 p-4 space-y-2"
      role="status"
      data-testid="new-pr-card"
    >
      <p className="text-sm font-black">
        {res.prs.length === 1 ? "New PR" : `${res.prs.length} new PRs`}
      </p>
      <ul className="space-y-1 text-xs">
        {res.prs.slice(0, 4).map((p) => (
          <li key={p.exerciseId}>
            <strong>{EXERCISE_BY_ID[p.exerciseId]?.name || p.exerciseId}</strong>{" "}
            {fmtWeight(p.kg, unit)} × {p.reps} — was {fmtWeight(p.previousKg, unit)} at{" "}
            {bandLabel(p.band)}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn btn-ghost min-h-11 rounded-xl px-3 text-xs font-bold"
        data-testid="new-pr-dismiss"
        onClick={() => {
          markPrSeen(res.sessionId);
          setSeen(res.sessionId);
        }}
      >
        Nice
      </button>
    </div>
  );
}
