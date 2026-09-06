# Privacy Policy (hosted builds)

This policy covers **publicly hosted copies of Arise** and the hosted landing
page. It describes what is collected, what is never collected, and the rights
you have over your data. For how the app behaves mechanically, see
`docs/PRIVACY.md`; for adversarial analysis, `docs/THREAT_MODEL.md`.

## The one-paragraph version

Arise stores your training data in your browser on your device. The hosted
site serves application files; it does not receive, store, or process your
training data, and there is no account. Analytics/telemetry is off by
default and, when you enable it, stays on your device. If you configure
sync, your data goes only to the storage provider you choose, encrypted
end-to-end when you set a passphrase.

## What we collect

**Nothing by default.** Specifically:

- No accounts, no email addresses, no names, no payment details.
- No third-party analytics, ad networks, or trackers on the hosted site.
- Server access logs kept by the hosting provider (Vercel) apply to the
  hosting layer and are governed by that provider; Arise adds nothing to
  them. Arise does not embed anything that reads them.

## What the app stores, and where

- **Training data** (sessions, sets, programs, readiness, the optional
  evaluation ledger) — in IndexedDB, in your browser, on your device.
  Field-by-field: `docs/DATA_DICTIONARY.md`.
- **Lightweight flags** (legacy-migration pointer, paint-critical theme
  preference) — in localStorage on your device.
- **Local measurement events** (logging time, session abandonment,
  recommendation acceptance) — recorded **only if you opt in** at the
  consent prompt or in More → Privacy, and stored on your device. They are
  never transmitted anywhere by Arise; they exist so you can inspect and
  export your own behavioral history.
- **Optional health summary** — imported from your device's health platform
  only after explicit, revocable consent (More → Privacy). Stored locally,
  minimized to training-relevant fields, never included in logs.
- **Sync credentials** (optional WebDAV) — stored only on your device, never
  exported, never sent anywhere except to the endpoint you configured.

## What leaves your device, and when

1. **Backups you export** — you choose where they go.
2. **Sync you enable** — to your own WebDAV storage; end-to-end encrypted
   whenever you set a passphrase (recommended). Arise has no sync server.
3. **AI insight, if you use it** — More → More Tools offers an optional
   AI-coach text summary. It sends a **minimized, aggregated** training
   context (no raw set-by-set history, no health data) to the model endpoint
   **you** configure with an API key **you** paste. Off by default.
4. Nothing else. No crash reporting, no error telemetry.

## Your rights (GDPR/CCPA-style, self-serve)

Arise is local-first, so every right below is executable by you, in the app,
without contacting anyone:

- **Access & portability:** `More → Data → Export JSON` produces the full
  store (training data, events, preferences) in a documented, versioned
  format (`docs/IMPORT_EXPORT.md`). CSV export covers exercise history.
- **Erasure:** `More → Data → Clear local data` (and the demo banner's
  "Start fresh") wipes IndexedDB and the legacy localStorage payload on the
  device. Because the hosted site holds no copy, this is complete deletion.
- **Rectification:** edit any session, note, or readiness entry in the app.
- **Objection / withdrawal of consent:** measurement events and the health
  summary are consent-gated and can be disabled at any time in More →
  Privacy; disabling the health summary also deletes the stored summary.
- **No sale, ever:** Arise does not sell, rent, or share personal data,
  because it does not collect any.

If your jurisdiction gives you rights against a controller (for example,
GDPR or CCPA), note that for a hosted Arise copy the maintainers hold no
personal data to act on — the controls above are the exercise of those
rights. For data held in your sync destination, your agreement is with that
provider.

## Children

Arise is not directed at children under 13, and the hosted copy collects
nothing that could identify anyone of any age. See the age guidance in
`docs/TERMS.md` for 13–17-year-olds.

## Changes

Material changes to this policy will be noted in the repository changelog
and on this page with a date.

## Contact

Open an issue on the project repository for any privacy question.
