import { useEffect, useId, useRef, useState } from 'react';
import { glossaryEntry } from '../lib/glossary.js';

// Tap-to-explain "?" for training jargon. 44px target, Esc/outside-tap closes.
export default function JargonHelp({ term }){
  const entry = glossaryEntry(term);
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef(null);
  useEffect(()=>{
    if(!open) return undefined;
    const onKey = e => { if(e.key==='Escape') setOpen(false); };
    const onDown = e => { if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return ()=>{ document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open]);
  if(!entry) return null;
  return (
    <span ref={ref} className="relative inline-block">
      <button type="button" aria-expanded={open} aria-controls={id} aria-label={`What is ${entry.title}?`} onClick={()=> setOpen(o=>!o)} className="min-h-11 min-w-11 inline-grid place-items-center text-xs font-black text-ink3">?</button>
      {open && <span id={id} role="note" className="absolute z-20 left-0 top-full w-64 rounded-xl border border-line bg-surface p-3 text-xs text-ink shadow-lg"><b>{entry.title}</b><br/>{entry.body}</span>}
    </span>
  );
}
