// a11y.js — shared accessibility helpers.
//
// Two problems this module owns:
//
//   1. Live-region spam. A rest countdown re-renders every second; a naive
//      aria-live region re-announces every render, and screen readers queue
//      the backlog — an unusable wall of "47 seconds… 46 seconds…". The
//      announcer here collapses that: per-key dedupe (the same message is
//      never announced twice in a row), a minimum interval per key (minute
//      marks, not ticks), and a global cap so bursts queue as one.
//
//   2. Dialog focus. Modals trapped Tab but never gave focus back, so closing
//      a session runner left keyboard users at <body>. useDialogA11y captures
//      the opener on mount, traps Tab inside the dialog, and restores focus
//      on close. It is the pattern SessionRunner/GuidedRunner already wired
//      by hand, extracted so every dialog gets it.

import { useEffect, useRef } from 'react';

const MIN_PER_KEY_MS = 2000;   // same key: at most one announcement per 2s
const MIN_GLOBAL_MS = 800;     // across all keys: throttle bursts to one

// Pure scheduling core (unit-testable without a DOM): `createAnnouncerState`
// + `planAnnouncement` decide WHAT gets announced; the LiveAnnouncer shell
// renders it. Two gates:
//   - an identical repeat is suppressed until the per-key window (2s) has
//     elapsed since its announcement — but IS re-announced later (rest rounds
//     legitimately repeat "2 minutes remaining" across exercises),
//   - different text is suppressed only inside a global burst window (800ms),
//     so rapid UI churn settles into one announcement instead of a queue.
export function createAnnouncerState(){
  return { lastGlobal: 0, lastByKey: new Map(), lastMessage: '' };
}

// Returns the message to render into the live region, or '' to keep the
// previous one (rendering '' clears a live region — the caller keeps the old
// text instead so SR users never hear a cut-off sentence).
export function planAnnouncement(state, message, { key = 'default' } = {}, now = Date.now){
  if(!message) return '';
  const t = now();
  if(message === state.lastMessage){
    if(t - (state.lastByKey.get(key) || 0) < MIN_PER_KEY_MS) return '';
  } else if(t - state.lastGlobal < MIN_GLOBAL_MS){
    return '';
  }
  state.lastGlobal = t;
  state.lastByKey.set(key, t);
  state.lastMessage = message;
  return message;
}

// App binding: the app mounts exactly one <LiveAnnouncer/> (components/),
// which registers the render sink below; any component calls announce(text,
// { key, spoken }) through this module queue, keeping call sites free of
// context plumbing. `spoken` marks announcements a voice coach takes over —
// the screen reader does not repeat text the user explicitly asked to hear
// aloud (voice and SR read the same pane without double-speaking).
const announcerState = createAnnouncerState();
let sink = ()=> {};

export function announce(message, { key = 'default', spoken = false } = {}){
  const planned = planAnnouncement(announcerState, message, { key });
  if(!planned) return;
  sink(planned, spoken);
}

export function setLiveSink(fn){ sink = typeof fn === 'function' ? fn : ()=> {}; }

export function _resetAnnouncerForTests(){
  const fresh = createAnnouncerState();
  announcerState.lastGlobal = fresh.lastGlobal;
  announcerState.lastByKey.clear();
  announcerState.lastMessage = '';
}

// ── Dialog focus management ─────────────────────────────────────────────────
// Trap Tab within the dialog root, focus the close control on open, and hand
// focus back to whoever opened it on close.

// Pure Tab-wrap decision (unit-testable): given the dialog's focusable
// elements and the active element, should Tab wrap, and to where?
export function focusTrapDecision(focusables, activeElement, shiftKey){
  if(!focusables || !focusables.length) return null;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if(shiftKey && activeElement === first) return 'last';
  if(!shiftKey && activeElement === last) return 'first';
  return null;
}

export function useDialogA11y({ active = true } = {}){
  const rootRef = useRef(null);
  const closeRef = useRef(null);
  const restoreRef = useRef(null);

  useEffect(()=>{
    if(!active) return;
    restoreRef.current = document.activeElement;
    if(closeRef.current) closeRef.current.focus();
    return ()=> {
      const el = restoreRef.current;
      if(el && typeof el.focus === 'function'){
        try{ el.focus({ preventScroll: true }); }catch{ el.focus(); }
      }
    };
  }, [active]);

  const trapTab = (e)=>{
    if(e.key !== 'Tab' || !rootRef.current) return;
    const focusables = rootRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const wrap = focusTrapDecision([...focusables], document.activeElement, e.shiftKey);
    if(wrap === 'first'){ e.preventDefault(); focusables[0].focus(); }
    else if(wrap === 'last'){ e.preventDefault(); focusables[focusables.length - 1].focus(); }
  };

  return { rootRef, closeRef, trapTab };
}
