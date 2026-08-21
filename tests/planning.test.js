import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXERCISE_BY_ID, exerciseAvailable } from "../src/lib/data.js";
import { instantiateTemplate, recommendTemplate, templateVersionInfo, listTemplates } from "../src/lib/templates.js";
import { volumeBalanceAdvice } from "../src/lib/analytics.js";
import { fatigueAwareOrder, muscleOverlap, weakPointMuscles } from "../src/lib/warmup.js";

const KIT_BARBELL = ['barbell','dumbbells','bench','pullup-bar'];
const KIT_MINIMAL = ['bodyweight','dumbbells','bench'];
const KIT_BODY_ONLY = ['bodyweight'];

function allDoable(sessions, kit){
  // bodyweight is always available (matches the template engine's kit normalisation)
  return sessions.every(s=> s.blocks.every(b=> exerciseAvailable(b.exerciseId, [...kit, 'bodyweight'])));
}

describe("programme templates", ()=>{
  it("lists templates with their linked program", ()=>{
    const ts = listTemplates();
    assert.ok(ts.length >= 3);
    assert.ok(ts.every(t=> t.program && t.program.version >= 1));
  });
  it("instantiates a dated schedule; full kit needs no substitutions", ()=>{
    const t = instantiateTemplate({ templateId:'tpl-strength', startDateISO:'2026-08-17', availableEquipment: KIT_BARBELL });
    assert.equal(t.templateId, 'tpl-strength');
    assert.equal(t.sessions.length, 8); // strength-4x: 2 weeks × 4 days
    assert.equal(t.sessions[0].dateISO, '2026-08-17');
    assert.ok(allDoable(t.sessions, KIT_BARBELL));
    assert.equal(t.substitutions.length, 2); // goblet-squat needs a kettlebell (Lower B, weeks 1 & 2)
    assert.ok(t.substitutions.every(s=> s.from === 'goblet-squat'));
  });
  it("swaps missing equipment honestly and logs the swaps", ()=>{
    const t = instantiateTemplate({ templateId:'tpl-strength', startDateISO:'2026-08-17', availableEquipment: KIT_MINIMAL });
    assert.ok(t.substitutions.length >= 3);
    assert.ok(t.substitutions.every(s=> s.from !== s.to));
    assert.ok(allDoable(t.sessions, KIT_MINIMAL));
    // every block still carries the program version
    assert.ok(t.sessions.every(s=> s.blocks.every(b=> b.version === t.programVersion)));
  });
  it("bodyweight-only kit: swaps even the anywhere template's band work", ()=>{
    const t = instantiateTemplate({ templateId:'tpl-anywhere', startDateISO:'2026-08-17', availableEquipment: KIT_BODY_ONLY });
    assert.ok(t.substitutions.length >= 3); // band-row / band-lateral-raise / band-curl
    assert.ok(allDoable(t.sessions, KIT_BODY_ONLY));
  });
  it("throws on an unknown template", ()=>{
    assert.throws(()=> instantiateTemplate({ templateId:'nope', startDateISO:'2026-08-17' }), /Unknown template/);
  });
  it("recommends the strength template for a barbell strength profile", ()=>{
    const { top } = recommendTemplate({ goal:'strength', level:'Intermediate', availableEquipment: KIT_BARBELL, daysPerWeek: 4 });
    assert.equal(top.id, 'tpl-strength');
    assert.ok(top.reasons.some(r=> /full equipment fit/.test(r)));
  });
  it("recommends the anywhere template for a bodyweight-only beginner", ()=>{
    const { top } = recommendTemplate({ goal:'general', level:'Beginner', availableEquipment: KIT_BODY_ONLY, daysPerWeek: 3 });
    assert.equal(top.id, 'tpl-anywhere');
  });
  it("reports template and program version changelogs", ()=>{
    const info = templateVersionInfo('tpl-strength');
    assert.ok(info.templateChanges.length >= 1);
    assert.ok(info.programChanges.length >= 2);
    assert.equal(info.templateVersion, 1);
  });
});

