// useRestTimer.js — the one rest-timer contract shared by every workout
// presentation style (Standard, Focus, Guided).
//
// Both runners had identical rest behaviour: a countdown anchored to a wall-
// clock `endsAt`, 3-2-1 tick cues (once per remaining second, never twice),
// and expiry that clears the countdown and fires the completion cue + haptic +
// announcement. This module owns that behaviour in two layers:
//   - pure decision functions (planRestTick, restActiveState) — fully testable
//     with no React and no DOM;
//   - useRestTimer, the React binding that wires them to clock updates.
//
// Behaviour is deliberately unchanged from the pre-extraction code: crash
// drafts persist `restEndsAt`/`restLabel`/`restExerciseId` exactly as before.

import { useCallback, useEffect, useRef, useState } from 'react';
import { restCompleteCue, restTickCue } from '../lib/audioCues.js';
import { haptic } from '../lib/haptics.js';
import { announce } from '../lib/a11y.js';

// Which tick (if any) to cue now. Ticks fire once per remaining second in the
// 3-2-1 window; `lastTick` prevents the same second being cued twice as the
// clock re-renders. Returns the new lastTick value alongside the decision.
export function planRestTick(endsAt, nowMs, lastTick, soundOn){
  if(!endsAt) return { cue:false, lastTick:null };
  const left = Math.ceil((endsAt - nowMs) / 1000);
  if(left >= 1 && left <= 3 && lastTick !== left){
    return { cue: soundOn !== false, lastTick:left };
  }
  return { cue:false, lastTick:left >= 1 && left <= 3 ? left : lastTick };
}

// Countdown + expiry state, wall-clock anchored (never interval-counted), so
// a backgrounded tab or a pause mid-set cannot desynchronise the timer.
export function restActiveState(endsAt, nowMs){
  if(!endsAt) return { active:false, left:null, expired:false };
  const expired = endsAt <= nowMs;
  return { active: !expired, left: Math.max(0, Math.ceil((endsAt - nowMs) / 1000)), expired };
}

export function useRestTimer({ clock, initial, onExpire = null, soundOn = true, spoken = false, expiryHaptic = 'restComplete', appAnnounce = true, tickCues = true } = {}){
  const [restEndsAt, setRestEndsAt] = useState(()=> initial?.restEndsAt || null);
  const [restLabel, setRestLabel] = useState(()=> initial?.restLabel || '');
  const [restExerciseId, setRestExerciseId] = useState(()=> initial?.restExerciseId || null);
  const [announcement, setAnnouncement] = useState('');
  const tickRef = useRef(null);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const { active, left } = restActiveState(restEndsAt, clock);

  // 3-2-1 ticks: one cue per remaining second, never repeated for the same
  // second. Haptic accompanies the cue so silent-mode users still get it.
  // `tickCues` is a per-presentation choice: Guided counts down aloud, the
  // standard runner has always stayed quiet during rest — both contracts are
  // preserved exactly by the shared core.
  useEffect(()=>{
    if(!tickCues){ tickRef.current = null; return; }
    const plan = planRestTick(restEndsAt, Date.now(), tickRef.current, soundOn);
    tickRef.current = plan.lastTick;
    if(plan.cue){ restTickCue(); haptic('guidedStep'); }
  }, [clock, restEndsAt, soundOn, tickCues]);

  // Expiry: clear the countdown and announce once. The haptic and whether the
  // app-level announcer carries the message are per-presentation choices —
  // Guided used a distinct triple-pulse and its own live region, and that
  // behaviour is preserved exactly.
  useEffect(()=>{
    const state = restActiveState(restEndsAt, Date.now());
    if(state.expired){
      setRestEndsAt(null);
      setAnnouncement('Rest complete — next set.');
      if(appAnnounce) announce('Rest complete — next set.', { key: 'rest-timer', spoken });
      haptic(expiryHaptic);
      if(soundOn !== false) restCompleteCue();
      onExpireRef.current?.();
    }
  }, [restEndsAt, clock, soundOn, spoken, expiryHaptic, appAnnounce]);

  const startRest = useCallback((seconds, label, exerciseId = null)=>{
    const sec = Number(seconds) || 0;
    if(sec <= 0){ setRestEndsAt(null); return; }
    tickRef.current = null;
    setRestLabel(label || '');
    setRestExerciseId(exerciseId);
    setRestEndsAt(Date.now() + sec * 1000);
  }, []);

  const clearRest = useCallback(()=>{
    tickRef.current = null;
    setRestEndsAt(null);
  }, []);

  return {
    restEndsAt, setRestEndsAt,
    restLabel, restExerciseId,
    restLeft: active ? left : null,
    announcement, setAnnouncement,
    startRest, clearRest,
  };
}
