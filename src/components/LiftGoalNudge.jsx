import { useMemo } from "react";
import { EXERCISE_BY_ID } from "../lib/data.js";
import { asUnit, fmtWeight } from "../lib/units.ts";
import { markGoalHitSeen, unseenGoalHits } from "../lib/liftGoals.js";

// Today: a lift goal was reached by a real logged set. Shown once per hit.
export default function LiftGoalNudge({ store, setStore }) {
  const unit = asUnit(store.preferences?.units);
  const hits = useMemo(
    () => unseenGoalHits(store.history || [], store.gymPrefs),
    [store.history, store.gymPrefs],
  );
  if (!hits.length) return null;
  const hit = hits[0];
  const name = EXERCISE_BY_ID[hit.exerciseId]?.name || hit.exerciseId;
  return (
    <div
      className="rounded-2xl border border-success/40 bg-surface p-4 space-y-2"
      role="status"
      data-testid="lift-goal-hit"
    >
      <p className="text-sm font-bold">Goal hit: {name}</p>
      <p className="text-xs text-ink2">
        You logged {fmtWeight(hit.goal.kg, unit)} × {hit.goal.reps} or better on{" "}
        {hit.hitDate}. Set the next one from Progress.
      </p>
      <button
        type="button"
        data-testid="lift-goal-hit-dismiss"
        className="btn btn-ghost min-h-11 rounded-xl px-3 text-xs font-bold"
        onClick={() =>
          setStore({
            ...store,
            gymPrefs: {
              ...(store.gymPrefs || {}),
              ...markGoalHitSeen(store.gymPrefs, hit.exerciseId, hit.hitDate),
            },
          })
        }
      >
        Got it
      </button>
    </div>
  );
}
