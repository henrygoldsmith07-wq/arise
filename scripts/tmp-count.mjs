import { hydrateStorage, loadStoreFromIdb } from '../src/lib/storage.js';
import { idbGet } from '../src/lib/idb.js';

globalThis.localStorage = { _m:{}, getItem(k){ return k in this._m ? this._m[k] : null; }, setItem(k,v){ this._m[k]=String(v); }, removeItem(k){ delete this._m[k]; } };
const full = {
  version: 6,
  onboarding: { goal:'muscle', equipment:['dumbbells'], location:'home' },
  preferences: { units:'kg', theme:'dark', telemetryEnabled:true },
  healthSummary: null,
  activeSchedule: { programId:'p1', adaptationHistory:[{ basisKey:'w1', dateISO:'2026-01-12', changes:[] }], sessions:[] },
  programHistory: [ { programId:'p1', version:1, startDateISO:'2026-01-05' } ],
  history: [ { id:'h1', dateISO:'2026-01-05', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[{reps:'8',weightKg:'20',rpe:''}] }] } ],
  eventHistory: [], readinessLog: [], evaluationLedger: [], customTemplates: [],
};
localStorage.setItem('arise.store.v1', JSON.stringify(full));
await hydrateStorage();
console.log('programme record:', JSON.stringify(await idbGet('programme','active')));
const composed = await loadStoreFromIdb();
console.log('composed.activeSchedule:', JSON.stringify(composed?.activeSchedule));
