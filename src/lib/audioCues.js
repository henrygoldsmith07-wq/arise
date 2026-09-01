// audioCues.js — Web Audio cue player for the guided runner's rest countdown.
// Lazy, gesture-safe AudioContext (first cue fires from a click handler), with
// every call guarded so missing/unsupported audio can never break a workout.

let ctx = null;

function getCtx(){
  if(typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if(!AC) return null;
  try{
    if(!ctx) ctx = new AC();
    if(ctx.state === 'suspended') ctx.resume().catch(()=>{});
    return ctx;
  }catch{ return null; }
}

function tone(ctx, { freq = 880, durationMs = 120, volume = 0.15, delayMs = 0 }){
  const t0 = ctx.currentTime + delayMs / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000 + 0.05);
}

// One low tone: rest has started.
export function restStartCue(){
  try{ const c = getCtx(); if(c) tone(c, { freq: 660, durationMs: 150 }); }catch{}
}

// Short tick for the 3-2-1 countdown.
export function restTickCue(){
  try{ const c = getCtx(); if(c) tone(c, { freq: 880, durationMs: 90, volume: 0.12 }); }catch{}
}

// Rising two-tone: rest is over, next set.
export function restCompleteCue(){
  try{
    const c = getCtx(); if(!c) return;
    tone(c, { freq: 880, durationMs: 140 });
    tone(c, { freq: 1320, durationMs: 220, delayMs: 160 });
  }catch{}
}
