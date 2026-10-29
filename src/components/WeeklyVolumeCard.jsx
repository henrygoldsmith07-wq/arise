import { useMemo, useState } from "react";
import { localDateISO } from "../lib/dateOnly.js";
import { VOLUME_GUIDE } from "../lib/blockPlan.js";
import {
  weeklyMuscleVolume,
  volumeStatus,
  musclesInWindow,
} from "../lib/muscleVolumeHistory.js";

const COLOR = {
  Chest: "bg-accent",
  Back: "bg-success",
  Shoulders: "bg-review",
  Arms: "bg-speak",
  Legs: "bg-ink2",
  Glutes: "bg-ink3",
  "Full body": "bg-line",
};
const STATUS = {
  under: ["Below guide", "text-review"],
  ok: ["In range", "text-success"],
  high: ["Above guide", "text-danger"],
  none: ["", "text-ink3"],
};
const PX = 96;
const label = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

// Progress: hard sets actually done per muscle, last 8 weeks. Tap a week for
// the muscle-by-muscle list and the sessions behind it. Local data only.
export default function WeeklyVolumeCard({ store }) {
  const today = localDateISO();
  const rows = useMemo(
    () =>
      weeklyMuscleVolume(store.history || [], {
        todayISO: today,
        schedule: store.activeSchedule,
      }),
    [store.history, store.activeSchedule, today],
  );
  const muscles = useMemo(() => musclesInWindow(rows), [rows]);
  const [picked, setPicked] = useState(rows.length - 1);
  const sel = rows[Math.min(picked, rows.length - 1)];
  const max = Math.max(VOLUME_GUIDE.high, ...rows.map((r) => r.total));
  if (!rows.length || !muscles.length) return null;
  return (
    <section
      className="rounded-2xl border border-line bg-surface p-4 space-y-3"
      aria-label="Weekly volume"
      data-testid="weekly-volume"
    >
      <div>
        <h3 className="text-sm font-black">Weekly volume</h3>
        <p className="text-[11px] text-ink3">
          Hard sets you logged per week. Tap a week.
        </p>
      </div>
      <div
        className="flex items-end gap-1"
        style={{ height: PX + 20 }}
        role="group"
        aria-label="Hard sets per week"
      >
        {rows.map((r, i) => (
          <button
            key={r.weekISO}
            type="button"
            onClick={() => setPicked(i)}
            aria-pressed={sel === r}
            aria-label={`Week of ${label(r.weekISO)}: ${r.total} hard sets${r.deload ? ", deload" : ""}`}
            data-testid="weekly-volume-bar"
            className={`flex-1 min-h-11 min-w-0 flex flex-col justify-end items-center gap-1 rounded-lg border ${sel === r ? "border-ink" : "border-transparent"}`}
            style={{ height: PX + 20 }}
          >
            <span className="text-[10px] tabular-nums text-ink3">
              {r.total || ""}
            </span>
            <span
              className="flex w-full flex-col-reverse overflow-hidden rounded-md"
              style={{ height: Math.round((r.total / max) * PX) }}
              aria-hidden="true"
            >
              {Object.entries(r.byMuscle).map(([m, n]) => (
                <span
                  key={m}
                  className={COLOR[m] || "bg-line"}
                  style={{ flexGrow: n }}
                />
              ))}
            </span>
          </button>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Muscles">
        {muscles.map((m) => (
          <li key={m} className="flex items-center gap-1 text-[11px] text-ink2">
            <span
              className={`h-2.5 w-2.5 rounded-sm ${COLOR[m] || "bg-line"}`}
              aria-hidden="true"
            />
            {m}
          </li>
        ))}
      </ul>
      <div
        className="rounded-xl bg-surface2 p-3 space-y-2"
        data-testid="weekly-volume-detail"
      >
        <p className="text-xs font-bold">
          Week of {label(sel.weekISO)}
          {sel.current ? " (so far)" : ""}
          {sel.deload ? " · deload" : ""}: {sel.total} hard sets
        </p>
        {sel.total === 0 ? (
          <p className="text-xs text-ink3">Nothing logged this week.</p>
        ) : (
          <ul className="space-y-1">
            {Object.entries(sel.byMuscle)
              .sort((a, b) => b[1] - a[1])
              .map(([m, n]) => {
                const [text, tone] = STATUS[volumeStatus(m, n)];
                return (
                  <li key={m} className="flex items-baseline gap-2 text-xs">
                    <span className="w-20 shrink-0">{m}</span>
                    <span className="tabular-nums font-bold">{n}</span>
                    {!sel.current && !sel.deload && text && (
                      <span className={`text-[11px] ${tone}`}>{text}</span>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
        {sel.sessions.length > 0 && (
          <ul className="space-y-0.5 border-t border-line pt-2">
            {sel.sessions.map((s) => (
              <li key={s.id} className="flex gap-2 text-[11px] text-ink2">
                <span className="w-14 shrink-0 tabular-nums text-ink3">
                  {label(s.dateISO)}
                </span>
                <span className="min-w-0 truncate">{s.title}</span>
                <span className="ml-auto tabular-nums">{s.sets}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11px] text-ink3 leading-snug">
        Main muscle of each lift only; warm-up sets and anything logged under
        RPE 5 are left out. {VOLUME_GUIDE.low}–{VOLUME_GUIDE.high} sets a week
        is a rough range, not a rule, and fewer is fine on purpose (legs around
        cycling).
      </p>
    </section>
  );
}
