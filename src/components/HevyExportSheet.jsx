// HevyExportSheet — send Arise sessions back to Hevy as Hevy's own CSV.
// Everything is built on this device; the file is shared or downloaded, never
// uploaded. Hevy's importer may or may not accept its own export, so the copy
// says what the file is and offers the honest fallback (any spreadsheet).
import { useMemo, useState } from 'react';
import { useDialogA11y } from '../lib/a11y.js';
import { EXERCISE_BY_ID } from '../lib/data.js';
import { todayISO } from '../lib/schedule.js';
import { buildHevyExport, rangeStart, readExportMark, writeExportMark, HEVY_RANGES } from '../lib/hevyCsvExport.js';
import { canShareFiles, shareFile, saveBlob } from '../lib/nativeShare.js';

export default function HevyExportSheet({ history = [], units = 'kg', onClose }) {
  const a11y = useDialogA11y({ active: true, onClose });
  const today = todayISO();
  const [mark, setMark] = useState(() => readExportMark());
  const [range, setRange] = useState(() => (mark ? 'since-last' : '90'));
  const unit = units === 'lb' ? 'lb' : 'kg';
  const [includeHevy, setIncludeHevy] = useState(false);
  const [msg, setMsg] = useState('');
  const result = useMemo(
    () => buildHevyExport(history, { byId: EXERCISE_BY_ID, units: unit, since: rangeStart(range, today, mark), includeHevyOrigin: includeHevy, todayISO: today }),
    [history, unit, range, mark, includeHevy, today],
  );
  const makeFile = () => new File([result.csv], result.filename, { type: 'text/csv' });
  const done = () => {
    if (result.lastDate && writeExportMark(result.lastDate)) setMark(result.lastDate);
  };
  async function onShare() {
    const file = makeFile();
    if (canShareFiles({ mimeType: 'text/csv', filename: file.name })) {
      const how = await shareFile({ file, title: 'Arise workouts for Hevy' });
      if (how === 'shared') { done(); setMsg('Shared.'); return; }
      if (how === 'cancelled') return;
    }
    saveBlob(file); done(); setMsg('Downloaded to this device.');
  }
  function onDownload() { saveBlob(makeFile()); done(); setMsg('Downloaded to this device.'); }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div ref={a11y.rootRef} onKeyDown={a11y.trapTab} role="dialog" aria-modal="true" aria-label="Export for Hevy" data-testid="hevy-export-sheet"
        onClick={(e) => e.stopPropagation()} className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-ink">Export for Hevy</h2>
          <button ref={a11y.closeRef} type="button" onClick={onClose} className="min-h-11 min-w-11 text-xs font-bold px-3 rounded-full border border-line">Close</button>
        </div>
        <p className="text-[11px] text-ink3">Your workouts as a CSV in Hevy's own export layout. Built on this device, never uploaded. If Hevy won't take it, any spreadsheet will open it.</p>

        <div role="group" aria-label="Which workouts" className="grid grid-cols-2 gap-1.5">
          {HEVY_RANGES.filter((r) => r.id !== 'since-last' || mark).map((r) => (
            <button key={r.id} type="button" aria-pressed={range === r.id} data-testid={`hevy-range-${r.id}`} onClick={() => setRange(r.id)}
              className={`min-h-11 rounded-xl border px-2 text-xs font-bold ${range === r.id ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink3'}`}>
              {r.id === 'since-last' ? `After ${mark}` : r.label}
            </button>
          ))}
        </div>

        <label className="check-control flex min-h-11 items-center gap-2 text-xs text-ink2">
          <input type="checkbox" checked={includeHevy} onChange={(e) => setIncludeHevy(e.target.checked)} data-testid="hevy-include-imported" />
          <span>Include workouts that came from Hevy{result.fromHevy ? ` (${result.fromHevy} held back)` : ''}</span>
        </label>

        <div className="rounded-xl border border-line bg-surface2 px-3 py-2 text-xs text-ink2" data-testid="hevy-export-summary" role="status">
          {result.workouts
            ? <>
                <strong className="text-ink">{result.workouts} workout{result.workouts === 1 ? '' : 's'}</strong> · {result.sets} sets · {result.exercises} exercise{result.exercises === 1 ? '' : 's'}
                <span className="block text-ink3">{result.firstDate} to {result.lastDate}</span>
              </>
            : <>Nothing to export for this choice{result.fromHevy ? `` : ''}. Try a longer range.</>}
        </div>
        {result.customExercises.length > 0 && (
          <p className="text-[11px] text-ink3" data-testid="hevy-custom-note">
            Hevy has no matching name for {result.customExercises.slice(0, 4).join(', ')}; they keep Arise names and become custom exercises in Hevy.
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button type="button" disabled={!result.workouts} onClick={onShare} data-testid="hevy-share" className="btn btn-primary flex-1 min-h-11 rounded-xl disabled:opacity-40">Share file</button>
          <button type="button" disabled={!result.workouts} onClick={onDownload} data-testid="hevy-download" className="btn btn-secondary flex-1 min-h-11 rounded-xl disabled:opacity-40">Download CSV</button>
        </div>
        {msg && <p role="status" className="text-xs text-ink2" data-testid="hevy-export-msg">{msg}</p>}
      </div>
    </div>
  );
}
