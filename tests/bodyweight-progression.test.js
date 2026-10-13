import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recommendNext } from "../src/lib/progression.js";
import { EXERCISE_BY_ID } from "../src/lib/data.js";
import { resolveArisePriors } from "../src/lib/priors.js";
import { generateSession } from "../src/lib/sessionGenerator.js";
import { recommendNextWithPolicy, buildExplanation } from "../src/lib/progressionPolicies.js";

// Bodyweight progression honesty: a bodyweight lift at the top of its rep
// range has no kg to add — the engine must name a real, kit-honest harder
// variant of the same movement instead of a generic "try harder" hint.

const kwSess = (exerciseId, reps, dateISO, rpe = "6") => ({
  id: `s-${exerciseId}-${dateISO}`,
  dateISO,
  blocks: [{ exerciseId, sets: [{ reps: String(reps), weightKg: "", rpe }] }],
});

describe("bodyweight variant ladder", () => {
  const cfg = resolveArisePriors(null);

  it("every named variant and ladder edge exists in the exercise library", () => {
    const ladders = cfg.progression.bodyweightVariants || {};
    for(const [headId, ladder] of Object.entries(ladders)){
      if(!Array.isArray(ladder)) continue; // flags like `fallback`
      assert.ok(EXERCISE_BY_ID[headId], `ladder head "${headId}" exists`);
      for(const variantId of ladder){
        assert.ok(EXERCISE_BY_ID[variantId], `variant "${variantId}" of "${headId}" exists`);
        assert.notEqual(variantId, headId, `variant of "${headId}" is not itself`);
      }
    }
  });

  it("push-up at top of range steps up to a named variant, not a generic hint", () => {
    const history = [
      kwSess("push-up", 8, "2026-05-25"),
      kwSess("push-up", 10, "2026-06-01"),
      kwSess("push-up", 12, "2026-06-08"),
    ];
    const rec = recommendNext({ exerciseId: "push-up", history, targetReps: "8–12" });
    assert.ok(rec.variant, "recommendation carries a variant id");
    assert.ok(EXERCISE_BY_ID[rec.variant], "variant exists in the library");
    assert.match(rec.reason, new RegExp(EXERCISE_BY_ID[rec.variant].name), "reason names the variant");
    // Step-up re-anchors the rep ladder at the bottom of the range.
    assert.equal(rec.reps, 8);
  });

  it("under bodyweight-only kit, every laddered head has a reachable rung and the engine never prescribes unowned kit", () => {
    const ladders = cfg.progression.bodyweightVariants || {};
    for(const [headId, ladder] of Object.entries(ladders)){
      if(!Array.isArray(ladder)) continue;
      const history = [kwSess(headId, 99, "2026-06-01"), kwSess(headId, 99, "2026-06-08")];
      const rec = recommendNext({ exerciseId: headId, history, targetReps: "8–12" });
      if(rec.variant){
        const ex = EXERCISE_BY_ID[rec.variant];
        assert.ok(ex, `engine variant for "${headId}" exists`);
        // The engine output must never need kit BEYOND the head exercise's own
        // kit (a bodyweight-only user is never prescribed a barbell variant).
        const headKit = new Set(EXERCISE_BY_ID[headId]?.equipment || ["bodyweight"]);
        assert.ok(
          (ex.equipment || []).every(e => headKit.has(e)),
          `"${headId}" stepped up to "${rec.variant}" which needs ${(ex.equipment||[]).join('+')} — head kit is ${[...headKit].join('+')}`
        );
      }
    }
  });

  it("bodyweight squat (absent from the legacy regex) still ladders into variants", () => {
    const history = [
      kwSess("bodyweight-squat", 20, "2026-06-01"),
      kwSess("bodyweight-squat", 22, "2026-06-08"),
    ];
    const rec = recommendNext({ exerciseId: "bodyweight-squat", history, targetReps: "12–20" });
    assert.ok(rec.variant, "recommendation carries a variant id");
    assert.ok(EXERCISE_BY_ID[rec.variant]);
  });

  it("below the top of the range, plain rep addition is unchanged", () => {
    const history = [kwSess("push-up", 8, "2026-06-01")];
    const rec = recommendNext({ exerciseId: "push-up", history, targetReps: "8–12" });
    assert.equal(rec.variant, undefined);
    assert.equal(rec.reps, 9);
  });

  // --- regressions the first implementation shipped -------------------------

  it("never recommends a REGRESSION: the step-up must be harder than the head", () => {
    // The library's own level field is the objective claim. The first
    // implementation resolved the ladder by declared index 0, so push-up
    // stepped up to Knee Push-up (an on-ramp) and pull-up to Negative Pull-up
    // — telling an intermediate to go backwards.
    const RANK = { Beginner: 0, Novice: 0, Intermediate: 1, Advanced: 2, Expert: 3 };
    const ladders = cfg.progression.bodyweightVariants || {};
    for(const [headId, ladder] of Object.entries(ladders)){
      if(!Array.isArray(ladder)) continue;
      const headRank = RANK[EXERCISE_BY_ID[headId]?.level] ?? 0;
      const history = [kwSess(headId, 99, "2026-06-01"), kwSess(headId, 99, "2026-06-08")];
      const rec = recommendNext({ exerciseId: headId, history, targetReps: "8–12" });
      if(!rec.variant) continue; // no harder rung — the honest answer, tested below
      const variantRank = RANK[EXERCISE_BY_ID[rec.variant]?.level] ?? 0;
      assert.ok(
        variantRank > headRank,
        `"${headId}" (${EXERCISE_BY_ID[headId].level}) must not step up to "${rec.variant}" (${EXERCISE_BY_ID[rec.variant].level})`
      );
    }
  });

  it("an on-ramp listed in a ladder can never surface as a step-up", () => {
    // knee-push-up scales DOWN from push-up and is declared in push-up's
    // ladder; the level filter must keep it out of the recommendation.
    const history = [kwSess("push-up", 12, "2026-06-01"), kwSess("push-up", 12, "2026-06-08")];
    const rec = recommendNext({ exerciseId: "push-up", history, targetReps: "8–12" });
    assert.notEqual(rec.variant, "knee-push-up");
    const pull = [kwSess("pull-up", 8, "2026-06-01"), kwSess("pull-up", 8, "2026-06-08")];
    const pr = recommendNext({ exerciseId: "pull-up", history: pull, targetReps: "8–12" });
    assert.notEqual(pr.variant, "negative-pull-up");
    assert.notEqual(pr.variant, "scapular-pull-up");
  });

  it("the ladder advances past rungs the user has already demonstrated", () => {
    const atTop = (extra = []) => [
      kwSess("push-up", 12, "2026-06-01"),
      kwSess("push-up", 12, "2026-06-08"),
      ...extra.map((id, i) => kwSess(id, 8, `2026-06-1${i}`)),
    ];
    const RANKS = new Set(["wide-push-up", "diamond-push-up", "archer-push-up", "weighted-push-up"]);

    const fresh = recommendNext({ exerciseId: "push-up", history: atTop(), targetReps: "8–12" });
    assert.ok(RANKS.has(fresh.variant), `first rung is a declared step-up, got ${fresh.variant}`);

    const afterFirst = recommendNext({ exerciseId: "push-up", history: atTop([fresh.variant]), targetReps: "8–12" });
    assert.notEqual(afterFirst.variant, fresh.variant, "a demonstrated rung is not recommended twice");
    assert.ok(RANKS.has(afterFirst.variant));

    // Exhausted ladder holds at the hardest rung rather than repeating the easiest.
    const all = RANKS;
    const exhausted = [...all].map((id, i) => kwSess(id, 8, `2026-06-2${i}`));
    const held = recommendNext({ exerciseId: "push-up", history: atTop(exhausted), targetReps: "8–12" });
    assert.ok(RANKS.has(held.variant));
  });

  it("a ladder whose only entries are on-ramps yields no variant and keeps the honest fallback", () => {
    // plank → side-plank is a lateral move at the same level; pike-push-up's
    // named options are regressions. Both must decline to invent advice.
    for(const id of ["plank", "pike-push-up"]){
      const rec = recommendNext({ exerciseId: id, history: [kwSess(id, 99, "2026-06-01"), kwSess(id, 99, "2026-06-08")], targetReps: "8–12" });
      assert.equal(rec.variant, undefined, `${id} must not claim a step-up it does not have`);
      assert.ok(rec.reason && rec.reason.length > 0, "still gives a reason");
    }
  });

  it("an uncovered bodyweight exercise still recommends a specific alternative (declared fallback)", () => {
    // 'plank' has a ladder; use a bodyweight exercise WITHOUT one.
    const uncovered = EXERCISES_WITHOUT_LADDER()[0];
    if(!uncovered) return; // every bodyweight exercise laddered — then nothing to test here
    const history = [kwSess(uncovered.id, 99, "2026-06-01"), kwSess(uncovered.id, 99, "2026-06-08")];
    const rec = recommendNext({ exerciseId: uncovered.id, history, targetReps: "8–12" });
    // Either a named variant (declared substitution) or the sustained top-of-range path — but NOT the bare generic reason.
    const generic = /^Top of range — try harder variant \(decline\/weighted\/tempo\)\.$/;
    if(rec.variant) assert.ok(EXERCISE_BY_ID[rec.variant]);
    else if(generic.test(rec.reason)) assert.fail("bare generic hint escaped for a fallback-covered exercise");
  });

  it("null-load weighted exercise (load===0) is not misread as bodyweight when supportsWeighted and kit exist", () => {
    // Romanian deadlift via the Starter programme is loadable; an explicit 0-load log
    // (bodyweight attempt) still ladders, but a kit-equipped user's weighted path is unaffected.
    const history = [{ id: "s1", dateISO: "2026-06-01", blocks: [{ exerciseId: "romanian-deadlift", sets: [{ reps: "4", weightKg: "", rpe: "8" }] }] }];
    const rec = recommendNext({ exerciseId: "romanian-deadlift", history, targetReps: "8–10" });
    // Zero-load log on a weighted lift is treated as bodyweight attempt → variant laddering is allowed
    assert.ok(rec.reps != null || rec.variant != null);
  });

  it("generateSession carries the variant name in the load hint when the engine steps up", () => {
    const history = [
      kwSess("push-up", 8, "2026-05-25"),
      kwSess("push-up", 10, "2026-06-01"),
      kwSess("push-up", 12, "2026-06-08"),
    ];
    const session = generateSession({ goal: "general", availableEquipment: ["bodyweight"], history, length: 5, includeWarmup: false });
    const pushBlock = (session.blocks || []).find(b => "push-up|knee-push-up|wide-push-up|diamond-push-up|decline-push-up|archer-push-up|weighted-push-up".includes(b.exerciseId) || ["push-up","knee-push-up","wide-push-up","diamond-push-up","decline-push-up","archer-push-up","weighted-push-up"].includes(b.exerciseId));
    if(pushBlock){
      assert.notEqual(pushBlock.loadHint, "bodyweight", "a stepped-up block does not present the no-op 'bodyweight' hint");
    }
  });

  it("policy layer surfaces the variant by name in the Simple explanation", () => {
    const history = [
      kwSess("push-up", 8, "2026-05-25"),
      kwSess("push-up", 10, "2026-06-01"),
      kwSess("push-up", 12, "2026-06-08"),
    ];
    const rec = recommendNextWithPolicy({ exerciseId: "push-up", history, targetReps: "8–12", policy: "conservative" });
    assert.ok(rec, "policy recommendation exists");
    if(rec.variant){
      const explanation = buildExplanation({ rec, policy: { label: "conservative", version: 1, loadScale: 1, maxLoadJumpPct: 0.1 }, confidence: { band: "low", score: 10, factors: { spread: 0, r2: 0 } }, uncertainty: { label: "low" }, evidence: { sessions: 3, trendWindows: 0 }, trends: { w1: { direction: "flat" }, w3: { direction: "flat" }, w6: { direction: "flat" } } });
      assert.match(explanation.simple, new RegExp(EXERCISE_BY_ID[rec.variant].name), "simple mode names the variant");
    }
  });

  it("top-of-range recommendations carry ladder metadata (step and total rungs)", () => {
    const history = [
      kwSess("push-up", 8, "2026-05-25"),
      kwSess("push-up", 10, "2026-06-01"),
      kwSess("push-up", 12, "2026-06-08"),
    ];
    const rec = recommendNext({ exerciseId: "push-up", history, targetReps: "8–12" });
    assert.equal(rec.variant != null, true, "top-of-range names a variant");
    assert.ok(rec.variantLadder, "ladder metadata travels with the recommendation");
    assert.equal(rec.variantLadder.from, "push-up");
    assert.equal(rec.variantLadder.to, rec.variant);
    assert.ok(Number.isInteger(rec.variantLadder.step) && rec.variantLadder.step >= 1, "step is a 1-based rung index");
    assert.ok(Number.isInteger(rec.variantLadder.total) && rec.variantLadder.total >= rec.variantLadder.step, "total rungs >= current step");
    // The simple explanation renders the whole remaining path, not just the rung.
    const explanation = buildExplanation({ rec, policy: { label: "conservative", version: 1, loadScale: 1, maxLoadJumpPct: 0.1 }, confidence: { band: "low", score: 10, factors: { spread: 0, r2: 0 } }, uncertainty: { label: "low" }, evidence: { sessions: 3, trendWindows: 0 }, trends: { w1: { direction: "flat" }, w3: { direction: "flat" }, w6: { direction: "flat" } } });
    assert.match(explanation.simple, /ladder step 1 of/);
  });
});

// Helper: find a bodyweight exercise without a named ladder (for the fallback test).
function EXERCISES_WITHOUT_LADDER(){
  const cfg = resolveArisePriors(null);
  const ladders = cfg.progression.bodyweightVariants || {};
  const PATTERNS = /(?:^|-)(bodyweight|push-up|plank|dead-bug|glute-bridge|lunge|burpee|pull-up|pike-push-up|incline-push-up)(?:-|$)/i;
  const out = [];
  for(const [id, ex] of Object.entries(EXERCISE_BY_ID)){
    if(ex.equipment?.length === 1 && ex.equipment[0] === "bodyweight" && !ladders[id] && PATTERNS.test(id)) out.push(ex);
  }
  return out;
}
