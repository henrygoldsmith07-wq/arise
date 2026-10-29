import { useMemo, useState } from "react";
import { EXERCISE_BY_ID } from "../lib/data.js";
import { isoToday } from "../lib/programming.js";
import {
  asUnit,
  fmtWeight,
  weightInputToKg,
  weightInputValue,
} from "../lib/units.ts";
import {
  bodyweightOn,
  bodyweightSparkline,
  bodyweightTrend,
  liveBodyweights,
  parseBodyweightKg,
  relativeStrength,
  removeBodyweight,
  upsertBodyweight,
} from "../lib/bodyweightLog.js";

const VERDICT = {
  up: { label: "Stronger for your size", tone: "text-success" },
  flat: { label: "About the same", tone: "text-ink2" },
  down: { label: "Lighter for your size", tone: "text-review" },
  new: { label: "New baseline", tone: "text-ink3" },
};

// Optional body-weight log + strength relative to body weight. Everything stays
// on this device; entries are canonical kg and shown in the user's unit.
export default function BodyweightCard({ store, setStore }) {
  const unit = asUnit(store.preferences?.units);
  const today = isoToday();
  const log = store.bodyweightLog || [];
  const todayRow = bodyweightOn(log, today);
  const [text, setText] = useState(() =>
    weightInputValue(todayRow?.kg ?? liveBodyweights(log).pop()?.kg, unit),
  );
  const [error, setError] = useState("");
  const rows = useMemo(() => liveBodyweights(log), [log]);
  const trend = useMemo(() => bodyweightTrend(log, today), [log, today]);
  const line = useMemo(() => bodyweightSparkline(log), [log]);
  const strength = useMemo(
    () => relativeStrength(store.history || [], log, today),
    [store.history, log, today],
  );
  const kgFromText = parseBodyweightKg(weightInputToKg(text, unit));

  function save() {
    if (kgFromText == null) {
      setError(
        `Enter a weight between 20 and 300 kg (${unit === "lb" ? "44–661 lb" : "about 20–300 kg"}).`,
      );
      return;
    }
    setError("");
    setStore({
      ...store,
      bodyweightLog: upsertBodyweight(log, { dateISO: today, kg: kgFromText }),
    });
  }
  const unitWord = unit === "lb" ? "lb" : "kg";

  return (
    <section
      className="rounded-2xl border border-line bg-surface p-4 space-y-3"
      aria-label="Body weight"
      data-testid="bodyweight-card"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold">Body weight</h3>
        <span
          className="text-xs font-bold tabular-nums"
          data-testid="bodyweight-latest"
        >
          {trend.latest ? fmtWeight(trend.latest.kg, unit) : "Not logged"}
        </span>
      </div>
      <div className="flex items-end gap-2">
        <label className="flex-1 text-[11px] font-semibold text-ink2">
          Today ({unitWord})
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError("");
            }}
            inputMode="decimal"
            data-testid="bodyweight-input"
            placeholder={unit === "lb" ? "150" : "68"}
            className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface2 px-3 text-base font-bold tabular-nums"
          />
        </label>
        <button
          type="button"
          onClick={save}
          data-testid="bodyweight-save"
          className="btn btn-primary min-h-11 rounded-xl px-4"
        >
          {todayRow ? "Update" : "Log"}
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="text-xs text-review"
          data-testid="bodyweight-error"
        >
          {error}
        </p>
      )}
      {line && (
        <svg
          viewBox="0 0 120 32"
          className="w-full h-10"
          role="img"
          aria-label={`Body weight over your last ${Math.min(rows.length, 30)} weigh-ins`}
        >
          <polyline
            points={line}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-ink2"
          />
        </svg>
      )}
      <p className="text-xs text-ink3" data-testid="bodyweight-trend">
        {trend.note}
      </p>

      {rows.length > 0 && (
        <details className="text-xs">
          <summary className="min-h-11 flex items-center font-bold cursor-pointer">
            Recent weigh-ins ({rows.length})
          </summary>
          <ul className="divide-y divide-line">
            {rows
              .slice(-6)
              .reverse()
              .map((r) => (
                <li
                  key={r.dateISO}
                  className="flex items-center justify-between min-h-11"
                >
                  <span className="tabular-nums">
                    {r.dateISO} · {fmtWeight(r.kg, unit)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setStore({
                        ...store,
                        bodyweightLog: removeBodyweight(log, r.dateISO),
                      })
                    }
                    aria-label={`Remove weigh-in ${r.dateISO}`}
                    className="min-h-11 min-w-11 text-ink3 font-bold"
                  >
                    Remove
                  </button>
                </li>
              ))}
          </ul>
        </details>
      )}

      <div className="space-y-1" data-testid="relative-strength">
        <h4 className="text-xs font-bold">Strength for your size</h4>
        {strength.length === 0 ? (
          <p className="text-xs text-ink3">
            {rows.length
              ? "Train a lift in the last 8 weeks and it appears here."
              : "Log your weight and it shows each lift’s estimated max as a multiple of your body weight."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {strength.map((r) => {
              const v = VERDICT[r.verdict];
              const abs =
                r.e1rmChangeKg == null
                  ? ""
                  : `max ${r.e1rmChangeKg >= 0 ? "+" : "−"}${fmtWeight(Math.abs(r.e1rmChangeKg), unit)}, body ${r.bodyChangeKg >= 0 ? "+" : "−"}${fmtWeight(Math.abs(r.bodyChangeKg), unit)}`;
              return (
                <li
                  key={r.exerciseId}
                  className="rounded-xl bg-surface2 px-3 py-2"
                  data-testid="relative-strength-row"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {EXERCISE_BY_ID[r.exerciseId]?.name || r.exerciseId}
                    </span>
                    <span className="text-sm font-black tabular-nums">
                      {r.ratio.toFixed(2)}×
                    </span>
                  </div>
                  <p className="text-[11px] text-ink3">
                    <span className={`font-bold ${v.tone}`}>{v.label}</span>
                    {r.changePct != null &&
                      ` (${r.changePct > 0 ? "+" : ""}${r.changePct}%)`}
                    {abs && ` · ${abs}`}
                    {r.bodyweightLift && " · includes your body weight"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[11px] text-ink3">
          Estimated max ÷ body weight, best session of the last 8 weeks against
          the 8 before. Machine stacks differ between gyms, so compare yourself
          with you, not with other people.
        </p>
      </div>
    </section>
  );
}
