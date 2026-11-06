// RecoveryMap — per-muscle freshness from the last 72 h of hard sets, on
// Today. Hidden when nothing was trained recently (everything is fresh).
import { useMemo } from "react";
import { muscleFreshness, RECOVERY_HOURS } from "../lib/muscleVolumeHistory.js";

export default function RecoveryMap({ store }) {
  const rows = useMemo(() => muscleFreshness(store.history || []), [store.history]);
  if (rows.every((r) => r.pct === 100)) return null;
  return (
    <section className="rounded-xl border border-line bg-surface p-3 space-y-2" aria-label="Muscle recovery" data-testid="recovery-map">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink3">Muscle recovery</p>
        <p className="text-[10px] text-ink3">rough guide · last {RECOVERY_HOURS} h</p>
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map((r) => (
          <li key={r.muscle} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0">{r.muscle}</span>
            <span className="flex-1 h-1.5 rounded-full bg-surface2 overflow-hidden" aria-hidden>
              <span className={`block h-full ${r.pct < 50 ? "bg-review" : r.pct < 90 ? "bg-ink3" : "bg-success"}`} style={{ width: `${r.pct}%` }} />
            </span>
            <span className="w-8 text-right tabular-nums text-ink3">{r.pct}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
