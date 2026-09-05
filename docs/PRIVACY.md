# Privacy guide

Short version: **your training data never leaves your device unless you
make it.** This page says exactly what is stored, what can be shared, and
under what control.

## What is stored, and where

- Training history, programs, preferences, readiness and the optional
  evaluation ledger live in **IndexedDB in your browser, on your device**.
  Field-by-field: `docs/DATA_DICTIONARY.md`.
- The only `localStorage` items are lightweight flags and an anonymous
  per-device id (`arise.deviceId`) used as merge provenance — it identifies
  the *device*, never you.
- No account, no login, no analytics SDK, no third-party trackers. The
  bundle contains none by construction (reviewable, and the license gate
  keeps the dependency surface tiny).

## What can leave the device, and only by your action

| Channel | What travels | Control |
|---|---|---|
| Export file | The backup you save; optionally passphrase-encrypted | Manual, per export; credentials stripped |
| Sync (optional) | One versioned backup file to **your own** WebDAV host; ciphertext-only if encrypted | Explicit opt-in; HTTPS enforced; disable any time |
| Coach export | A summary you chose the sections of — bests/volume by default, no identity | Manual, per share |
| Health summary | Optional, minimised adapter payload (steps/sleep/weight/RHR) — never raw health history | Independent consent, revocable |
| Telemetry/events | Local event records for your own evidence ledger | **Off by default**; local-only unless you export them |

Consents are independent, revocable, and their state lives in preferences.
The consent center (More) shows every consent and its scope in one place.

## Data ownership statement

Your training data is yours. The MIT license governs the *code*; it grants
nothing over *your logs*. Export is always available, always free, always
in an open format — there is no lock-in mechanism to escape.

## What is never collected

- No identity, email, or account data — there is nowhere to collect it.
- No plaintext health data in logs; local crash/diagnostic records carry no
  training or health payloads.
- No location, no contacts, no advertising identifiers.

## Medical and safety disclaimer

Arise is a logging and planning tool. It does not diagnose, treat, or advise
on medical conditions; readiness and pain signals only soften training
prescriptions. Consult a qualified professional for medical or injury
decisions, and treat high-intensity recommendations with the caution any
training program deserves — individual response varies.

## Public release note

Before any public/commercial distribution: publish this page plus the
privacy policy it implies, complete the franchise-branding sweep the README
documents, and verify the CSP/dependency posture hasn't drifted (CI gates
cover the technical half).
