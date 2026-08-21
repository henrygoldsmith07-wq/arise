import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  recommendNext, recommendSets, romProgression, trainingAgeMonths, trainingPhase, trainingBreakInfo,
  ageRateMultiplier, trainingAgeInfo,
} from "../src/lib/progression.js";
import {
  readinessPerformanceCorrelation, deloadOutcomes, mesocycleComparison,
  completionByExercise, recommendationFollowThrough, weeklyVolume,
} from "../src/lib/analytics.js";
import { generateSession } from "../src/lib/sessionGenerator.js";

const daysAgo = n => new Date(Date.now() - n*86400000).toISOString().slice(0,10);

describe("training age personalisation", ()=>{
  it("phases and multipliers", ()=>{
    assert.equal(trainingPhase(0), 'unknown');
    assert.equal(trainingPhase(3), 'novice');
    assert.equal(trainingPhase(12), 'intermediate');
    assert.equal(trainingPhase(30), 'advanced');
    assert.equal(ageRateMultiplier(3), 1.5);
    assert.equal(ageRateMultiplier(12), 1);
    assert.equal(ageRateMultiplier(30), 0.5);
  });
  it("trainingAgeMonths counts from first logged session", ()=>{
    const info = trainingAgeInfo([{ dateISO: daysAgo(100), blocks: [] }]);
    assert.equal(info.phase, 'novice');
    assert.ok(info.months > 2 && info.months < 4);
  });
  it("cold-start load bumps scale by training age", ()=>{
    // One session at 45kg×12 (top of range) with low RPE → load bump path.
    // Novice (3 weeks in): 45 × (1 + 0.025×1.5) = 46.6875 → snaps to 47.5
    // Advanced (30 months in): 45 × (1 + 0.025×0.5) = 45.56 → snaps back to 45
    const noviceHist = [{ dateISO: daysAgo(21), blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'12', weightKg:'45', rpe:'7'}]}] }];
    const advancedHist = [{ dateISO: daysAgo(900), blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'12', weightKg:'45', rpe:'7'}]}] }];
    const rn = recommendNext({ exerciseId:'bench-press-dumbbell', history: noviceHist, targetReps:'8–12' });
    const ra = recommendNext({ exerciseId:'bench-press-dumbbell', history: advancedHist, targetReps:'8–12' });
    assert.equal(rn.load, 47.5);
    assert.equal(ra.load, 45);
    assert.equal(rn.trainingAge.phase, 'novice');
    assert.equal(ra.trainingAge.phase, 'advanced');
  });
});

describe("assisted progression", ()=>{
  it("adds reps first, keeps assist", ()=>{
    const hist = [{ dateISO:'2026-01-01', blocks:[{exerciseId:'pull-up', sets:[{reps:'8', weightKg:'', assistedKg:'20'}]}] }];
    const r = recommendNext({ exerciseId:'pull-up', history: hist, targetReps:'8–12' });
    assert.equal(r.reps, 9);
    assert.equal(r.assistKg, 20);
  });
  it("reduces assist at top of range", ()=>{
    const hist = [{ dateISO:'2026-01-01', blocks:[{exerciseId:'pull-up', sets:[{reps:'12', weightKg:'', assistedKg:'20', rpe:'7'}]}] }];
    const r = recommendNext({ exerciseId:'pull-up', history: hist, targetReps:'8–12' });
    assert.equal(r.assistKg, 18); // snapLoad rounds sub-20kg to whole kg
    assert.equal(r.reps, 8);
    assert.ok(r.reason.includes('reduce assist'));
  });
  it("assist never drops below zero", ()=>{
    const hist = [{ dateISO:'2026-01-01', blocks:[{exerciseId:'pull-up', sets:[{reps:'12', weightKg:'', assistedKg:'2', rpe:'7'}]}] }];
    const r = recommendNext({ exerciseId:'pull-up', history: hist, targetReps:'8–12' });
    assert.equal(r.assistKg, 0);
    assert.ok(r.reason.includes('drop the assist'));
  });
  it("session generator surfaces assist in the load hint", ()=>{
    const hist = [{ dateISO:'2026-01-01', blocks:[{exerciseId:'pull-up', sets:[{reps:'12', weightKg:'', assistedKg:'20', rpe:'7'}]}] }];
    const s = generateSession({ goal:'general', availableEquipment:['pullup-bar','bodyweight'], history: hist, length:1, includeWarmup:false });
    const pull = s.blocks.find(b=> b.exerciseId==='pull-up');
    assert.ok(pull && pull.loadHint.includes('assist'));
  });
});

