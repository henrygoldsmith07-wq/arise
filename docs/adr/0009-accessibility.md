# ADR 0009 — Accessibility: one throttled live region, voice/SR arbitration, and shared dialog focus

Date: 2026-09-04 · Status: accepted

## Context

The WCAG-oriented audit found the same failure classes in several places:
live regions re-rendering per-second countdown text (screen readers queue the
backlog — "47 seconds… 46 seconds…" is unusable), dialogs that trapped Tab
but never restored focus on close, keyboard focus made invisible by Tailwind's
outline defaults, and no reduced-motion handling despite animation classes in
the stylesheet. The voice coach and the screen reader also both announced
guided steps, so a voice-coach user heard everything twice.

## Decision

1. **One polite live region per app** (`components/LiveAnnouncer.jsx`), fed by
   a module-level queue (`lib/a11y.js announce()`). The scheduling core is
   pure and unit-tested: identical repeats are suppressed for 2s per key but
   re-announced later (rest rounds repeat legitimately), and rapid bursts of
   different text collapse into one announcement (800ms global window).
   Component-owned live regions that interpolated per-second values were
   rewritten to use it.

2. **Voice takes over when asked.** Announcements carry `spoken: true` when
   the voice coach says the same text; LiveAnnouncer mutes those so TTS and
   the screen reader never double-read. When voice is off, the same texts
   reach the live region instead — SR users get step changes either way.

3. **Dialog focus is shared, not per-component** (`useDialogA11y`): capture
   the opener on mount, focus the close control, trap Tab (pure
   `focusTrapDecision` for tests), restore focus on close. The session
   runners already had half of this by hand; Onboarding and the template
   builder now get all of it.

4. **CSS accessibility layer** in `index.css`: a global `:focus-visible` ring
   (keyboard-only, both themes), reduced-motion kill-switch for the in-app
   preference *and* `prefers-reduced-motion`, `forced-colors` hardening, and
   large-text bumps for the smallest annotation type.

5. **Gestures keep button parity** (WCAG 2.5.6/2.1.1): the swipe-left
   "failed" action gains a real toggle button; long-press already had the
   keypad button. The e1RM chart is `aria-hidden` with a text summary and an
   sr-only data table instead. An accessibility statement ships in
   More → Help, including known gaps (manual-only SR testing).

## Consequences

`announce()` requires the LiveAnnouncer to be mounted to be audible (it is,
app-wide, from boot). New interactive surfaces should reach for
`useDialogA11y` and `announce()` first; ad-hoc aria-live spans are a review
flag. The 2s per-key window bounds how chatty any feature can be without
coordination.
