# Installing Arise

Arise is a PWA: install it once and it runs standalone — its own window/icon,
offline, wake lock in the gym — while staying the same code a browser tab
loads. There is no app store and nothing to pay.

## Android (Chrome, Edge, Samsung Internet, Firefox)

1. Open the Arise URL in the browser.
2. Tap the **Install app** card on Today — or the browser menu →
   **Install app / Add to Home screen**.
3. Confirm. The icon lands in your launcher; haptics and shortcuts
   (long-press the icon: *Start today's workout*, *Quick log*) work.

## iOS / iPadOS (Safari only)

Chrome and Firefox on iOS are all WebKit underneath and cannot install
PWAs — use Safari.

1. Open the Arise URL in **Safari**.
2. Tap the **Share** button → **Add to Home Screen** → Add.
3. Launch from the home screen icon. Status bar and splash come from the
   app; vibration is not available (platform limit, stated honestly in
   Settings).

**iPad quirk:** iPadOS masquerades as desktop macOS Safari, so the install
card detects the masquerade (touch support + no install prompt) and shows
the manual Add to Home Screen steps instead.

## Desktop (Chrome, Edge)

1. Open the Arise URL.
2. Click the install icon in the address bar, or the **Install app** card.
3. Arise opens in its own window; a shortcut lands in your OS app menu.

## In-app browsers (Instagram, Facebook, X…)

These shells frequently block installation. The install card detects them
and tells you to open the URL in your real browser first — do that, then
install from there.

## Verifying the install worked

1. The app opens in its own window (no browser URL bar).
2. **Airplane mode on → close → reopen:** everything renders from the
   service worker cache; you can log a full session offline.
3. Long-press the launcher icon (Android): shortcuts appear.

Trouble? `docs/TROUBLESHOOTING.md` → "Install / PWA issues".

## Updating

Updates apply in the background without interrupting an active workout —
the service worker defers activation while a session is running and the UI
offers the update at a safe moment.
