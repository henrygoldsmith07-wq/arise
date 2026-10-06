// GymModePanel.jsx — the Gym Mode user-facing pieces, extracted so the two
// runners share one implementation instead of drifting apart:
//
//   - LoadNumpad: a big-target numeric keypad for the load field with
//     equipment-aware quick-add buttons derived from the actual plates,
//     dumbbells or machine pin steps.
//   - swipeRowHandlers / WeightInput: the touch row primitives.
//
// RestDock moved to ./session/RestDock.jsx (re-exported below) so every
// presentation style can share it without importing a Gym-Mode module.
// Everything here is presentational + callback driven so SessionRunner and
// GuidedRunner keep owning their own state.

import { useEffect, useMemo, useState } from 'react';
import { quickJumps, applyQuickJump, adjacentLoad, restPresetFor } from '../lib/gymMode.js';
import { haptic } from '../lib/haptics.js';
import { weightInputToKg, weightInputValue } from '../lib/units.ts';

// ── Row gestures ────────────────────────────────────────────────────────────
// One-thumb set handling on the touch rows:
//   swipe right  → complete the set
//   swipe left   → mark it failed
//   long-press   → edit (opens the load keypad)
// Gestures never hijack the row's inputs: touches starting on an input,
// button or select are ignored, vertical scrolling always wins, and every
// gesture has a visible-button equivalent (Done / ✗ / keypad) so nothing is
// touch-only.
// Implementation note: deliberately hook-free. Rows are rendered in .map()
// loops and the runners re-render on a 500 ms clock tick, so closure/ref
// gesture state would be lost mid-drag. Gesture state rides on the row element
// itself (dataset + a module-level timer map), making it re-render-proof.
const gestureTimers = new WeakMap();

