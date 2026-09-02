const TABS = [
  ['today','Today','🏠'],
  ['train','Train','🏋️'],
  ['exercises','Exercises','🔎'],
  ['progress','Progress','📈'],
  ['lab','Lab','🧪'],
  ['more','More','⋯'],
];

const THEME_LABEL = { light: 'Light', dark: 'Dark' };
const THEME_ICON = { light: '☀️', dark: '🌙' };

export default function AppShell({ children, tab, setTab, storeVersion, theme = null, onCycleTheme }){
  void storeVersion;
  const themeName = THEME_LABEL[theme] || 'System';
  return (
    <div className="min-h-dvh flex flex-col bg-bg text-ink">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 border-b border-line bg-surface/90 backdrop-blur">
        <img src="/logo.svg" alt="" width={28} height={28} className="rounded-lg" aria-hidden="true" />
        <span className="font-extrabold tracking-tight">Arise</span>
        <span className="text-xs text-ink3 hidden sm:inline">Training, levelled up.</span>
        <span className="ml-auto text-[11px] px-2 py-1 rounded-full bg-surface2 border border-line text-ink3 hidden sm:inline">Offline-ready • No account</span>
        {onCycleTheme && (
          <button
            onClick={onCycleTheme}
            title={`Theme: ${themeName} — tap to change`}
            aria-label={`Theme: ${themeName}. Change theme`}
            className="shrink-0 min-h-9 min-w-9 px-2 grid place-items-center rounded-full border border-line bg-surface2 text-ink3 hover:text-ink hover:border-ink3"
          >
            <span aria-hidden className="text-sm leading-none">{THEME_ICON[theme] || '🌗'}</span>
          </button>
        )}
      </header>
      <main id="main" className="flex-1 min-w-0 flex flex-col max-w-3xl w-full mx-auto">
        {children}
      </main>
      <nav className="sticky bottom-0 z-20 flex border-t border-line bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]" aria-label="Primary">
        {TABS.map(([id,label,icon])=> (
          <button key={id} onClick={()=> setTab(id)} aria-current={tab===id ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 min-h-14 text-[11px] font-semibold ${tab===id ? 'text-ink' : 'text-ink3 hover:text-ink2'}`}>
            <span aria-hidden className="text-[16px] leading-none">{icon}</span>{label}
            <span aria-hidden className={`h-0.5 rounded-full bg-ink transition-all ${tab===id ? 'w-7 opacity-100' : 'w-0 opacity-0'}`} />
          </button>
        ))}
      </nav>
    </div>
  );
}

