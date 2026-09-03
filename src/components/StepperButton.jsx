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

export default function StepperButton({ label, ariaLabel, onStep, disabled, className = '' }){
  const timers = useRef({ delay: null, repeat: null });

  const stop = useCallback(()=> {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.repeat);
    timers.current.delay = null;
    timers.current.repeat = null;
  }, []);

  useEffect(()=> stop, [stop]);

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
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e)=> e.preventDefault()}
      className={`min-h-11 shrink-0 rounded-xl border border-line bg-surface2 text-xl font-black text-ink select-none touch-manipulation active:bg-line disabled:opacity-40 ${className}`}
    >{label}</button>
  );
}
