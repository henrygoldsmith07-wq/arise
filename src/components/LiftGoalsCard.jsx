import { useMemo, useState } from "react";
import { EXERCISE_BY_ID } from "../lib/data.js";
import { isoToday } from "../lib/programming.js";
import { asUnit, fmtWeight, weightInputToKg, weightInputValue } from "../lib/units.ts";
import {
  clearLiftGoal,
  describeProjection,
  listLiftGoals,
  projectGoal,
  setLiftGoal,
} from "../lib/liftGoals.js";

const TONE = {
  hit: "text-success",
  ahead: "text-success",
  "on-track": "text-success",
  behind: "text-review",
  flat: "text-ink2",
  "no-data": "text-ink3",
};
const LABEL = {
  hit: "Hit",
  ahead: "Ahead",
  "on-track": "On track",
  behind: "Behind",
  flat: "Flat",
  "no-data": "Need data",
};

const nameOf = (id) => EXERCISE_BY_ID[id]?.name || id;

// Lift goals on Progress: "100 kg × 8 by 20 Dec" with an honest on-track read.
// Goals live in gymPrefs.liftGoals (this device; merged by newest edit on
// sync/import). A goal counts as hit only by a real logged set.
export default function LiftGoalsCard({ store, setStore }) {
  const unit = asUnit(store.preferences?.units);
  const today = isoToday();
  const history = store.history || [];
  const goals = useMemo(() => listLiftGoals(store.gymPrefs), [store.gymPrefs]);
  const lifts = useMemo(() => {
    const ids = new Set();
    for (const s of history)
      for (const b of s?.blocks || []) if (b?.exerciseId) ids.add(b.exerciseId);
    for (const g of goals) ids.add(g.exerciseId);
    return [...ids].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  }, [history, goals]);
  const [open, setOpen] = useState(false);
  const [lift, setLift] = useState("");
  const [load, setLoad] = useState("");
  const [reps, setReps] = useState("8");
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState("");

  const rows = useMemo(
    () =>
      goals.map((g) => ({
        g,
        p: projectGoal(history, g.exerciseId, g, today),
      })),
    [goals, history, today],
  );

  function edit(g) {
    setOpen(true);
    setLift(g.exerciseId);
    setLoad(weightInputValue(g.kg, unit));
    setReps(String(g.reps));
    setDeadline(g.deadlineISO || "");
    setError("");
  }

  function save() {
    const kg = Number(weightInputToKg(load, unit));
    const res = setLiftGoal(
      store.gymPrefs,
      lift,
      { kg, reps: Number(reps), deadlineISO: deadline || null },
      new Date().toISOString(),
      today,
    );
    if (res.error) {
      setError(res.error);
      return;
    }
    setError("");
    setStore({ ...store, gymPrefs: { ...(store.gymPrefs || {}), ...res.patch } });
    setOpen(false);
    setLift("");
    setLoad("");
    setDeadline("");
  }

  function remove(id) {
    setStore({
      ...store,
      gymPrefs: { ...(store.gymPrefs || {}), ...clearLiftGoal(store.gymPrefs, id) },
    });
  }

  if (!lifts.length && !goals.length) return null;

  return (
    <section
      className="rounded-2xl border border-line bg-surface p-4 space-y-3"
      aria-label="Lift goals"
      data-testid="lift-goals-card"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold">Lift goals</h3>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setError("");
          }}
          data-testid="lift-goal-add"
          className="btn btn-ghost min-h-11 rounded-xl px-3 text-xs font-bold"
          aria-expanded={open}
        >
          {open ? "Close" : "Set a goal"}
        </button>
      </div>

      {rows.length === 0 && !open && (
        <p className="text-xs text-ink3">
          Pick a lift and a target, like 100 {unit} × 8, and Arise tells you
          whether your recent trend gets there.
        </p>
      )}

      {rows.map(({ g, p }) => (
        <div
          key={g.exerciseId}
          className="space-y-1.5 border-t border-line pt-3 first:border-0 first:pt-0"
          data-testid={`lift-goal-${g.exerciseId}`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-bold">
              {nameOf(g.exerciseId)}{" "}
              <span className="tabular-nums text-ink2">
                {fmtWeight(g.kg, unit)} × {g.reps}
              </span>
            </p>
            <span
              className={`text-xs font-bold ${TONE[p.status]}`}
              data-testid="lift-goal-status"
            >
              {LABEL[p.status]}
            </span>
          </div>
          <div
            className="relative h-2 rounded-full bg-surface2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(p.progress * 100)}
            aria-label={`${nameOf(g.exerciseId)} goal progress`}
          >
            <div
              className="h-2 rounded-full bg-accent"
              style={{ width: `${Math.round(p.progress * 100)}%` }}
            />
            {[25, 50, 75].map((m) => (
              <span
                key={m}
                aria-hidden
                className="absolute top-0 h-2 w-px bg-line"
                style={{ left: `${m}%` }}
              />
            ))}
          </div>
          <p className="text-xs text-ink2" data-testid="lift-goal-line">
            {describeProjection(p, g, unit)}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => edit(g)}
              className="btn btn-ghost min-h-11 rounded-xl px-3 text-xs font-bold"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => remove(g.exerciseId)}
              className="btn btn-ghost min-h-11 rounded-xl px-3 text-xs font-bold"
              aria-label={`Remove goal for ${nameOf(g.exerciseId)}`}
            >
              Remove
            </button>
          </div>
        </div>
      ))}

      {open && (
        <div className="space-y-2 border-t border-line pt-3" data-testid="lift-goal-form">
          <label className="block text-[11px] font-semibold text-ink2">
            Lift
            <select
              value={lift}
              onChange={(e) => setLift(e.target.value)}
              data-testid="lift-goal-lift"
              className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface2 px-3 text-base"
            >
              <option value="">Choose a lift you have logged</option>
              {lifts.map((id) => (
                <option key={id} value={id}>
                  {nameOf(id)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <label className="flex-1 text-[11px] font-semibold text-ink2">
              Load ({unit})
              <input
                value={load}
                onChange={(e) => setLoad(e.target.value)}
                inputMode="decimal"
                data-testid="lift-goal-load"
                className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface2 px-3 text-base font-bold tabular-nums"
              />
            </label>
            <label className="w-24 text-[11px] font-semibold text-ink2">
              Reps
              <input
                value={reps}
                onChange={(e) => setReps(e.target.value)}
                inputMode="numeric"
                data-testid="lift-goal-reps"
                className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface2 px-3 text-base font-bold tabular-nums"
              />
            </label>
          </div>
          <label className="block text-[11px] font-semibold text-ink2">
            By (optional)
            <input
              type="date"
              value={deadline}
              min={today}
              onChange={(e) => setDeadline(e.target.value)}
              data-testid="lift-goal-deadline"
              className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface2 px-3 text-base"
            />
          </label>
          {error && (
            <p role="alert" className="text-xs text-review" data-testid="lift-goal-error">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={save}
            data-testid="lift-goal-save"
            className="btn btn-primary min-h-11 w-full rounded-xl"
          >
            Save goal
          </button>
        </div>
      )}
    </section>
  );
}
