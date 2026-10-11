export default function ToggleRow({ label, hint, checked, onChange, bare = false }){
  return (
    <label className={`check-control flex items-start gap-3 cursor-pointer ${bare ? 'min-h-11' : 'rounded-xl border border-line bg-surface2 px-3 py-2.5'}`}>
      <input type="checkbox" checked={checked} onChange={e=> onChange(e.target.checked)} />
      <span aria-hidden className="check-mark mt-0.5" />
      <span className="min-w-0">
        <span className="block text-xs font-bold">{label}</span>
        <span className="block text-[11px] text-ink3 mt-0.5">{hint}</span>
      </span>
      <span className="ml-auto shrink-0 text-[11px] font-semibold text-ink3">{checked ? 'on' : 'off'}</span>
    </label>
  );
}
