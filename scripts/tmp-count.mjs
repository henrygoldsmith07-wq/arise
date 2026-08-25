import { recordRecommendation, evaluateLongitudinal } from '../src/lib/longitudinal.js';

const CONSENT = { telemetryEnabled: true };
const mem = (()=>{ const m=new Map(); return { getItem:k=>m.get(k)??null, setItem:(k,v)=>m.set(k,String(v)), removeItem:k=>m.delete(k) }; })();
function sess(id,dateISO,sets){ return { id, dateISO, blocks:[{exerciseId:'bench-press-dumbbell',sets}] }; }
const set=(r,w,rpe)=>({reps:String(r),weightKg:String(w),rpe:rpe==null?'':String(rpe)});
const PREFIX=[sess('a','2026-01-02',[set(8,20,7)]), sess('b','2026-01-05',[set(9,20,7)])];

const base = { exerciseId:'bench-press-dumbbell', recommendation:{ load:22.5, reps:8 }, history: PREFIX, dueDateISO:'2026-01-08', targetReps:'8–12', preferences: CONSENT, storage: mem };
const r1 = recordRecommendation(base);
const r2 = recordRecommendation({ ...base, config: { progressionModel: { version: 2 } } });
console.log('policy1:', JSON.stringify(r1.policy));
console.log('policy2:', JSON.stringify(r2.policy));
attachOutcomeShim();
const ev = evaluateLongitudinal(requireLedger(mem));
console.log('byPolicyVersion keys:', Object.keys(ev.byPolicyVersion));
console.log('mixed:', ev.mixedPolicyVersions);

function attachOutcomeShim(){}
function requireLedger(store){ const raw=JSON.parse(store.getItem('arise.evaluation.v1')||'{"records":[]}'); return raw.records||[]; }
