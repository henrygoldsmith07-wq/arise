import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  noteSignals, sessionQuality, badSessionRatio, badSessionAttribution, plateauAttribution,
  deloadReadinessAssessment, scanPRs,
} from "../src/lib/sessionQuality.js";

const mkSess = (dateISO, exerciseId, sets, extra={}) => ({ dateISO, blocks:[{ exerciseId, sets }], ...extra });

describe("note signals", ()=>{
  it("flags negative notes", ()=>{
    const s = noteSignals("tough session, felt sore and tired");
    assert.ok(s.sentiment < 0);
    assert.ok(s.tags.some(t=> t.startsWith("negative:")));
    assert.equal(s.techniqueChange, false);
  });
  it("flags positive notes", ()=>{
    const s = noteSignals("great session, felt strong");
    assert.ok(s.sentiment > 0);
    assert.ok(s.tags.some(t=> t.startsWith("positive:")));
  });
  it("detects technique/ROM changes", ()=>{
    const s = noteSignals("reduced ROM to keep form");
    assert.equal(s.techniqueChange, true);
  });
  it("empty notes are neutral", ()=>{
    assert.deepEqual(noteSignals(""), { sentiment: 0, tags: [], techniqueChange: false });
  });
});

describe("session quality", ()=>{
  it("classifies a low-readiness near-failure session as bad", ()=>{
    const h = mkSess("2026-01-01", "barbell-squat", [
      { reps:"8", weightKg:"40", rpe:"10" }, { reps:"8", weightKg:"40", rpe:"10" },
    ], { note:"struggled" });
    const q = sessionQuality(h, { readinessLog: [{ dateISO:"2026-01-01", score: 20 }] });
    assert.equal(q.quality, "bad");
    assert.ok(q.reasons.some(r=> r.includes("readiness")));
  });
  it("classifies a fresh easy session with a good note as good", ()=>{
    const h = mkSess("2026-01-03", "barbell-squat", [
      { reps:"8", weightKg:"40", rpe:"6" }, { reps:"8", weightKg:"40", rpe:"6" },
    ], { note:"great, felt fresh" });
    const q = sessionQuality(h, { readinessLog: [{ dateISO:"2026-01-03", score: 80 }] });
    assert.equal(q.quality, "good");
  });
  it("neutral sessions land in the middle", ()=>{
    const q = sessionQuality(mkSess("2026-01-01", "push-up", [{ reps:"10", weightKg:"" }]), { readinessLog: [] });
    assert.equal(q.quality, "ok");
    assert.equal(q.score, 50);
  });
});

describe("bad session ratio", ()=>{
  it("flags a rough patch", ()=>{
    const history = [
      mkSess("2026-01-01", "barbell-squat", [{ reps:"8", weightKg:"40", rpe:"10" }], { note:"awful" }),
      mkSess("2026-01-03", "barbell-squat", [{ reps:"8", weightKg:"40", rpe:"10" }], { note:"tired" }),
      mkSess("2026-01-05", "barbell-squat", [{ reps:"8", weightKg:"40", rpe:"6" }], { note:"great" }),
    ];
    const r = badSessionRatio(history, { readinessLog: [] });
    assert.equal(r.total, 3);
    assert.ok(r.ratio >= 0.5);
  });
  it("attributes an isolated bad session without overreacting", ()=>{
    const history = [
      mkSess("2026-01-01", "barbell-squat", [{ reps:"8", weightKg:"40", rpe:"7" }]),
      mkSess("2026-01-03", "barbell-squat", [{ reps:"8", weightKg:"40", rpe:"10" }], { note:"tired" }),
      mkSess("2026-01-05", "barbell-squat", [{ reps:"9", weightKg:"40", rpe:"7" }]),
    ];
    const r = badSessionAttribution(history, { readinessLog: [] });
    assert.equal(r.kind, "isolated");
    assert.ok(r.action.includes("conservative"));
  });
});

