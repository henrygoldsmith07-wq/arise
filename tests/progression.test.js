import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recommendNext, isPlateau, isPlateauV2, isMeaningfulPR, classifyPR, rirFromRpe, readinessScore, readinessEMA, personalisedRate, validateProgression, strengthTrendWithConfidence, sideImbalance, strategyForExercise } from "../src/lib/progression.js";
import { scoreSubstitution, rankedSubstitutions, substitutionByPerformance, substitutionOptions } from "../src/lib/substitutions.js";
import { weeklyVolume, frequencyByMuscleSync, strengthSeries, volumeLandmarks, volumeDistribution, extractNoteRecommendations } from "../src/lib/analytics.js";
import { generateSession } from "../src/lib/sessionGenerator.js";
import { runMigrations, prsHitBySession, STORE_SCHEMA_VERSION } from "../src/lib/store.js";
import { syncUp, syncDown, mergeStoresWithConflicts } from "../src/lib/sync.js";
import { warmupSets, recommendedRest, predictSessionDuration, supersetScore } from "../src/lib/warmup.js";
import { EXERCISE_BY_ID } from "../src/lib/data.js";

describe("progression", ()=>{
  it("recommendNext: no history returns low reps", ()=>{
    const r=recommendNext({ exerciseId:"bench-press-dumbbell", history:[], targetReps:"8–12"});
    assert.equal(r.reps, 8);
  });
  it("bodyweight adds reps until top", ()=>{
    const hist=[{ dateISO:"2026-01-01", blocks:[{ exerciseId:"push-up", sets:[{reps:"10", weightKg:""}]}]}];
    const r=recommendNext({ exerciseId:"push-up", history: hist, targetReps:"8–12"});
    assert.equal(r.reps, 11);
  });
  it("isPlateau false for rising, true for flat", ()=>{
    assert.equal(isPlateau([{reps:8,weightKg:20},{reps:9,weightKg:20},{reps:10,weightKg:20}]), false);
    assert.equal(isPlateau([{reps:8,weightKg:20},{reps:8,weightKg:20},{reps:8,weightKg:20}]), true);
  });
  it("isPlateauV2 distinguishes noise", ()=>{
    // noisy RPE variance should not be plateau
    const noisy = [{reps:8,weightKg:20,rpe:'9'},{reps:8,weightKg:20,rpe:'5'},{reps:8,weightKg:20,rpe:'9'},{reps:8,weightKg:20,rpe:'6'}];
    const res = isPlateauV2(noisy);
    assert.equal(res.isPlateau, false);
  });
  it("rirFromRpe", ()=>{ assert.equal(rirFromRpe(8),2); assert.equal(rirFromRpe(null), null); });
  it("meaningful PR filters noise", ()=>{ assert.equal(isMeaningfulPR(100,101), false); assert.equal(isMeaningfulPR(100,103), true); });
  it("classifyPR respects technique change", ()=>{
    assert.equal(classifyPR({ priorBestE1rm:100, newE1rm:110, note:'paused ROM change' }).meaningful, false);
    assert.equal(classifyPR({ priorBestE1rm:100, newE1rm:110, note:'felt strong' }).meaningful, true);
  });
  it("readiness 1..5 maps 0..100", ()=>{ assert.ok(readinessScore({sleep:5,soreness:1,motivation:5})>80); assert.ok(readinessScore({sleep:1,soreness:5,motivation:1})<25); });
  it("readinessEMA smooths single-day outliers", ()=>{
    const ema = readinessEMA([60,62,58,61,10]);
    assert.ok(ema.value > 20 && ema.value < 60);
  });
  it("personalisedRate learns from history", ()=>{
    const hist = [
      { dateISO:'2026-01-01', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'8',weightKg:'20'}]}]},
      { dateISO:'2026-01-08', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'8',weightKg:'21'}]}]},
      { dateISO:'2026-01-15', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'8',weightKg:'22'}]}]},
      { dateISO:'2026-01-22', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'8',weightKg:'23'}]}]},
    ];
    const pr = personalisedRate(hist, 'bench-press-dumbbell');
    assert.ok(pr && pr.weeklyLoadPct > 0);
  });
  it("validateProgression returns metrics", ()=>{
    const hist = [
      { dateISO:'2026-01-01', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'8',weightKg:'20'}]}]},
      { dateISO:'2026-01-03', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'9',weightKg:'20'}]}]},
      { dateISO:'2026-01-06', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'10',weightKg:'20'}]}]},
    ];
    const v = validateProgression(hist);
    assert.ok(typeof v.n === 'number');
  });
  it("strengthTrendWithConfidence", ()=>{
    const logs=[{reps:8,weightKg:20},{reps:9,weightKg:20},{reps:10,weightKg:20}];
    const t=strengthTrendWithConfidence(logs);
    assert.ok(t.confidence);
  });
  it("sideImbalance", ()=>{
    const s=sideImbalance([{reps:'8',side:'L'},{reps:'6',side:'R'}]);
    assert.equal(s.weaker,'R');
  });
  it("strategyForExercise", ()=>{
    assert.equal(strategyForExercise('barbell-squat'),'strength');
  });
});
describe("substitutions", ()=>{
  it("ranks by muscle+pattern, respects equipment", ()=>{
    const ranked=rankedSubstitutions("bench-press-barbell", ["dumbbells","bench","bodyweight"]);
    assert.ok(ranked.length>0);
    assert.ok(ranked.every(r=> r.equipment.every(eq=>["dumbbells","bench","bodyweight"].includes(eq)) || (r.equipment.length===1 && r.equipment[0]==="bodyweight")));
  });
  it("scoreSubstitution higher for same muscle", ()=>{
    const target=EXERCISE_BY_ID["bench-press-barbell"], same=EXERCISE_BY_ID["bench-press-dumbbell"], diff=EXERCISE_BY_ID["run-easy"];
    assert.ok(scoreSubstitution(target,same) > scoreSubstitution(target,diff));
  });
  it("substitutionByPerformance prefers history", ()=>{
    const hist=[{dateISO:'2026-01-01', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'8',weightKg:'20'}]}]}];
    const subs = substitutionByPerformance('bench-press-barbell', hist, ['dumbbells','bench','bodyweight']);
    assert.ok(subs.length>0);
  });
  it("substitutionOptions explains an equipment-fit alternative", ()=>{
    const options = substitutionOptions('bench-press-barbell', { availableEquipment:['dumbbells','bench','bodyweight'], limit:4 });
    assert.ok(options.length>0);
    assert.ok(options.every(o=> o.equipmentFit));
    assert.ok(options.some(o=> o.id==='bench-press-dumbbell' && o.reason.length>5));
  });
});
describe("analytics + generator + sync + migrations", ()=>{
  it("weeklyVolume groups", ()=>{
    const h=[{dateISO:"2026-01-05", blocks:[{exerciseId:"bench-press-dumbbell", sets:[{reps:"8",weightKg:"20"}]}]}, {dateISO:"2026-01-06", blocks:[{exerciseId:"bench-press-dumbbell", sets:[{reps:"8",weightKg:"20"}]}]}];
    const w=weeklyVolume(h); assert.ok(w.length>=1); assert.ok(w[0].vol>0);
  });
  it("frequencyByMuscleSync counts via byId", ()=>{
    const h=[{dateISO:"2026-01-01", blocks:[{exerciseId:"push-up", sets:[{reps:"10",weightKg:""}]}]}];
    const f=frequencyByMuscleSync(h, EXERCISE_BY_ID); assert.equal(f["Chest"],1);
  });
  it("volumeLandmarks cautious", ()=>{
    const h=[{dateISO:"2026-01-05", blocks:[{exerciseId:"push-up", sets:[{reps:"10",weightKg:""}]}, {exerciseId:"bench-press-dumbbell", sets:[{reps:"8",weightKg:"20"}]}]}];
    const lm=volumeLandmarks(h, EXERCISE_BY_ID);
    assert.ok(lm['Chest']);
    assert.ok(lm['Chest'].note.includes('Rough'));
  });
  it("volumeDistribution", ()=>{
    const h=[{dateISO:"2026-01-01", blocks:[{exerciseId:"push-up", sets:[{reps:"10",weightKg:""}]}]}];
    const d=volumeDistribution(h, EXERCISE_BY_ID);
    assert.ok(d.totalSets>=1);
  });
  it("extractNoteRecommendations", ()=>{
    const h=[{dateISO:"2026-01-01", note:'next time try 22kg, add a set', blocks:[]}];
    const recs=extractNoteRecommendations(h);
    assert.ok(recs.length===1);
  });
  it("generateSession respects equipment and explains why", ()=>{
    const s=generateSession({ goal:"strength", availableEquipment:["bodyweight"], history:[], length:3});
    assert.ok(s.blocks.length===3); assert.ok(s.blocks.every(b=> b.why && b.why.length>5));
    assert.ok(typeof s.estimatedDurationMin === 'number');
  });
  it("warmupSets + rest + duration", ()=>{
    const w=warmupSets({ exerciseId:'bench-press-barbell', targetLoad:60, targetReps:5, lastSets:null });
    assert.ok(w.length>=1);
    const rest=recommendedRest({ exerciseId:'barbell-squat', load:80, rpe:9, setIndex:0, totalSets:4 });
    assert.ok(rest>=60);
    const dur=predictSessionDuration([{sets:3,restSec:90,warmups:w}]);
    assert.ok(dur>=5);
    assert.ok(supersetScore('push-up','band-row', EXERCISE_BY_ID) > 0.5);
  });
  it("runMigrations adds syncEnabled, activeWorkout and bumps to current schema", ()=>{ const m=runMigrations({ version:1, onboarding:null, history:[], preferences:{ units:"kg", theme:null }}); assert.equal(m.version,STORE_SCHEMA_VERSION); assert.equal(m.preferences.syncEnabled,false); assert.equal(m.activeWorkout,null); assert.deepEqual(m.eventHistory,[]); assert.equal(m.preferences.healthSummaryEnabled,false); });
  it("prsHitBySession respects ROM guard", ()=>{
    const prior=[{dateISO:'2026-01-01', note:'', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'8',weightKg:'20'}]}]}];
    const sess={dateISO:'2026-01-02', note:'partial ROM, not full depth', blocks:[{exerciseId:'bench-press-dumbbell', sets:[{reps:'8',weightKg:'30'}]}]};
    const hits=prsHitBySession(sess, prior);
    assert.equal(hits.length, 0);
  });
  it("syncUp/Down merge", async()=>{
    const store={ version:2, onboarding:null, history:[{ id:"a", dateISO:"2026-01-01", blocks:[]}], preferences:{units:"kg",theme:null}, activeSchedule:null};
    let pushed=null;
    const up=await syncUp(store, { push: async (p)=>{ pushed=p; }});
    assert.ok(pushed);
    const down=await syncDown({ ...store, history: [] }, { pull: async()=> JSON.stringify(up)}, "merge");
    assert.ok(down.history.some(h=> h.id==="a"));
  });
  it("mergeStoresWithConflicts last-write-wins", ()=>{
    const a={ id:'x', dateISO:'2026-01-01', savedAt:'2026-01-01T10:00:00Z', blocks:[] };
    const b={ id:'x', dateISO:'2026-01-01', savedAt:'2026-01-02T10:00:00Z', blocks:[{exerciseId:'push-up', sets:[{reps:'10',weightKg:''}]}] };
    const cur={ version:3, onboarding:null, history:[a], preferences:{}, readinessLog:[], programHistory:[], activeSchedule:null };
    const imp={ version:3, onboarding:null, history:[b], preferences:{}, readinessLog:[], programHistory:[], activeSchedule:null };
    const merged=mergeStoresWithConflicts(cur, imp);
    assert.equal(merged.history[0].blocks.length, 1);
  });
});