export function swipeRowHandlers({ onComplete, onFail, onLongPress, enabled = true }){
  const clearTimer = (el)=>{ const t = gestureTimers.get(el); if(t){ clearTimeout(t); gestureTimers.delete(el); } };

  const finish = (e, commit)=>{
    const el = e.currentTarget;
    clearTimer(el);
    const sx = el.dataset.swipeX;
    el.dataset.swipeX = '';
    el.style.transform = '';
    if(sx == null || sx === '' || !commit) return;
    const dx = e.clientX - Number(sx);
    if(Math.abs(dx) >= 72){ if(dx > 0) onComplete?.(); else onFail?.(); }
  };

  return {
    onPointerDown(e){
      if(!enabled) return;
      if(e.target.closest('input, select, button, textarea, a')) return;
      const el = e.currentTarget;
      el.dataset.swipeX = String(e.clientX);
      el.dataset.swipeY = String(e.clientY);
      el.dataset.swipeFired = '';
      clearTimer(el);
      gestureTimers.set(el, setTimeout(()=>{
        if(el.dataset.swipeFired) return;
        el.dataset.swipeFired = 'long';
        haptic('tap');
        onLongPress?.();
      }, 550));
    },
    onPointerMove(e){
      const el = e.currentTarget;
      if(el.dataset.swipeX == null || el.dataset.swipeX === '') return;
      const dx = e.clientX - Number(el.dataset.swipeX);
      const dy = e.clientY - Number(el.dataset.swipeY);
      if(Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      clearTimer(el);
      if(Math.abs(dy) > Math.abs(dx)){ el.dataset.swipeX = ''; el.style.transform = ''; return; }
      el.style.transform = `translateX(${Math.max(-110, Math.min(110, dx))}px)`;
      if(!el.dataset.swipeFired && Math.abs(dx) >= 72){ el.dataset.swipeFired = 'drag'; haptic('swipe') }
    },
    onPointerUp: (e)=> finish(e, true),
    onPointerLeave: (e)=> finish(e, false),
    onPointerCancel: (e)=> finish(e, false),
    style: { touchAction: 'pan-y' },
  };
}

// ── Unit-aware weight field ───────────────────────────────────────────────
// Keeps the user's transient display text ("13.", "13.5") separate from the
// canonical kg value emitted to the workout draft. Parent echoes of our own
// conversion do not clobber the in-progress text; external changes (apply
// recommendation, unit switch, restore) do resynchronise it.
export function WeightInput({ value, unit = 'kg', onChange, onBlur, ...props }){
  const [display,setDisplay]=useState(()=>weightInputValue(value,unit));
  useEffect(()=>setDisplay(weightInputValue(value,unit)),[value,unit]);
  return <input {...props} value={display} onChange={e=>setDisplay(e.target.value)}
    onBlur={e=>{ onChange?.(weightInputToKg(display,unit)); onBlur?.(e); }} />;
}

// ── LoadNumpad ──────────────────────────────────────────────────────────
// A dedicated numeric keypad for the load field. On a gym floor the OS
// keyboard covers half the screen and its decimal point is a precision
// instrument; this is thumb-sized digits, ± steps sized to the equipment, and
// a clear button — then it gets out of the way.

export function LoadNumpad({ value, onChange, onClose, equipment = 'barbell', plateConfig = null, exerciseName = '', unit = 'kg' }){
  const inc = useMemo(()=> {
    try{ return quickJumps({ equipment: [equipment], supportsWeighted: true, config: plateConfig }); }
    catch{ return []; }
  }, [equipment, plateConfig]);
  const [displayValue,setDisplayValue]=useState(()=>weightInputValue(value,unit));
  useEffect(()=>setDisplayValue(weightInputValue(value,unit)),[unit]);
  const emitDisplay=next=>{ setDisplayValue(next); onChange(weightInputToKg(next,unit)); };
  const emitCanonical=next=>{ setDisplayValue(weightInputValue(next,unit)); onChange(next); };
  const formatDelta = kg=> `${Number(kg)<0?'−':'+'}${weightInputValue(Math.abs(Number(kg)||0), unit)}`;
  const press = (key)=>{
    if(key === 'clear') return emitDisplay('');
    const current = String(displayValue ?? '');
    let next = current;
    if(key === '.') next = current.includes('.') ? current : (current === '' ? '0.' : current + '.');
    else if(key === '⌫') next = current.slice(0, -1);
    else {
      // Cap at a sane length so a pocket touch can't type a 12-digit load.
      if(current.replace(/[^0-9]/g, '').length >= 4) return;
      next = current + key;
    }
    emitDisplay(next);
  };

  const step = (dir)=>{
    const next = adjacentLoad(value || 0, dir, { equipment, config: plateConfig });
    emitCanonical(next);
  };

  return (
    <div className="rounded-2xl border border-line bg-surface2 p-3 space-y-2" role="group" aria-label={`Load keypad${exerciseName ? ` for ${exerciseName}` : ''}`}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-ink3">Load {unit}</span>
        <span className="ml-auto text-2xl font-black tabular-nums">{displayValue || '—'}</span>
        <button onClick={onClose} className="min-h-11 px-3 rounded-full border border-line bg-surface text-xs font-bold">Done</button>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {inc.map(j=> (
          <button key={j.id} onClick={()=> emitCanonical(applyQuickJump(value, j, { equipment, config: plateConfig }))}
            className="min-h-11 rounded-xl border border-line bg-surface text-sm font-black tabular-nums active:bg-surface2">
            {formatDelta(j.delta)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {['7','8','9'].map(k=> <NumpadKey key={k} label={k} onPress={press} />)}
        {['4','5','6'].map(k=> <NumpadKey key={k} label={k} onPress={press} />)}
        {['1','2','3'].map(k=> <NumpadKey key={k} label={k} onPress={press} />)}
        <NumpadKey label="." onPress={press} />
        <NumpadKey label="0" onPress={press} />
        <NumpadKey label="⌫" onPress={press} ariaLabel="Delete last digit" />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <button onClick={()=> step(-1)} className="min-h-12 rounded-xl border border-line bg-surface text-sm font-black active:bg-surface2">− step</button>
        <button onClick={()=> press('clear')} className="min-h-12 rounded-xl border border-line bg-surface text-sm font-black active:bg-surface2">Clear</button>
        <button onClick={()=> step(1)} className="min-h-12 rounded-xl border border-line bg-surface text-sm font-black active:bg-surface2">+ step</button>
      </div>
    </div>
  );
}

function NumpadKey({ label, onPress, ariaLabel }){
  return (
    <button onClick={()=> onPress(label)} aria-label={ariaLabel || label}
      className="min-h-12 rounded-xl border border-line bg-surface text-xl font-black tabular-nums active:bg-surface2">
      {label}
    </button>
  );
}

// ── RestDock ────────────────────────────────────────────────────────────────
// The rest countdown. Owns nothing: `endsAt`/`label` come from the runner so
// the countdown survives re-renders and crash recovery exactly as before.
// Adds on top of the old dock:
//   - per-exercise preset chips (persisted via onSetRestPreset)
//   - a voice announcement of the remaining time (off by default)
//   - a mini mode: a compact pill so the session stays scrollable while the
//     clock runs, with a tap to expand.

// RestDock moved to ./session/RestDock.jsx (it serves every presentation
// style, not only Gym Mode). Re-exported here so the established import
// path keeps working — public API unchanged.
export { RestDock } from './session/RestDock.jsx';
