# Native wrapper via Capacitor (optional)

Arise is a fully capable PWA: installable, offline-first, with home-screen
shortcuts, wake lock and (on Android) haptics. A native wrapper is **optional**
and only worth it for store distribution or native-only APIs (widgets, iOS Live
Activities, background audio). This guide adds one without changing a line of
app code — the wrapper shells the same web build.

## Principles

1. **Zero new runtime dependencies.** Capacitor lives in the wrapper project
   (`capacitor/`), never in the web app's `package.json`. The web build stays a
   pure PWA; store packaging is a separate artifact.
2. **One source of truth.** The wrapper loads the *deployed* URL by default
   (`server.url` in `capacitor.config.json`), so a store build updates with the
   website without app-review cycles. A `npx cap sync` bundled-copy mode is
   possible later if fully-offline native builds are ever needed.
3. **Local-first preserved.** The wrapper's WebView storage is the same
   localStorage/IndexedDB the PWA uses; exports and sync (WebDAV) work
   unchanged. No Arise servers exist in this path either.

## Steps (run once, outside CI)

```bash
# from the repo root
mkdir capacitor && cd capacitor
npm init -y
npm i -D @capacitor/cli @capacitor/core @capacitor/android @capacitor/ios
npx cap init "Arise" "com.arise.training" --web-dir=dist
```

Point the wrapper at the deployed app in `capacitor.config.json`:

```json
{
  "appId": "com.arise.training",
  "appName": "Arise",
  "webDir": "dist",
  "server": { "url": "https://arise.example.com", "cleartext": false }
}
```

Then:

```bash
# Android
npx cap add android
npx cap open android      # Android Studio → Build → Generate Signed Bundle

# iOS (macOS + Xcode required)
npx cap add ios
npx cap open ios          # Xcode → Product → Archive → distribute
```

## App store packaging notes

- **Android (Play Store):** an AAB signed with an upload key; the listing needs
  the 512×512 icon (already in `public/icon-512.png`) and a privacy policy URL
  (the in-app "Privacy, ownership & disclaimers" text is the source).
- **iOS (App Store):** screenshots per device class; note the review guideline
  exception **4.2 minimum functionality** — a shell around a working web app is
  acceptable when native value (push, widgets) is added; safest is bundling the
  web build via `npx cap sync` instead of `server.url`.
- Both stores require the medical/safety disclaimer copy that already ships
  in More → Privacy & data.

## If native APIs are ever wired (not done here)

- **Widgets / Live Activities (iOS):** rest-timer Live Activity via
  `ActivityKit` through a small Capacitor plugin; the rest timer already emits
  start/end events (see `GymModePanel`'s RestDock) that a plugin bridge would
  subscribe to.
- **Background audio:** iOS requires `UIBackgroundModes: audio` in the wrapper
  project (Xcode → Signing & Capabilities); the PWA's audio cues continue when
  the screen locks only inside the wrapper.
- **Notifications:** intentionally NOT enabled in the PWA. Inside a wrapper
  they would be opt-in only, mirroring the consent policy in ADR 0011 — and
  the user must explicitly want them.

## What deliberately stays PWA-only

Home-screen shortcuts, install onboarding, offline fallback, haptics, wake
lock, share sheet — all already work in the browser build. The wrapper adds
distribution (stores) and native-only capabilities, nothing else.