describe("volume balance advice", ()=>{
  const mk = (dateISO, blocks)=> ({ dateISO, blocks });
  const bench = sets => ({ exerciseId:'bench-press-dumbbell', sets: Array.from({length:sets}, ()=>({reps:'8', weightKg:'20'})) });
  const squat = sets => ({ exerciseId:'bodyweight-squat', sets: Array.from({length:sets}, ()=>({reps:'12', weightKg:''})) });

  it("flags a neglected priority muscle and suggests a swap", ()=>{
    // 3 weeks, legs + chest every session, Back never trained
    const history = [];
    for(let w=0; w<3; w++){
      history.push(mk(`2026-0${1+w}-05`, [bench(3), squat(3)]));
      history.push(mk(`2026-0${1+w}-07`, [bench(3), squat(3)]));
    }
    const r = volumeBalanceAdvice(history, EXERCISE_BY_ID, { goal:'strength' });
    const back = r.entries.find(e=> e.muscle==='Back');
    const chest = r.entries.find(e=> e.muscle==='Chest');
    assert.equal(back.verdict, 'under');
    assert.equal(back.avgWeeklySets, 0);
    assert.equal(chest.verdict, 'over');
    assert.ok(r.advice.includes('Back'));
    assert.ok(r.advice.includes('swap'));
  });
  it("reports balanced when share matches the goal's priorities", ()=>{
    const history = [
      mk('2026-01-05', [bench(2), squat(2)]),
      mk('2026-01-07', [{exerciseId:'dumbbell-row', sets:[{reps:'8', weightKg:'10'},{reps:'8', weightKg:'10'}]}, {exerciseId:'lateral-raise', sets:[{reps:'12', weightKg:'5'},{reps:'12', weightKg:'5'}]}, {exerciseId:'hip-thrust', sets:[{reps:'10', weightKg:''},{reps:'10', weightKg:''}]}]),
      mk('2026-01-12', [bench(2), squat(2)]),
      mk('2026-01-14', [{exerciseId:'dumbbell-row', sets:[{reps:'8', weightKg:'10'},{reps:'8', weightKg:'10'}]}, {exerciseId:'lateral-raise', sets:[{reps:'12', weightKg:'5'},{reps:'12', weightKg:'5'}]}, {exerciseId:'hip-thrust', sets:[{reps:'10', weightKg:''},{reps:'10', weightKg:''}]}]),
    ];
    const r = volumeBalanceAdvice(history, EXERCISE_BY_ID, { goal:'strength' });
    assert.equal(r.entries.filter(e=> e.verdict==='balanced').length, 5);
    assert.ok(/looks balanced/.test(r.advice));
  });
  it("asks for a baseline with too little data", ()=>{
    const r = volumeBalanceAdvice([mk('2026-01-05', [bench(3)])], EXERCISE_BY_ID, { goal:'strength' });
    assert.ok(r.advice.includes('baseline'));
  });
});

describe("fatigue-aware ordering", ()=>{
  const blocks = () => [
    { exerciseId:'bodyweight-squat' }, // Legs
    { exerciseId:'bench-press-dumbbell' }, // Chest
    { exerciseId:'push-up' }, // Chest
    { exerciseId:'dumbbell-row' }, // Back
    { exerciseId:'plank' }, // Core
    { exerciseId:'run-easy' }, // Cardio
  ];

  it("keeps compounds early, cardio last, same-muscle pairs apart", ()=>{
    const bs = blocks();
    const order = fatigueAwareOrder(bs, EXERCISE_BY_ID);
    assert.equal(order[0].exerciseId, 'bodyweight-squat');
    assert.equal(order[order.length-1].exerciseId, 'run-easy');
    // no two exercises sharing a muscle/family sit back-to-back
    for(let i=0;i<order.length-1;i++) assert.ok(muscleOverlap(order[i].exerciseId, order[i+1].exerciseId, EXERCISE_BY_ID) < 1, `adjacent overlap at ${i}: ${order[i].exerciseId} → ${order[i+1].exerciseId}`);
    // isolation/core finishes late
    assert.ok(order.findIndex(b=> b.exerciseId==='plank') >= order.length - 3);
  });
  it("trains weak-point muscles while fresh", ()=>{
    const order = fatigueAwareOrder(blocks(), EXERCISE_BY_ID, { priorityMuscles: ['Back'] });
    const row = order.findIndex(b=> b.exerciseId==='dumbbell-row');
    const bench = order.findIndex(b=> b.exerciseId==='bench-press-dumbbell');
    assert.ok(row < bench, `expected Back row before Chest bench (got row@${row}, bench@${bench})`);
  });
  it("derives weak points from least-trained muscles", ()=>{
    const history = [
      { dateISO:'2026-01-05', blocks:[{exerciseId:'push-up'},{exerciseId:'bodyweight-squat'},{exerciseId:'plank'}] },
      { dateISO:'2026-01-07', blocks:[{exerciseId:'push-up'},{exerciseId:'dumbbell-row'},{exerciseId:'plank'}] },
      { dateISO:'2026-01-09', blocks:[{exerciseId:'bench-press-dumbbell'},{exerciseId:'plank'}] },
      { dateISO:'2026-01-11', blocks:[{exerciseId:'dumbbell-row'},{exerciseId:'dead-bug'}] },
    ];
    const weak = weakPointMuscles(history, EXERCISE_BY_ID);
    assert.deepEqual(weak, ['Legs','Back']); // trained 1× and 2× — least
  });
  it("scores same-muscle overlap highest, family overlap lower", ()=>{
    assert.equal(muscleOverlap('bench-press-dumbbell', 'push-up', EXERCISE_BY_ID), 1); // Chest/Chest
    assert.equal(muscleOverlap('bench-press-dumbbell', 'dumbbell-row', EXERCISE_BY_ID), 0); // Chest/Back
    assert.equal(muscleOverlap('bicep-curl', 'bench-press-dumbbell', EXERCISE_BY_ID), 0.6); // Arms/Chest share push family
    assert.equal(muscleOverlap('bench-press-dumbbell', 'bench-press-dumbbell', EXERCISE_BY_ID), 1);
  });
});
