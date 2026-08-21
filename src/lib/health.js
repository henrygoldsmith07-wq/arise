// Optional health-platform summary adapter. Arise never assumes a platform is
// present; a host can inject { pullSummary() } or { pullMetrics() }.

export const HEALTH_SUMMARY_VERSION = 1;

function numberOrNull(value){
  const n=Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normaliseHealthSummary(input, source='health-platform'){
  if(!input || typeof input!=='object') return null;
  const out={
    version: HEALTH_SUMMARY_VERSION,
    source: input.source || source,
    asOf: input.asOf || input.dateISO || input.updatedAt || new Date().toISOString(),
  };
  for(const key of ['steps','sleepHours','weightKg','restingHeartRate','activeMinutes']){
    const value=numberOrNull(input[key]);
    if(value!=null && value>=0) out[key]=value;
  }
  return Object.keys(out).length>3 ? out : null;
}

export function mergeHealthSummary(current, next){
  if(!next) return current || null;
  return { ...(current||{}), ...next, version: HEALTH_SUMMARY_VERSION, importedAt: new Date().toISOString() };
}

export async function pullHealthSummary(adapter){
  if(!adapter) return { ok:false, reason:'No health-platform adapter configured.' };
  const pull=adapter.pullSummary || adapter.pullMetrics;
  if(typeof pull!=='function') return { ok:false, reason:'Health adapter needs pullSummary() or pullMetrics().' };
  try{
    const raw=await pull();
    const summary=normaliseHealthSummary(raw, adapter.source || 'health-platform');
    return summary ? { ok:true, summary } : { ok:false, reason:'Adapter returned no recognised summary metrics.' };
  }catch(error){
    return { ok:false, reason:String(error?.message || error) };
  }
}
