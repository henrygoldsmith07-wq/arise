# Incident response plan

Arise is local-first: there is no Arise server, no backend, and no runtime
dependency on infrastructure beyond the static hosting of the app shell. That
shrinks the incident surface dramatically — and focuses the few incident
types that remain.

## Incident classes and owners

| Class | Example | Blast radius | First responder |
|---|---|---|---|
| Bad release | A deploy breaks boot or data hydration | All users who load that version | Whoever is on-call (owner) |
| Data-contract regression | An export/merge bug corrupts a store on import | Users importing affected exports | Owner |
| Supply chain | A compromised npm dependency | Builds; users after update | Owner |
| Privacy | Telemetry or a bundle leaks more than documented | Users who opted in / exported bundles | Owner |
| Hosting | CDN outage | New loads only; installed apps keep working from cache | Hosting provider + owner |

## The playbook

**Bad release.** 1) Freeze deploys. 2) Roll the deployment back to the last
green release (Vercel: *Deployments → Promote previous*; commit-level
`git revert` for the fix-forward path). Because the service worker caches by
version and users defer updates mid-workout, an already-installed app keeps
running its current good version until it applies an update — rollback stops
the spread at "who hasn't updated yet". 3) If user data is at risk, ship a
recovery-focused patch (see `docs/BACKUP_RECOVERY.md`): boot integrity repair
already quarantines and snapshots; add release notes telling people to check
*Storage & diagnostics*. 4) Post-mortem in `docs/KNOWN_ISSUES.md` until fixed.

**Data-contract regression.** Imports are preview-gated, but a *wrong* merge
is still possible. 1) Bump the export contract version so affected files
fail validation loudly instead of silently mis-merging. 2) Extend
`exportPolicy.js` adapters to re-read the broken version into correct shape.
3) Release notes explain: who is affected, how to check (support bundle's
`storeShape`), how to recover (snapshot, backup import, or the quarantine
copy).

**Supply chain.** CI runs `npm audit`; on a real advisory: pin/patch, verify
lockfile diff, rerun the full verify pipeline, release a patch. The app has
zero runtime dependencies beyond React, so the blast radius is build-time
only.

**Privacy.** Kill the leak first (revert, feature-off), then assess scope —
telemetry is opt-in and anonymised, support bundles contain no training data
by construction; verify the claim with the same code path (`telemetry.js`
sanitiser + `supportDiagnostics.js` tests) rather than memory. Document what
happened in the release notes if any released version was affected.

**Hosting.** Static-host outages self-heal for installed users (offline
shell). Communicate on the repo; nothing to roll back app-side.

## What we deliberately do not have

- No status page: there is no service to status. The honest status is "your
  app works offline; this repo is where releases are tracked".
- No 24/7 rotation: a personal-scale project names a single owner. The plan's
  job is to make their first hour effective, not to fake on-call capacity.
