# Accessibility statement

Arise aims to be usable by as many people as a browser app can be. This
page states what is done, how it is tested, and what is known to fall
short. The audit trail and decisions live in ADR 0009.

## Conformance target

WCAG 2.2, level AA, as a working target applied to a training context —
bright gym lighting, sweaty hands, one-thumb use between sets. This is not
a certified conformance claim; it is an audited, tested, honest-in-progress
statement.

## What is built in

- **Keyboard:** every control reachable; visible `:focus-visible` rings
  everywhere (a dialog never leaves you focus-less); skip link to main
  content; no keyboard traps, including inside dialogs (focus is trapped
  while open and restored to the trigger on close).
- **Screen readers:** landmark structure (`header`/`nav`/`main` labelled),
  accessible names on all controls, charts carry text alternatives and
  data-table equivalents, status changes announced through **one throttled
  live region** (a per-second countdown never spams the SR queue), rest
  announcements are polite.
- **Voice coach arbitration:** spoken cues are suppressed while a screen
  reader is active so the two voices never fight.
- **Gestures have buttons:** swipe-to-complete and swipe-to-fail always
  have equivalent large buttons; nothing is gesture-only.
- **Motion:** `prefers-reduced-motion` honoured everywhere, plus a manual
  reduce-motion setting; nothing essential is conveyed by animation alone.
- **Contrast and theming:** dark, light and high-contrast modes; large-text
  setting; color-blind-safe status uses shape/text alongside color; errors
  are never color-only.
- **Touch:** ≥44 px targets across the runner and rest dock; Gym Mode
  exists precisely for one-thumb, no-look operation.

## How it is tested

- Automated e2e assertions for landmarks, labels, focus order, live-region
  throttling and dialog focus management.
- Keyboard-only pass through every surface in CI e2e.
- Manual device checks (VoiceOver, TalkBack) are tracked in
  `docs/device-test-matrix.md` — the honest gap, since automation cannot
  hear a screen reader.

## Known shortcomings

- Illustration-only exercise depictions have text titles and instructions,
  but the illustrations themselves are decorative — muscle emphasis is
  conveyed in text.
- Charts are text-alternatived, not fully screen-reader-explored data
  visualisations.
- iOS haptics are a platform impossibility (no Vibration API), not an
  accessibility choice.

## Feedback

Accessibility regressions are bugs: file them like any other issue and
they get triaged the same way.
