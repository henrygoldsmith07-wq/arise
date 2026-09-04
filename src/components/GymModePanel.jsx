// GymModePanel.jsx — the Gym Mode user-facing pieces, extracted so the two
// runners share one implementation instead of drifting apart:
//
//   - RestDock: the rest countdown with per-exercise presets, voice
//     announcements, fine ± adjustments, and a mini mode (compact pill) for
//     scrolling the session while the clock runs.
//   - LoadNumpad: a big-target numeric keypad for the load field with
//     equipment-aware quick-add buttons derived from the actual plates,
//     dumbbells or machine pin steps.
//
// Both are presentational + callback driven so SessionRunner and GuidedRunner
// keep owning their own state.

import { useEffect, useMemo, useRef, useState } from 'react';
import { quickJumps, applyQuickJump, adjacentLoad, REST_PRESET_CHOICES, restPresetFor } from '../lib/gymMode.js';
import { speak, voiceSupported } from '../lib/voiceCoach.js';
import { fmtRest } from '../lib/guidedMode.js';
import { announce } from '../lib/a11y.js';
import { haptic } from '../lib/haptics.js';

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

// ── LoadNumpad ──────────────────────────────────────────────────────────
// A dedicated numeric keypad for the load field. On a gym floor the OS
// keyboard covers half the screen and its decimal point is a precision
// instrument; this is thumb-sized digits, ± steps sized to the equipment, and
// a clear button — then it gets out of the way.

