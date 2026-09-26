export default function ToggleRow({ label, hint, checked, onChange, bare = false }){
  return (
    <label className={`flex items-start gap-3 cursor-pointer ${bare ? '' : 'rounded-xl border border-line bg-surface2 px-3 py-2.5'}`}>
      <input type="checkbox" checked={checked} onChange={e=> onChange(e.target.checked)} className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--accent)]" />
      <span className="min-w-0">
        <span className="block text-xs font-bold">{label}</span>
        <span className="block text-[11px] text-ink3 mt-0.5">{hint}</span>
      </span>
      <span className="ml-auto shrink-0 text-[11px] font-semibold text-ink3">{checked ? 'on' : 'off'}</span>
    </label>
  );
}