describe("plateau attribution", ()=>{
  const flatSets = rpe => [{ reps:"8", weightKg:"40", rpe }];
  it("calls a flat stretch with good readiness a genuine plateau", ()=>{
    const history = ["2026-01-01","2026-01-05","2026-01-09","2026-01-13"].map((d,i)=>
      mkSess(d, "barbell-squat", flatSets(i % 2 ? "8" : "7")));
    const r = plateauAttribution(history, "barbell-squat", { readinessLog: ["2026-01-01","2026-01-05","2026-01-09","2026-01-13"].map(d=>({ dateISO: d, score: 72 })) });
    assert.equal(r.kind, "genuine");
  });
  it("calls a flat stretch with bad sessions fatigue-driven, not a plateau", ()=>{
    const history = [
      mkSess("2026-01-01", "bench-press-dumbbell", [{ reps:"8", weightKg:"20", rpe:"7" }]),
      mkSess("2026-01-05", "bench-press-dumbbell", [{ reps:"8", weightKg:"20", rpe:"8" }]),
      mkSess("2026-01-09", "bench-press-dumbbell", [{ reps:"8", weightKg:"20", rpe:"10" }], { note:"sore and tired" }),
      mkSess("2026-01-13", "bench-press-dumbbell", [{ reps:"8", weightKg:"20", rpe:"10" }], { note:"struggled" }),
    ];
    const r = plateauAttribution(history, "bench-press-dumbbell", { readinessLog: [
      { dateISO:"2026-01-01", score: 75 }, { dateISO:"2026-01-05", score: 70 },
      { dateISO:"2026-01-09", score: 20 }, { dateISO:"2026-01-13", score: 22 },
    ] });
    assert.equal(r.kind, "bad-sessions");
  });
  it("needs 4+ sessions", ()=>{
    const r = plateauAttribution([mkSess("2026-01-01", "barbell-squat", [{ reps:"8", weightKg:"40", rpe:"7" }])], "barbell-squat");
    assert.equal(r.kind, "insufficient");
  });
  it("reports progress when strength is still moving", ()=>{
    const history = ["2026-01-01","2026-01-05","2026-01-09","2026-01-13"].map((d,i)=>
      mkSess(d, "barbell-squat", [{ reps: String(8+i), weightKg:"40", rpe:"7" }]));
    const r = plateauAttribution(history, "barbell-squat", { readinessLog: [] });
    assert.equal(r.kind, "progressing");
  });
});

describe("deload readiness assessment", ()=>{
  it("does not deload on a single one-day readiness dip", ()=>{
    const r = deloadReadinessAssessment({
      readinessHistory: [80, 75, 25],
      recentRpes: [], logs: [],
    });
    assert.equal(r.yes, false);
    assert.equal(r.oneDayDip, true);
    assert.ok(r.reason.includes("One-day"));
  });
  it("deloads on sustained low readiness plus other fatigue signals", ()=>{
    const r = deloadReadinessAssessment({
      readinessHistory: [30, 28, 25],
      recentRpes: ["9", "10"],
      logs: [
        { reps:8, weightKg:40, rpe:"9" }, { reps:8, weightKg:40, rpe:"9" },
        { reps:8, weightKg:40, rpe:"9" }, { reps:8, weightKg:40, rpe:"9" },
      ],
    });
    assert.equal(r.yes, true);
    assert.ok(r.signals.some(s=> s.includes("sustained low")));
  });
  it("ignores a dip when other signals are clean", ()=>{
    const r = deloadReadinessAssessment({ readinessHistory: [70, 72, 20] });
    assert.equal(r.yes, false);
    assert.equal(r.oneDayDip, true);
  });
});

describe("PR scan", ()=>{
  it("flags technique-changed and jitter records, keeps genuine PRs", ()=>{
    const history = [
      mkSess("2026-01-01", "bench-press-dumbbell", [{ reps:"8", weightKg:"20" }]),
      mkSess("2026-01-08", "bench-press-dumbbell", [{ reps:"8", weightKg:"22" }], { note:"great session" }),
      mkSess("2026-01-15", "bench-press-dumbbell", [{ reps:"8", weightKg:"23" }], { note:"reduced ROM for depth" }),
      mkSess("2026-01-22", "bench-press-dumbbell", [{ reps:"8", weightKg:"23.1" }]),
    ];
    const r = scanPRs(history, { readinessLog: [] });
    assert.equal(r.n, 3); // 22kg genuine, 23kg technique-changed, 23.1kg jitter
    assert.equal(r.flagged, 2);
    assert.equal(r.prs[0].meaningful, true);
    assert.equal(r.prs[1].meaningful, false);
    assert.ok(r.prs[1].flags.some(f=> f.includes("technique")));
    assert.ok(r.prs[2].flags.length === 0); // jitter is flagged by not-meaningful, no named flag
  });
});
