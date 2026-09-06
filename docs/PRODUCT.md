# Product strategy

The decisions behind what Arise is, who it serves, and what it will not
become. Written to be argued with — change them in a PR, not in a meeting.

## The one-line value proposition

> **The training companion that shows its work — a plan, a coach, and the
> evidence, all on your device.**

Shorter, when space demands it: *"A coach that shows its work."*

## The order: logger, coach, evidence engine

Arise is three products stacked in a strict priority order, and the order
is the strategy:

1. **Logger first.** If logging a set between reps is slower than paper,
   nothing else matters. Gym Mode, swipe actions, the load numpad and the
   persistent rest dock all exist because logging is the product's floor.
2. **Coach second.** The next prescription must be believable and
   explainable: conservative defaults, reasons on every number, guardrails
   against overshoot. A coach you can audit beats a black box you must
   obey.
3. **Evidence engine third.** The dashboards, calibration and prospective
   ledger exist to keep the coach honest — they are the *audit layer*, not
   the headline feature. They are never shown before the user has trained
   long enough for them to mean anything.

This ordering resolves feature conflicts by rule: anything that makes
logging slower loses; anything that makes the coach less explainable loses;
evidence features that clutter the training loop move behind progressive
disclosure.

## The ideal user persona

**"Sam, the self-directed intermediate."** Trains 3×/week, 30–50 minutes,
at home or a small gym with modest kit. Wants to get measurably stronger
without a personal trainer or a spreadsheet. Skeptical of fitness apps
that shout: will happily trade novelty for *quiet competence* — show me
what to do, tell me why, don't sell me anything. Values ownership (files,
offline, no account) more than social features. Sam's failure mode is
consistency, not knowledge — so Arise invests in gentle re-entry, weekly
review, and streaks that never guilt.

Secondary personas, served but not optimized for:

- **The returning beginner** — needs the onboarding quick-start and demo
  mode; graduates into Sam.
- **The evidence-minded expert** — Expert mode, backtests, the study
  ledger; often a contributor or a coach auditing the engine.
- **The human coach** — receives coach exports; does not run the app.

Coach-guided training is deliberately *not* the primary use case: the
app's contract is with the person whose device holds the data.

## Primary use case

**Intermediate, self-directed, general-strength training.** Beginner and
expert are paths *through* the product, not targets: onboarding meets the
beginner where they are; Expert mode serves the advanced. The engine's
conservatism is calibrated for someone who cannot afford a coach's
mistakes — the person most apps overserve and underprotect.

## Retention without dark patterns

Retention comes from being useful at the moment of decision, never from
manufacturing anxiety. Standing rules:

- **No guilt strings.** A lapsed streak renders as "fresh start this
  week"; missed sessions fold forward ("life happened — the schedule
  adapts"); nothing counts down, shames, or compares you to others.
- **Streaks count showing up, kindly.** Week-granular runs with mid-week
  grace; milestones are session-count based — the one number that never
  lies — and every one is permanent.
- **Reviews, not feeds.** The Weekly Review and monthly digest are
  pull-based reflections; there is no infinite scroll anywhere in the app
  and there never will be.
- **Notifications stay opt-in-only-if-ever.** The first feature that
  proactively interrupts users would break the consent posture (see
  ROADMAP).

## Experience levels and progressive disclosure

Simple / Standard / Expert is a **display gate only**: the engine, storage
and exports are identical at every level. Simple shows the number and one
line of plain language; Expert reveals backtests, calibration and evidence
segments. Disclosure replaces removal — nothing is ever hidden from the
export or the ledger.

## Demo mode

Cold start is the biggest honest-data killer: an empty app shows nothing
about itself. The demo loads a clearly labeled, seeded month of training
on a live schedule — banner labeled, `demo-` prefixed ids, export disabled
so sample data can never masquerade as real logs, one-tap exit to a true
empty start. It answers "is this for me?" in ninety seconds without
compromising the no-demo-user data-integrity principle, because demo data
is *visibly* not yours.

## Community: later, only if it fits

No social layer is planned. Identity and graphs contradict the
local-first, no-account posture. The only community-shaped feature that
fits today is contributing evidence: the consent-gated field study. If a
community feature ever appears, it must work without accounts, server
profiles, or feed mechanics — otherwise it is out of charter.

## Pricing

The app is free and MIT-licensed; there is no plan to change that. If
monetization ever becomes necessary, the honest options — in charter
order — are:

1. **Paid native wrapper / store distribution** (Capacitor shells the same
   web build; the free PWA remains).
2. **Optional paid services that run on the user's own infrastructure**
   (e.g. a maintained sync server appliance — only if user demand exists;
   never a hosted account requirement).
3. **Sponsorship/donation** on the free core.

Never: ads, data monetization (there is no data to sell), paywalled
features computed from data the user already owns locally, or subscription
gates on export formats.

### Monetization stance (business/legal audit, 2026-09)

- **Open-core is not a fit.** The value here is the local computation over
  the user's own data; there is no server-side “pro” tier to sell without
  becoming the hosted-account product the charter forbids.
- **One-time purchase beats subscription for trust** if a paid artifact
  ever exists (store wrapper, supporter license key). Recurring billing on
  a local-first tool reads as rent on something the user already owns.
- **Paid sync or “pro analytics” only if values-aligned:** sync must remain
  the user's own storage with E2E keys the user holds (a paid relay may
  never see plaintext); analytics are derived on-device from data the user
  owns, so charging for them would violate the “never paywall computation
  over your own data” rule above. Current call: don't.

## Success metrics (local, honest)

Because telemetry is opt-in and local, product success is measured by
choice: exports per active month, coach exports generated, weekly reviews
opened (locally measured, consent-gated), and — the one that matters —
week-4 retention of logged sessions. The evaluation ledger doubles as the
"did the coach actually help" metric. No DAU leaderboards; the product
does not optimize for opening itself.
