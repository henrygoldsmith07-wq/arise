# What Arise cannot prove

Every evidence-bearing app owes its users this page. These are the standing
limits of what Arise can claim — written before anything else, so the app's
numbers are read with the right weight.

## The hard limits

**Muscle growth is not measurable from training logs.** Sets, reps, loads and
RPE are inputs and outputs of training, not the adaptation itself. Two
lifters with identical logs can have different growth; the same lifter can
grow with falling volume. Nothing in Arise measures hypertrophy, and no
number here pretends to.

**The retrospective replay cannot prove causation.** Scoring prescriptions
against one realised stream of training measures *agreement* and
*prescription error* — the outcome was generated under whatever policy the
lifter actually followed. Causal claims belong to the prospective,
exercise-level randomised design (`STUDY_DESIGN` in `study.js`), frozen
before any efficacy look.

**"No significant difference" is not equivalence.** A null replay result
does not mean the policies are interchangeable.

**Your ledger proves things about you, tentatively.** The prospective
ledger is valid for the person who generated it, at their sample size.
Segment conclusions are withheld below minimum sample sizes; when they
appear, they carry Wilson intervals and they are still observational.

**Benchmarks validate mechanics, not training science.** The synthetic
corpora in `benchmark/` prove the harness and engine behave as designed —
deterministically, prior-only, without leakage. They are not evidence about
humans.

**Readiness is a proxy.** Sleep/soreness/motivation entries are self-report.
The readiness score weights them because they correlate with performance,
not because they measure recovery.

**Strength standards and e1RM are estimates.** Epley 1RM is a regression
over community data; it is least accurate at high rep counts. PRs are
filtered for jitter and technique changes precisely because raw logs
overstate them.

**No medical claims, ever.** Arise is a logging and planning tool. It does
not diagnose, treat or advise on injuries or health conditions; pain tags
only soften training prescriptions. High-intensity recommendations carry the
same disclaimer as all training: individual response varies, and a coach or
clinician outranks any app.

## How this shows up in the product

- Every engine decision ships with its reason and evidence count.
- Charts carry confidence intervals; small samples are labelled as such.
- The evidence dashboard separates calculated / engine / simulated /
  observed-yours / externally-validated tiers — and the last tier is
  deliberately empty until the field study fills it.
- Retrospective outputs are labelled "not causal" in the UI, not just here.

## The one-sentence version

Arise can tell you, with reasons, what it would do next and why — it cannot
tell you that doing it will make you grow, and it will not pretend otherwise.
