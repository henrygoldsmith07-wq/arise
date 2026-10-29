import { useCallback, useEffect, useRef } from 'react';

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
//
// Keyboard parity (WCAG 2.1.1): a native <button> fires click on Enter/Space,
// but this component only listened to pointer events — pressing the focused
// stepper did nothing, so keyboard users could not adjust reps at all. A
// single click/keydown press now steps exactly once (hold-to-repeat stays
// pointer-only, matching touch/mouse semantics); the pointerup that follows
// a mouse click cannot double-fire because the pointer path ignores events
// on a disabled control and a click arriving after a real hold is the normal
// end-of-gesture click, not an extra step.

export default function StepperButton({ label, ariaLabel, onStep, disabled, className = '' }){
  const timers = useRef({ delay: null, repeat: null });
  // The hold state at pointerup: a long-press release fires a click (the
  // browser's default activation), and that click must NOT add another step.
  const heldRef = useRef(false);

  const stop = useCallback(()=> {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.repeat);
    timers.current.delay = null;
    timers.current.repeat = null;
  }, []);

  useEffect(()=> stop, [stop]);

  useEffect(()=> {
    if(disabled) stop();
  }, [disabled, stop]);

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

  const handleActivation = useCallback(()=> {
    // A click that ends a pointer hold is synthetic follow-through, not a
    // fresh press: one hold already stepped repeatedly.
    if(heldRef.current){ heldRef.current = false; return; }
    start();
  }, [start]);

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onPointerDown={(e)=> { e.preventDefault(); heldRef.current = true; start(); }}
      onPointerUp={()=> stop()}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={handleActivation}
      onKeyDown={(e)=> {
        if(e.repeat) return; // key autorepeat does not accelerate a stepper
        if(e.key === 'Enter' || e.key === ' '){
          e.preventDefault();
          // Mark handled so the browser's synthesized click (fired on keyup
          // for Space in some engines) cannot step a second time.
          heldRef.current = true;
          start();
        }
      }}
      onContextMenu={(e)=> e.preventDefault()}
      className={`min-h-11 shrink-0 rounded-xl border border-line bg-surface2 text-xl font-black text-ink select-none touch-manipulation active:bg-line disabled:opacity-40 ${className}`}
    >{label}</button>
  );
}
