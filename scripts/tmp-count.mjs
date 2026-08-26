import { recordRecommendation, attachOutcome, evaluateLongitudinal } from '../src/lib/longitudinal.js';

const CONSENT = { telemetryEnabled: true };
const mem = (()=>{ const m=new Map(); return { getItem:k=>(m.has(k)?m.get(k):null), setItem:(k,v)=>m.set(k,String(v)), removeItem:k=>m.delete(k) }; });
function sess(id,dateISO,exerciseId,sets){ return { id, dateISO, blocks:[{exerciseId,sets}] }; }
function set(r,w,rpe){ return { reps:String(r), weightKg:String(w), rpe:rpe==null?'':String(rpe) }; }
const PREFIX=[sess('a','2026-01-02','bench-press-dumbbell',[set(8,20,7)]), sess('b','2026-01-05','bench-press-dumbbell',[set(9,20,7)])];

const store = mem();
let day = 2;
for(let i = 0; i < 5; i++){
  const dISO = `2026-03-${String(day).padStart(2,'0')}`;
  day += 3;
  const history = [
    ...PREFIX.map((s,i2)=> ({ ...s, dateISO:`2026-02-${String(1+i2*3).padStart(2,'0')}` })),
    sess(`pre-${i}`, `2026-03-${String(Math.max(1,day-4)).padStart(2,'0')}`, 'bench-press-dumbbell', [set(9, 20, 7)]),
  ];
  recordRecommendation({ exerciseId:'bench-press-dumbbell', recommendation:{ load:22.5, reps:8 }, history, dueDateISO:dISO, targetReps:'8–12', assignedArm:'arise', participantId:'p-gates', preferences: CONSENT, storage: store });
  const res = attachOutcome({ sessionId:`real-${i}`, dateISO:dISO, blocks:[{ exerciseId:'bench-press-dumbbell', sets:[set(8, 22.5, 8)] }], preferences: CONSENT, storage: store });
  console.log(i, 'resolved:', res.length, 'assignedMet:', res[0]?.outcome?.assignedMet);
}
const raw = JSON.parse(store.getItem('arise.evaluation.v1'));
console.log('records:', raw.records.length, '| with outcome:', raw.records.filter(r=>r.outcome).length);
const ev = evaluateLongitudinal(raw.records);
console.log('byArm.arise:', JSON.stringify(ev.byArm.arise));
console.log('primary arise:', JSON.stringify(ev.primaryComparison.arise));
