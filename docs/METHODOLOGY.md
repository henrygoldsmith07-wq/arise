# How Arise decides things — the methodology

Arise's progression engine is deliberately conservative and deliberately
explainable. This page describes the actual mechanism; `docs/EVIDENCE.md`
states what evidence backs it, and `docs/CANNOT_PROVE.md` states what no
mechanism here can honestly claim.

## The pipeline

Every recommendation flows through the same steps, and every step is pure
and deterministic (same inputs → same outputs, byte-identical in tests):

1. **Prior-only slicing.** The engine sees only sessions dated at or before
   the workout being prescribed. This is enforced structurally, not by
   discipline — leak-detector tests inject future data and fail if any
   output changes.
2. **Trend estimation, not single-dip reaction.** Sessions are weighted by
   quality (failed reps, pain tags, readiness), and trends are computed over
   multiple windows (1/3/6/12 weeks). One bad session never moves your next
   target by itself.
3. **Policy selection.** Your progression policy — conservative, standard,
   aggressive, maintenance — is versioned. A policy change is a schema event,
   recorded with its version, so old recommendations can always be
   interpreted in the policy that produced them.
4. **Double progression.** Reps first, then load, using the rep range of the
   exercise's goal. Bodyweight, assisted-bodyweight, unilateral, tempo and
   ROM variants each have their own progression rules.
5. **Equipment honesty.** Barbell targets are rounded to your actual plate
   inventory (`plates.js`); dumbbell targets to your pairs; machine targets
   to the stack increment. If a target is not achievable as written, the
   nearest achievable load is prescribed and the gap is explained.
6. **Guardrails.** Repeated-failure holds, overshoot caps on aggressive
   settings, pain-tag suppression, injury/return-from-break restarts, and
   sustained-trend deloads. Each guardrail fires with a stated reason.
7. **Explanation.** Every output carries its evidence count, confidence,
   uncertainty, and a plain-language reason string. Simplified and advanced
   explanation modes render the same underlying audit trail.

## Substitutions

`rankedSubstitutions()` scores candidates on movement pattern, muscle
overlap, equipment fit, fatigue cost, skill demand and joint stress, and
always returns its reasons. Painful movements block similar-stress
substitutions outright. Substitution outcomes feed the evaluation ledger —
never the engine.

## Deloads, plateaus, and weekly adaptation

- Deloads trigger on *sustained* trends (EMA over multiple sessions plus
  corroborating signals), never a single readiness dip; effectiveness is
  tracked in the weekly review.
- Plateaus need evidence: three flat sessions plus RPE/volume signals, with
  false-plateau detection (bad-session runs, readiness dips, technique
  changes are attributed, not punished).
- Programme-level adaptation (`programming.js`) applies at most one change
  per exposure — add a set, ease the next block, or swap the variation —
  idempotently, with its basis stored.

## Why conservative by default

The cost asymmetry: recommending 2.5 kg too little costs you one slightly
easy set; recommending 2.5 kg too much can cost you a failed week or an
injury. The engine is tuned to be wrong in the safe direction, and the
aggressive policy exists but caps overshoot hard.

## The measurement loop (opt-in)

With local-measurement consent, every recommendation is snapshotted before
the workout it targets and scored against what you actually did. Pairs feed
the prospective evaluation ledger, which is segmented by training age,
exercise, movement pattern and equipment class — with sample-size gates so
conclusions are withheld until they are honest. The ledger never feeds back
into recommendations. See `docs/EVIDENCE.md` for the full firewall.
