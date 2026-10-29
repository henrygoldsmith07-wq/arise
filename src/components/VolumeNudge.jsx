import { useMemo, useState } from "react";
import { localDateISO } from "../lib/dateOnly.js";
import { mondayKeyISO } from "../lib/dateOnly.js";
import {
  underTrainedLastWeek,
  readNudgeSeen,
  markNudgeSeen,
} from "../lib/muscleVolumeHistory.js";
import { VOLUME_GUIDE } from "../lib/blockPlan.js";

// Today: one quiet line when an upper-body muscle you have been training got
// less than the guide's low end last week. Dismissed once per week, per device.
export default function VolumeNudge({ store }) {
  const today = localDateISO();
  const week = mondayKeyISO(today);
  const [seen, setSeen] = useState(readNudgeSeen);
  const gaps = useMemo(
    () =>
      underTrainedLastWeek(store.history || [], {
        todayISO: today,
        schedule: store.activeSchedule,
      }),
    [store.history, store.activeSchedule, today],
  );
  if (!gaps.length || seen === week) return null;
  const names = gaps
    .map((g) => `${g.muscle.toLowerCase()} (${g.sets})`)
    .join(", ");
  return (
    <div
      className="rounded-2xl border border-line bg-surface p-4 space-y-2"
      role="status"
      data-testid="volume-nudge"
    >
      <p className="text-sm font-bold">Light week for {names}</p>
      <p className="text-xs text-ink2">
        Last week gave {gaps.length > 1 ? "them" : "it"} under{" "}
        {VOLUME_GUIDE.low} hard sets. Fine if that was on purpose; the Weekly
        volume card in Progress shows the trend.
      </p>
      <button
        type="button"
        className="btn btn-ghost min-h-11 rounded-xl px-3 text-xs font-bold"
        data-testid="volume-nudge-dismiss"
        onClick={() => {
          markNudgeSeen(week);
          setSeen(week);
        }}
      >
        Got it
      </button>
    </div>
  );
}