describe("set progression", ()=>{
  it("requires two distinct sessions, not two sets from one session", ()=>{
    const hist = [
      { dateISO:'2026-01-01', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'12', weightKg:'20', rpe:'7'},{reps:'12', weightKg:'20', rpe:'7'},{reps:'12', weightKg:'20', rpe:'7'}]}] },
    ];
    const r = recommendSets(hist, 'bench-press-dumbbell');
    assert.equal(r.add, false);
    assert.equal(r.sets, 3);
  });

  it("adds a set after two top-of-range sessions with room", ()=>{
    const hist = [
      { dateISO:'2026-01-01', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'12', weightKg:'20', rpe:'7'},{reps:'12', weightKg:'20', rpe:'7'},{reps:'12', weightKg:'20', rpe:'7'}]}] },
      { dateISO:'2026-01-03', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'12', weightKg:'20', rpe:'7'},{reps:'12', weightKg:'20', rpe:'7'},{reps:'12', weightKg:'20', rpe:'7'}]}] },
    ];
    const r = recommendSets(hist, 'bench-press-dumbbell');
    assert.equal(r.add, true);
    assert.equal(r.sets, 4);
  });
  it("holds when RPE was high", ()=>{
    const hist = [
      { dateISO:'2026-01-01', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'12', weightKg:'20', rpe:'9'},{reps:'12', weightKg:'20', rpe:'9'}]}] },
      { dateISO:'2026-01-03', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'12', weightKg:'20', rpe:'9'},{reps:'12', weightKg:'20', rpe:'9'}]}] },
    ];
    const r = recommendSets(hist, 'bench-press-dumbbell');
    assert.equal(r.add, false);
  });
  it("caps at maxSets", ()=>{
    const mk = n => [
      { dateISO:'2026-01-01', blocks:[{exerciseId:'bench-press-dumbbell', sets:Array.from({length:n},()=>({reps:'12', weightKg:'20', rpe:'7'}))}] },
      { dateISO:'2026-01-03', blocks:[{exerciseId:'bench-press-dumbbell', sets:Array.from({length:n},()=>({reps:'12', weightKg:'20', rpe:'7'}))}] },
    ];
    const r = recommendSets(mk(5), 'bench-press-dumbbell', { maxSets: 5 });
    assert.equal(r.sets, 5);
    assert.equal(r.add, false);
  });
});

describe("long-break recovery", ()=>{
  it("restarts conservatively after a long gap without erasing training age", ()=>{
    const hist = [{ dateISO:'2026-01-01', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'10', weightKg:'20', rpe:'7'}]}] }];
    const info = trainingBreakInfo(hist, { asOfDateISO:'2026-03-01' });
    assert.equal(info.hasBreak, true);
    const rec = recommendNext({ exerciseId:'bench-press-dumbbell', history:hist, targetReps:'8–12', asOfDateISO:'2026-03-01' });
    assert.equal(rec.reps, 8);
    assert.equal(rec.load, 16);
    assert.match(rec.reason, /break/i);
    assert.equal(rec.trainingAge.phase, 'novice');
  });

  it("does not trigger a return plan for a normal training gap", ()=>{
    const hist = [{ dateISO:'2026-01-01', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'10', weightKg:'20', rpe:'7'}]}] }];
    assert.equal(trainingBreakInfo(hist, { asOfDateISO:'2026-01-21' }).hasBreak, false);
  });
});

describe("ROM progression", ()=>{
  it("nudges deeper only at top of range", ()=>{
    const hist = [
      { dateISO:'2026-01-01', blocks:[{exerciseId:'barbell-squat', sets:[{reps:'12', weightKg:'40', rom:'parallel'}]}] },
      { dateISO:'2026-01-03', blocks:[{exerciseId:'barbell-squat', sets:[{reps:'12', weightKg:'40', rom:'parallel'}]}] },
    ];
    assert.equal(romProgression(hist, 'barbell-squat').next, 'full');
    const shallow = [
      { dateISO:'2026-01-01', blocks:[{exerciseId:'barbell-squat', sets:[{reps:'8', weightKg:'40', rom:'parallel'}]}] },
      { dateISO:'2026-01-03', blocks:[{exerciseId:'barbell-squat', sets:[{reps:'8', weightKg:'40', rom:'parallel'}]}] },
    ];
    assert.equal(romProgression(shallow, 'barbell-squat').next, null);
  });
  it("holds at full ROM and for unsupported exercises", ()=>{
    const full = [{ dateISO:'2026-01-01', blocks:[{exerciseId:'barbell-squat', sets:[{reps:'12', weightKg:'40', rom:'full'}]}] }];
    assert.equal(romProgression(full, 'barbell-squat').next, null);
    assert.equal(romProgression([], 'bicep-curl').supported, false);
  });
});

