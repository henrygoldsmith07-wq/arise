import { useEffect, useState } from 'react';
import { loadStore, saveStore } from '../lib/store.js';

const TABS = [
  ['today','Today','🏠'],
  ['train','Train','🏋️'],
  ['exercises','Exercises','🔎'],
  ['progress','Progress','📈'],
  ['more','More','⋯'],
];

export default function AppShell({ children, tab, setTab, storeVersion }){
  const [storeTick, setStoreTick] = useState(0);
  useEffect(()=>{
    const onStorage = (e)=> { if(e.key==='arise.store.v1') setStoreTick(x=>x+1); };
    window.addEventListener('storage', onStorage);
    return ()=> window.removeEventListener('storage', onStorage);
  },[]);
  void storeTick; void storeVersion;
  return (
    <div className="min-h-dvh flex flex-col bg-bg text-ink">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 border-b border-line bg-surface/90 backdrop-blur">
        <img src="/logo.svg" alt="" width={28} height={28} className="rounded-lg" aria-hidden="true" />
        <span className="font-extrabold tracking-tight">Arise</span>
        <span className="text-xs text-ink3 hidden sm:inline">Training, levelled up.</span>
        <span className="ml-auto text-[11px] px-2 py-1 rounded-full bg-surface2 border border-line text-ink3">Offline-ready • No account</span>
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
