# PWA test matrix & install verification checklist

Real-device checks for the PWA surface. The automated e2e suite (Playwright,
Chromium + emulated mobile Chrome) covers logic; this matrix covers what only
real OS/browser combinations reveal — install flows, splash rendering, safe
areas, haptics, and standalone quirks.

## Test matrix

| # | Device class | Browser | What to verify |
|---|---|---|---|
| 1 | iPhone (iOS 17+, Face ID, Dynamic Island) | Safari | iOS install flow below; splash (dark+light); status-bar inset; share sheet from Coach export; no vibration (expected) |
| 2 | iPhone SE class (small screen, Touch ID) | Safari | Same as #1 on a 4.7" viewport — bottom nav + safe-area, smallest splash |
| 3 | iPad (iPadOS) | Safari | Desktop-masquerading UA → iOS instructions still shown; layout at tablet width |
| 4 | Android flagship (Pixel/Galaxy) | Chrome | One-tap install prompt; home-screen shortcut icons ("Start workout", "Quick log"); haptics on set log/rest; manifest installability (chrome://webapptools) |
| 5 | **Low-end Android** (e.g. 2 GB RAM, Android Go) | Chrome | Cold boot < 3 s on 3G-slow; offline shell load; SW update banner doesn't jank; boot chunk ≤ budget on throttled CPU |
| 6 | Android in-app browser (Instagram DM link) | In-app | Install card shows "open in your browser first" guidance |
| 7 | Desktop | Chrome / Edge | Install icon in omnibox; prompt → standalone window; keyboard nav intact |
| 8 | iOS Safari **PWA edge cases** (installed app) | Safari standalone | Session starts offline → airplane mode → rest timer, audio cues, wake lock survive; state restore after iOS kills the backgrounded app; smart-invert/zoom interplay |

## iOS install instructions (expected flow, device #1–3)

1. Open the site in **Safari** (not Chrome — Chrome on iOS cannot install).
2. Tap **Share** (□↑).
3. Scroll → **Add to Home Screen** → **Add**.
4. Launch from the home screen icon: splash shows, then the app in
   standalone (no browser chrome, status bar inset applied).

## Android install instructions (device #4–5)

1. Visit the site; Chrome shows the **Install app** banner (or ⋮ → *Install app*).
2. Confirm — the app lands on the home screen with the maskable icon.
3. Long-press the icon → shortcuts **Start today's workout** / **Quick log** appear.

## Offline install verification checklist (run on devices #1, #4, #5)

- [ ] First visit online: shell cached (DevTools → Application → Cache Storage shows the versioned cache).
- [ ] Airplane mode ON → cold launch from home-screen icon renders the app (not the browser error page).
- [ ] Navigate all five tabs offline: content renders from cache; exercise illustrations load from the illustration cache after first online view.
- [ ] Offline fallback UI: the OfflineBanner appears (probe fails) and clears on reconnect.
- [ ] Log a set offline → data persists → goes online → data still there (IndexedDB + localStorage).
- [ ] SW update while offline: no reload loop; update banner defers while a workout is active and applies after save.
- [ ] Install-onboarding card never shows inside the installed (standalone) app.

## Rest timer & wake lock drill (run on devices #1, #4, #5)

The four flows below are the ones a gym session actually depends on. Every
step states the expected result per platform; anything marked UNVERIFIED has
never been confirmed on a physical device and must not be claimed as working.

1. **Install**
   - Android (Chrome): tap the install banner → app opens standalone from the
     home-screen icon. Expected: standalone, no browser chrome, haptics work.
   - iOS (Safari): Share → Add to Home Screen → launch from the icon.
     Expected: standalone, splash renders. Haptics will NOT work (no Vibration
     API on iOS) — the app must not claim otherwise.
2. **Airplane-mode reload**
   - With the app installed and previously opened online, enable airplane
     mode, then cold-launch from the icon.
   - Expected: the app shell renders from the service-worker cache (not the
     browser error page); the OfflineBanner appears; a full session can be
     logged and saved to IndexedDB offline.
3. **Rest timer in background**
   - Start a 60 s rest, then background the app (home screen / app switcher).
     Wait ~20 s, return.
   - Expected (both platforms): the countdown is wall-clock anchored, so on
     return it shows the TRUE remaining time (or the expiry cue fires) — it
     must never resume from where it paused. Audio cues may or may not have
     fired while backgrounded (OS-dependent); the correct time on return is
     the contract.
   - iOS, screen LOCKED during rest: audio cues are expected to be SILENCED
     (UNVERIFIED on real devices — see KNOWN_ISSUES #6). The timer itself
     still resolves correctly on unlock.
4. **Wake lock re-acquire**
   - With "Keep screen awake" enabled, start a session, confirm the screen
     stays on, background the app for ~10 s, then return.
   - Expected: the lock is re-acquired automatically on return (the handle
     re-requests on visibilitychange; no session restart needed).
   - iOS Safari: the Wake Lock API exists from 16.4+, but re-acquire after
     backgrounding is UNVERIFIED on real devices — record the observed
     behaviour in this checklist instead of assuming it passes. Where the API
     is missing, the setting is a silent no-op by design.

## Platform capability expectations

| Capability | Android Chrome | iOS Safari (browser) | iOS standalone | Desktop |
|---|---|---|---|---|
| Install prompt event | ✅ | ❌ (manual only) | ❌ already installed | ✅ Chrome/Edge |
| Haptics | ✅ | ❌ (no Vibration API) | ❌ | ❌ |
| Wake lock | ✅ | ✅ 16.4+ | ✅ | ✅ |
| Web Share (files) | ✅ | ✅ 15+ | ✅ | partial |
| Home-screen shortcuts | ✅ (long-press) | ❌ | ❌ | ❌ |
| Per-OS splash | Chrome generates | ✅ via links | ✅ | n/a |
