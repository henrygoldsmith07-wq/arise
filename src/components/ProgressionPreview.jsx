// ProgressionPreview.jsx — the local "next 4 weeks" simulator on the active
// programme card. Liftosaur-style preview under Arise rules: it renders the
// output of progressionPreview.js, which replays the REAL engine forward from
// the user's own history. No network call, no second model, nothing saved.
// Computation only runs while the disclosure is open, so Train's first paint
// stays as cheap as before.
import { useMemo, useState } from 'react';
import { previewProgramProgression } from '../lib/progressionPreview.js';
import { localDateISO } from '../lib/dateOnly.js';
import { fmtWeight } from '../lib/units.ts';

export default function ProgressionPreview({ program, history = [], plateConfig = null, unit = 'kg' }){
  const [open, setOpen] = useState(false);
  const preview = useMemo(
    ()=> open ? previewProgramProgression({ program, history, plateConfig, todayISO: localDateISO() }) : null,
    [open, program, history, plateConfig],
  );
  if(!program?.weeks?.length) return null;
  return (
    <details
      className="rounded-xl border border-line bg-surface2 px-3 py-2"
      onToggle={(e)=> setOpen(e.target.open)}
    >
      <summary className="text-xs font-bold cursor-pointer">Next 4 weeks — simulated from your history</summary>
      <p className="text-[11px] text-ink3 mt-1.5">
        Replays the same engine that writes your prescriptions, assuming one exposure of each exercise per week.
        Loads are rounded to the kit you configured. Nothing here is saved or sent anywhere.
      </p>
      {preview && (
        <div className="mt-2 space-y-2">
          {preview.weeks.map(week=> (
            <div key={week.week} className="rounded-xl border border-line bg-surface px-3 py-2">
              <p className="text-[11px] font-bold">
                Week {week.week}
                {week.entries[0]?.dateISO && !String(week.entries[0].dateISO).startsWith('preview')
                  ? <span className="text-ink3 font-semibold"> · from {week.entries[0].dateISO}</span>
                  : null}
              </p>
              <ul className="mt-1.5 space-y-1">
                {week.entries.map(entry=> (
                  <li key={entry.exerciseId} className="flex items-baseline gap-2 text-xs">
                    <span className="min-w-0 truncate font-medium">{entry.name}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-ink2">
                      {entry.loadKg != null
                        ? `${fmtWeight(entry.loadKg, unit)} × ${entry.reps}`
                        : entry.isBodyweight
                          ? `bw × ${entry.reps}`
                          : `plan: ${entry.plannedReps || '—'}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {preview.omittedExercises > 0 && (
            <p className="text-[11px] text-ink3">…and {preview.omittedExercises} more exercises in this programme.</p>
          )}
        </div>
      )}
    </details>
  );
}
