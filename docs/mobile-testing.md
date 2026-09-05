# Mobile testing checklist

The 30-second pass anyone can run on a real phone — plus the deeper matrix
maintainers use. The full per-device, per-browser matrix lives in
`docs/device-test-matrix.md`; this page is the public, human version.

## Quick pass (any phone, ~2 minutes)

1. **Install:** Add to Home Screen → opens standalone, own icon, correct
   splash, status bar looks right.
2. **Offline:** airplane mode → reload → Today/Exercises render; log a full
   session offline; data still there when the network returns.
3. **Log a session:** touch targets comfortably tappable one-handed; rest
   timer counts, announces, and survives scrolling to another exercise.
4. **Persistence:** force-close the app mid-session → reopen → the workout
   draft is offered back (crash recovery).
5. **Export/Import:** export the backup; import it with Merge; history
   count is unchanged and nothing duplicated.
6. **Theme:** system dark ↔ light — no invisible text or lost illustrations
   in either.

## Deeper pass (before any release)

- **iOS:** Safari-only install; iPad masquerade steps; no-vibration honest
  state; safe areas with the notch; background-tab rest throttling
  behaviour.
- **Low-end Android:** boot and session-start times feel acceptable;
  haptics fire; history pagination doesn't jank.
- **In-app browsers:** Instagram/Facebook shells show the "open in your
  browser first" guidance rather than a broken install button.
- **Keyboard/screen reader:** Tab through Today → Train → Exercises with
  no trap; VoiceOver/TalkBack announces headings, session rows, form
  fields.
- **Keyboard-only on desktop with a phone-sized window:** every control
  reachable, focus visible.

Found something? `CONTRIBUTING.md` → filing issues. Fixed something?
The checklist pages are docs — PRs welcome.
