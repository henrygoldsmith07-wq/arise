# Arise — progression validation benchmark

Seeded simulation (`mulberry32(20260703)`) of an 18-week training block: novice-rate growth, a
flat plateau block, a planned deload week followed by a supercompensation rebound, occasional
tough sessions, and readiness that tracks session effort. The harness checks that the engine's
validators recover that planted structure. Deterministic — rerun any time with `npm run benchmark`.

| Check | Result |
|-------|--------|
| Recommendation hit-rate (validateProgression) | n=206, hitRate=0.82, MAE 0 kg / 1.3 reps |
| Readiness ↔ performance (readinessPerformanceCorrelation) | n=54, r(RPE)=-0.697, r(volume)=0.301 |
| Deload outcomes (deloadOutcomes) | 1 deloads, improved in next fortnight 100% of the time |
| Mesocycle comparison (mesocycleComparison) | cycle 5 vs 4: e1RM 2.9%, volume -47.2%, sessions -6 |
| Follow-through (recommendationFollowThrough) | n=206, followed 82%, Δgain followed − not = 3.8 |
| Set progression (recommendSets) | 3 sets — Not at the top of 8–12 yet — keep building reps before adding sets. |
| ROM progression (romProgression) | Already at full ROM — progress load or reps instead. |
| Training age (trainingAgeInfo) | intermediate, 7.3 months, rate multiplier 1 |
| Template instantiation (instantiateTemplate) | 8 sessions, 8 swaps for a no-barbell kit, all blocks doable |
| Template recommendation (recommendTemplate) | barbell strength profile → tpl-strength; bodyweight beginner → tpl-anywhere |
| Volume balance (volumeBalanceAdvice) | Back verdict under in a legs+chest-only block — Back is getting only 0 sets/week (0% of volume) while Legs dominates — swap a Legs block for Back work. |
| Fatigue-aware ordering (fatigueAwareOrder) | bodyweight-squat → bench-press-dumbbell → dumbbell-row → push-up → plank → run-easy |
| Weak-point priority (weakPointMuscles) | Chest, Legs trained while fresh |
| Note signals (noteSignals) | negative note → negative:soreness, negative:fatigue; technique change detected: true |
| Session quality (sessionQuality) | bad session → bad; good session → good |
| Bad-session ratio (badSessionRatio) | 2/4 sessions bad in the rough patch (0.5) |
| Plateau attribution (plateauAttribution) | good-readiness flat stretch → genuine; low-readiness flat stretch → bad-sessions |
| Deload assessment (deloadReadinessAssessment) | one-day dip → deload false (One-day readiness dip only — no deload; re-check after recovery.); sustained → deload true |
| PR scan (scanPRs) | 2/3 records not like-for-like (technique change / jitter) |