export function LoadNumpad({ value, onChange, onClose, equipment = 'barbell', plateConfig = null, exerciseName = '' }){
  const inc = useMemo(()=> {
    try{ return quickJumps({ equipment: [equipment], supportsWeighted: true, config: plateConfig }); }
    catch{ return []; }
  }, [equipment, plateConfig]);

  const press = (key)=>{
    if(key === 'clear') return onChange('');
    const current = String(value ?? '');
    if(key === '.') return onChange(current.includes('.') ? current : (current === '' ? '0.' : current + '.'));
    if(key === '⌫') return onChange(current.slice(0, -1));
    // Cap at a sane length so a pocket touch can't type a 12-digit load.
    if(current.replace(/[^0-9]/g, '').length >= 4) return;
    onChange(current + key);
  };

  const step = (dir)=>{
    const next = adjacentLoad(value || 0, dir, { equipment, config: plateConfig });
    onChange(next);
  };

  return (
    <div className="rounded-2xl border border-line bg-surface2 p-3 space-y-2" role="group" aria-label={`Load keypad${exerciseName ? ` for ${exerciseName}` : ''}`}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-ink3">Load kg</span>
        <span className="ml-auto text-2xl font-black tabular-nums">{value || '—'}</span>
        <button onClick={onClose} className="min-h-9 px-3 rounded-full border border-line bg-surface text-xs font-bold">Done</button>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {inc.map(j=> (
          <button key={j.id} onClick={()=> onChange(applyQuickJump(value, j, { equipment, config: plateConfig }))}
            className="min-h-11 rounded-xl border border-line bg-surface text-sm font-black tabular-nums active:bg-surface2">
            {j.label}
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

export function RestDock({ endsAt, clock, label, onChange, exerciseId, exerciseName = '', presetSeconds = null, gymPrefs = null, onSetRestPreset = null, voiceRate = 1 }){
  const [mini, setMini] = useState(false);
  const [voiceRest, setVoiceRest] = useState(false);
  const spokenMinuteRef = useRef(null);

  const left = endsAt ? Math.max(0, Math.ceil((endsAt - clock) / 1000)) : 0;
  const adjust = (delta)=> onChange(Math.max(Date.now() + 5000, (endsAt || Date.now()) + delta * 1000));

  const say = ()=>{
    if(!voiceSupported() || !left) return;
    const m = Math.floor(left / 60), r = left % 60;
    const phrase = m ? `${m} minute${m === 1 ? '' : 's'}${r ? ` ${r} seconds` : ''} remaining` : `${r} seconds remaining`;
    speak(`${phrase}. ${label ? `Next: ${label}.` : ''}`, voiceRate);
  };

  // Minute markers: spoken once each when voice announcements are on, and
  // always mirrored to the app's polite live region when they are OFF —
  // screen-reader users get the same "2 minutes remaining…" cadence without
  // the countdown's per-second ticks (the announcer dedupes and throttles;
  // voice-on users skip the SR copy so the two channels never double-speak).
  useEffect(()=>{
    if(!endsAt){ spokenMinuteRef.current = null; return; }
    const mark = Math.ceil(left / 60);
    if(left > 0 && left % 60 === 0 && spokenMinuteRef.current !== mark){
      spokenMinuteRef.current = mark;
      const m = Math.floor(left / 60);
      const phrase = m === 1 ? '1 minute remaining' : `${m} minutes remaining`;
      if(voiceRest){
        say();
      } else {
        announce(`${phrase}. ${label ? `Next: ${label}.` : ''}`, { key: 'rest-timer' });
      }
    }
  }, [clock, endsAt, voiceRest, left]);

  if(mini){
    return (
      <button onClick={()=> setMini(false)} aria-label={`Rest timer mini: ${fmtRest(left)} remaining. Expand`}
        className="w-full max-w-3xl mx-auto rounded-full bg-ink text-bg px-4 py-2 flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">Rest</span>
        <span className="text-lg font-black tabular-nums leading-none" aria-live="off">{fmtRest(left)}</span>
        <span className="text-[11px] truncate opacity-80">{label}</span>
        <span className="ml-auto text-[10px] font-bold opacity-70">expand ▲</span>
      </button>
    );
  }

  return (
    <div className="rounded-2xl bg-ink text-bg px-4 py-3 space-y-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-70 leading-none">Rest</p>
          <p className="text-xs font-bold truncate opacity-80">{label}</p>
        </div>
        <span className="ml-auto text-4xl font-black tabular-nums leading-none" aria-live="off">{fmtRest(left)}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {voiceSupported() && (
            <button onClick={say} aria-label="Speak remaining rest time" className="min-h-11 min-w-11 px-1.5 rounded-full bg-bg/15 text-sm leading-none">🗣️</button>
          )}
          <button onClick={()=> setVoiceRest(v=> !v)} aria-pressed={voiceRest} aria-label={voiceRest ? 'Rest voice announcements on' : 'Rest voice announcements off'}
            title="Announce each minute aloud" className={`min-h-11 min-w-11 px-1.5 rounded-full text-sm leading-none ${voiceRest ? 'bg-bg text-ink' : 'bg-bg/15'}`}>🔁</button>
          <button onClick={()=> setMini(true)} aria-label="Shrink rest timer" className="min-h-11 min-w-11 px-1.5 rounded-full bg-bg/15 text-sm leading-none">▼</button>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={()=> adjust(-15)} aria-label="Rest 15 seconds less" className="min-h-11 min-w-11 px-1.5 rounded-full bg-bg/15 text-xs font-bold tabular-nums">−15s</button>
        <button onClick={()=> adjust(-60)} aria-label="Rest 1 minute less" className="min-h-11 min-w-11 px-1.5 rounded-full bg-bg/15 text-xs font-bold tabular-nums">−1m</button>
        <button onClick={()=> adjust(30)} aria-label="Rest 30 seconds more" className="min-h-11 min-w-11 px-1.5 rounded-full bg-bg/15 text-xs font-bold tabular-nums">+30s</button>
        <button onClick={()=> adjust(60)} aria-label="Rest 1 minute more" className="min-h-11 min-w-11 px-1.5 rounded-full bg-bg/15 text-xs font-bold tabular-nums">+1m</button>
        <button onClick={()=> onChange(null)} aria-label="Skip rest" className="min-h-11 px-3 rounded-full bg-bg text-ink text-xs font-bold">Skip</button>
        {REST_PRESET_CHOICES.map(sec=> (
          <button key={sec}
            onClick={()=>{
              onChange(Date.now() + sec * 1000);
              if(onSetRestPreset && exerciseId) onSetRestPreset(exerciseId, sec);
            }}
            aria-pressed={presetSeconds === sec}
            className={`min-h-9 px-2.5 rounded-full text-[11px] font-bold tabular-nums ${presetSeconds === sec ? 'bg-bg text-ink' : 'bg-bg/15'}`}>
            {sec < 60 ? `${sec}s` : `${sec / 60}m`}
          </button>
        ))}
      </div>
      {onSetRestPreset && exerciseId && (
        <p className="text-[10px] opacity-60">Tapping a preset also remembers it for this exercise ({exerciseName || exerciseId}).</p>
      )}
    </div>
  );
}
