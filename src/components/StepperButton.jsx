import { useCallback, useEffect, useRef } from 'react';
import { isKeyboardActivation } from '../lib/a11y.js';

// StepperButton — a −/+ control built for one thumb and a sweaty palm.
//
// Set logging happens between sets, breathing hard, phone on the floor: every
// tap is deliberate and slow. The load/reps inputs are big, but adjusting a
// value by ±2.5 kg means tapping a tiny edge of the number keyboard — or
// typing it. A stepper covers the common case with the whole screen as a
// target: one tap = one step, press-and-hold = accelerating repeats.
//
// Hold-to-repeat: after a 450ms delay the value starts stepping every 220ms,
// then every 90ms after 8 repeats — one hold walks from 60 to 80 kg without
// a keyboard. Pointer events (not click) so it works with finger, stylus and
// mouse alike; cleanup on unmount so a hold that outlives the set's row
// cannot keep stepping a ghost.

export default function StepperButton({ label, ariaLabel, onStep, disabled, className = '' }){
  const timers = useRef({ delay: null, repeat: null });

  const stop = useCallback(()=> {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.repeat);
    timers.current.delay = null;
    timers.current.repeat = null;
  }, []);

  useEffect(()=> stop, [stop]);

  // Pointer users step on pointerdown (immediate feedback, hold-to-repeat).
  // Keyboard/AT users only produce a click, so without this mirror the button
  // was focusable but inert (WCAG 2.1.1). A keyboard activation is exactly one
  // step: start() would arm the hold-to-repeat timer with no pointerup to stop
  // it. Pointer clicks (detail >= 1) are ignored here because pointerdown
  // already stepped them.
  const stepFromKeyboard = useCallback((e)=> {
    if(!isKeyboardActivation(e)) return;
    stop();
    if(!disabled) onStep();
  }, [disabled, onStep, stop]);

  const start = useCallback(()=> {
    if(disabled) return;
    onStep();
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.repeat);
    let count = 0;
    timers.current.delay = setTimeout(()=> {
      timers.current.repeat = setInterval(()=> {
        count += 1;
        onStep();
        if(count === 8){
          clearInterval(timers.current.repeat);
          timers.current.repeat = setInterval(onStep, 90);
        }
      }, 220);
    }, 450);
  }, [disabled, onStep]);

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onPointerDown={(e)=> { e.preventDefault(); start(); }}
      onClick={stepFromKeyboard}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e)=> e.preventDefault()}
      className={`min-h-11 shrink-0 rounded-lg border border-line bg-surface2 text-xl font-black text-ink select-none touch-manipulation active:bg-line disabled:opacity-40 ${className}`}
    >{label}</button>
  );
}