describe("weekly grouping", ()=>{
  it("keeps Monday-start weeks in one key (regression: deload detection)", ()=>{
    // 2026-01-05 is a Monday. Wed 7 Jan must share its key; Mon 12 Jan starts the next.
    const h = [
      { dateISO:'2026-01-05', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'8', weightKg:'10'}]}] },
      { dateISO:'2026-01-07', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'8', weightKg:'10'}]}] },
      { dateISO:'2026-01-12', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'8', weightKg:'10'}]}] },
    ];
    const wv = weeklyVolume(h);
    assert.equal(wv.length, 2);
    assert.equal(wv[0].vol, 160);
    assert.equal(wv[1].vol, 80);
  });
});

describe("readiness ↔ performance validation", ()=>{
  it("recovers a planted correlation with session RPE", ()=>{
    const readinessLog = ['2026-01-01','2026-01-03','2026-01-05','2026-01-07','2026-01-09','2026-01-11'].map((dateISO,i)=>({ dateISO, score: 90 - i*8 }));
    const history = ['2026-01-01','2026-01-03','2026-01-05','2026-01-07','2026-01-09','2026-01-11'].map((dateISO,i)=>({
      dateISO, blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'8', weightKg:'20', rpe:String(5+i)}]}],
    }));
    const r = readinessPerformanceCorrelation(history, readinessLog);
    assert.equal(r.n, 6);
    assert.ok(r.rRPE < -0.9);
  });
  it("falls back to nearest prior readiness within 3 days", ()=>{
    const readinessLog = [{ dateISO:'2026-01-01', score: 80 }];
    const history = [{ dateISO:'2026-01-02', blocks:[{exerciseId:'push-up', sets:[{reps:'10', weightKg:'', rpe:'6'}]}] }];
    const r = readinessPerformanceCorrelation(history, readinessLog);
    assert.equal(r.n, 1);
  });
  it("reports insufficient data gracefully", ()=>{
    const r = readinessPerformanceCorrelation([], []);
    assert.equal(r.n, 0);
    assert.ok(r.interpretation.includes('Not enough'));
  });
});

describe("deload outcomes", ()=>{
  it("detects a volume-cut week and measures the rebound", ()=>{
    const mk = (dateISO, sets) => ({ dateISO, blocks:[{exerciseId:'bench-press-dumbbell', sets}] });
    const history = [
      mk('2026-01-05', [{reps:'8',weightKg:'20'}]),
      mk('2026-01-12', [{reps:'8',weightKg:'21'}]),
      mk('2026-01-19', [{reps:'6',weightKg:'20'}]), // deload week
      mk('2026-01-26', [{reps:'8',weightKg:'22'}]),
      mk('2026-02-02', [{reps:'8',weightKg:'23'}]),
    ];
    const r = deloadOutcomes(history);
    assert.equal(r.n, 1);
    assert.equal(r.improvedRate, 100);
  });
});

describe("mesocycle comparison", ()=>{
  it("splits into ~4-week cycles and compares last vs previous", ()=>{
    const history = [];
    for(let i=0;i<9;i++) history.push({
      dateISO: new Date(Date.UTC(2026,0,5 + i*7)).toISOString().slice(0,10),
      blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'8', weightKg:String(20+i)}]}],
    });
    const r = mesocycleComparison(history);
    assert.ok(r.cycles.length >= 2);
    assert.ok(r.comparison);
    assert.ok(r.last.avgE1rm > r.previous.avgE1rm);
  });
  it("needs enough sessions", ()=>{
    const r = mesocycleComparison([{ dateISO:'2026-01-01', blocks:[] }]);
    assert.equal(r.cycles.length, 0);
  });
});

describe("planned vs completed per exercise", ()=>{
  it("flags skipped exercises", ()=>{
    const schedule = { sessions: [
      { id:'s1', dateISO:'2026-01-01', status:'done', blocks:[{exerciseId:'push-up'},{exerciseId:'plank'}] },
      { id:'s2', dateISO:'2026-01-03', status:'', blocks:[{exerciseId:'push-up'},{exerciseId:'plank'}] },
    ]};
    const history = [{ id:'s1', dateISO:'2026-01-01', blocks:[{exerciseId:'push-up', sets:[{reps:'10', weightKg:''}]}] }];
    const r = completionByExercise(schedule, history);
    assert.equal(r.total, 2);
    const pushUp = r.byExercise.find(x=> x.exerciseId==='push-up');
    const plank = r.byExercise.find(x=> x.exerciseId==='plank');
    assert.equal(pushUp.completionPct, 50);
    assert.equal(plank.skipped, 1);
  });
});

describe("recommendation follow-through", ()=>{
  it("gains are higher when recommendations are met", ()=>{
    const hist = [
      { dateISO:'2026-01-01', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'8',weightKg:'20'}]}] },
      { dateISO:'2026-01-03', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'9',weightKg:'20'}]}] },
      { dateISO:'2026-01-05', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'8',weightKg:'20'}]}] },
    ];
    const r = recommendationFollowThrough(hist);
    assert.equal(r.n, 2);
    assert.ok(r.followedPct >= 50);
    assert.ok(r.differential > 0);
  });
});
