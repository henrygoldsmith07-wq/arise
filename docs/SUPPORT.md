# Support

Arise is a local-first app with no server, so support is community-shaped:
documentation, diagnostics, and issue triage.

## Self-serve, in order

1. **In-app diagnostics** — More → Storage & diagnostics: storage health,
   migration log, quarantined records, snapshot restore. Most "something's
   wrong" moments answer themselves here.
2. **Troubleshooting guide** — `docs/TROUBLESHOOTING.md` for boot failures,
   odd data, sync and install problems.
3. **FAQ** — `docs/FAQ.md` for the quick questions.
4. **Recovery playbook** — `docs/BACKUP_RECOVERY.md` when data is at stake.

## Reporting a bug

Open a GitHub issue in `henrygoldsmith07-wq/arise`. Include: what you did,
what happened, what you expected, browser + OS + installed-or-not, and the
console output if there is one.

**Never attach:** backup files, history dumps, screenshots containing
health summaries, or anything with your logs in it. Issues are public and
your data is yours — describe the symptom, share a minimal reproduction.

**Security issues:** do not open a public issue. Use GitHub's private
security advisory for this repository ("Report a vulnerability" on the
Security tab).

## Feature requests

Welcome — with the ground rules from `CONTRIBUTING.md` in mind
(local-first, no-account, evidence posture). Check `docs/ROADMAP.md` and
the public backlog first; if it's listed, say "me too" with your use case.

## Response expectations

This is a personal-scale project: issues are triaged when the maintainer is
in, not on a clock. The documentation above is kept deliberately thorough
precisely so no one is blocked on a reply.
