# Arise user guide

Everything in Arise lives on your device. There is no account, no server and
no sync unless you deliberately configure one. This guide walks the app the
way you will actually use it: first run → training day → reading your
progress → taking care of your data.

---

## First five minutes

1. **Onboarding** asks goal, training location, available equipment, level,
   days per week and session length. Answer honestly rather than ambitiously —
   every recommendation is filtered through these answers, and the equipment
   answer is a hard honesty gate (a bodyweight-only user is never shown a
   barbell lift as "recommended"). Barbell users can optionally enter their
   plate inventory, which makes load targets achievable-by-construction.
2. **Today** is the home screen. It shows the session scheduled for today —
   or "up next" on rest days — and nothing else competes with it.
3. **Train → pick a program** creates a dated schedule. The schedule lives
   locally; missed days simply stay missed, nothing silently reshuffles.

## Training day

- Open the session from **Today**. Sets are logged inline: reps, load, RPE
  (leave load blank for bodyweight).
- **Gym Mode** (session header toggle) is the one-thumb layout: focus on one
  exercise at a time, large touch targets, swipe right to complete / left to
  mark a set failed, long-press to edit, and a load numpad with equipment-aware
  quick-add buttons (plates, dumbbell steps, machine increments).
- **Rest timer** auto-starts after a completed set (configurable in More).
  It announces the last seconds with sound/haptics/voice per your settings,
  keeps running in a dock while you browse, and can hold the screen awake.
- The runner shows **last time's sets** per exercise and the engine's target
  with its reason ("+2.5 kg — reps target hit twice at this load").
- Notes are free-text; quick tags capture pain, soreness and session quality
  in one tap. Pain/discomfort tags actively soften future recommendations.

## Reading your progress

- **Progress** shows weekly volume, estimated strength trend, streak and
  consistency, PRs (with fake-PR filtering — jitter and technique-change PRs
  are flagged, not celebrated), and per-muscle volume-balance advice.
- **Weekly Review** is the defining weekly interaction: adherence, what the
  engine noticed, and the directives for next week. Skim it once a week;
  ignore it daily.
- Attributes (Strength / Endurance / Consistency / Technique) derive only
  from your logged history — never from program labels.

## Your data

- **More → Data:** export (JSON backup, optionally passphrase-encrypted;
  partial exports for history / settings / events only), import with preview
  and conflict handling, CSV export for spreadsheets.
- **Automatic local backups:** rolling snapshots are kept on-device; the
  diagnostics screen shows storage health and can restore a snapshot.
- **Cross-device sync (optional):** More → Sync. You provide your own WebDAV
  storage (Nextcloud, Fastmail, Synology…). See `docs/SYNC_GUIDE.md`.
- Clearing local data is total and immediate — export first.

## Settings that matter (More)

| Setting | Effect |
|---|---|
| Sound cues / voice coach / speech rate | Rest-countdown audio; voice announces exercise and rep targets |
| Haptics | Vibration patterns (Android; iOS Safari has no vibration API) |
| Gym mode preferences | Focus mode, auto rest start, wake lock |
| Units, theme | kg/lb; system / light / dark |
| Consent center | Telemetry (off by default), Pulse, health summary — each independent, revocable |
| Accessibility | Large text, high contrast, reduced motion |

## Where to go deeper

- How the engine thinks: `docs/METHODOLOGY.md`
- What the app refuses to claim: `docs/CANNOT_PROVE.md`
- Every stored field: `docs/DATA_DICTIONARY.md`
- When things go wrong: `docs/TROUBLESHOOTING.md`
