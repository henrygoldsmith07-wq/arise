import { useMemo, useState } from 'react';
import { useDialogA11y } from '../lib/a11y.js';
import { SETUP_FIELDS, getSetupNote, formatSetup, setupDrift } from '../lib/setupNotes.js';

// Per-lift machine/bench setup: a one-line reminder under the target plus a
// small sheet to edit it. Read-only when no onSave is given (history sheet).
function SetupSheet({ exerciseId, name, entry, onSave, onClose }){
  const a11y = useDialogA11y({ active: true, onClose });
  const [form, setForm] = useState(()=> Object.fromEntries(SETUP_FIELDS.map((f)=> [f.key, entry?.[f.key] || ''])));
  const submit = (e)=> { e.preventDefault(); onSave(exerciseId, form); onClose(); };
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40" onClick={onClose}>
      <form ref={a11y.rootRef} onKeyDown={a11y.trapTab} onSubmit={submit} role="dialog" aria-modal="true" aria-label={`${name} setup`} data-testid="setup-sheet"
        onClick={(e)=> e.stopPropagation()} className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-ink">{name}: your setup</h2>
          <button ref={a11y.closeRef} type="button" onClick={onClose} className="min-h-11 min-w-11 text-xs font-bold px-3 rounded-full border border-line">Cancel</button>
        </div>
        <p className="text-[11px] text-ink3">Saved on this device and shown next time you do this lift.</p>
        {SETUP_FIELDS.map((f)=> (
          <label key={f.key} className="block text-[11px] font-semibold text-ink2">{f.label}
            <input type="text" value={form[f.key]} maxLength={f.max} placeholder={f.placeholder} data-testid={`setup-${f.key}`}
              onChange={(e)=> setForm((prev)=> ({ ...prev, [f.key]: e.target.value }))}
              className="mt-1 w-full min-h-11 rounded-xl border border-line bg-surface2 px-3 text-sm font-normal text-ink" />
          </label>
        ))}
        <div className="flex gap-2 pt-1">
          <button type="submit" data-testid="setup-save" className="btn btn-primary flex-1 min-h-11 rounded-xl">Save setup</button>
          {entry && <button type="button" data-testid="setup-clear" onClick={()=> { onSave(exerciseId, {}); onClose(); }} className="min-h-11 px-4 rounded-xl border border-line text-sm font-bold">Clear</button>}
        </div>
      </form>
    </div>
  );
}

export default function SetupNote({ exerciseId, name, gymPrefs = null, history = [], onSave = null, className = '' }){
  const [open, setOpen] = useState(false);
  const entry = useMemo(()=> getSetupNote(gymPrefs, exerciseId), [gymPrefs, exerciseId]);
  const drift = useMemo(()=> setupDrift(gymPrefs, history, exerciseId), [gymPrefs, history, exerciseId]);
  if(!entry && !onSave) return null;
  return (
    <div className={`text-[11px] ${className}`} data-testid={`setup-row-${exerciseId}`}>
      {entry && <p className="text-ink2 leading-snug"><span className="font-bold text-ink">Setup:</span> <span data-testid={`setup-text-${exerciseId}`}>{formatSetup(entry)}</span></p>}
      {entry && drift.changed && <p role="status" data-testid={`setup-changed-${exerciseId}`} className="mt-0.5 text-ink3">Changed since last time (was {drift.previous}{drift.dateISO ? `, ${drift.dateISO}` : ''}).</p>}
      {onSave && (
        <button type="button" data-testid={`setup-open-${exerciseId}`} onClick={()=> setOpen(true)}
          className="mt-1 min-h-11 text-xs font-bold px-3 rounded-full border border-line bg-surface2">{entry ? 'Edit setup' : 'Add setup (seat, pin, grip)'}</button>
      )}
      {open && onSave && <SetupSheet exerciseId={exerciseId} name={name || exerciseId} entry={entry} onSave={onSave} onClose={()=> setOpen(false)} />}
    </div>
  );
}
