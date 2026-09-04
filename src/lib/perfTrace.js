// perfTrace.js — User Timing marks for the hot paths we promise to keep fast.
//
// The session runner is the interaction surface where a stutter costs a set:
// opening the runner, completing the first set (mounts the rest dock and the
// numpad), and saving (runs progression + persistence). Each phase is marked
// with performance.mark/measure so Chrome DevTools' Performance panel and
// `performance.getEntriesByType('measure')` show named phases instead of a
// wall of anonymous script time. No-ops safely where the API is missing
// (tests, old browsers).
//
// Used by the perf smoke test (e2e/perf.spec.js) as the source of truth for
// interaction-latency budgets: the test reads the same measures the trace
// emits, so a budget failure points at the exact phase that regressed.

const enabled = typeof performance !== 'undefined' && typeof performance.mark === 'function' && typeof performance.measure === 'function';

const open = new Map();

export function traceStart(name){
  if(!enabled) return;
  try{ performance.mark(`${name}:start`); open.set(name, performance.now()); }catch{}
}

export function traceEnd(name, detail){
  if(!enabled) return;
  try{
    const startedAt = open.get(name);
    if(startedAt == null) return;
    open.delete(name);
    performance.measure(name, { start: `${name}:start`, detail: detail == null ? null : String(detail) });
  }catch{}
}

// One-shot phase: mark → fn → measure. Returns fn's result unchanged.
export function tracePhase(name, fn, detail){
  traceStart(name);
  try{
    const result = fn();
    traceEnd(name, detail);
    return result;
  }catch(error){
    traceEnd(name, `error: ${error?.message || error}`);
    throw error;
  }
}

export function tracesFor(names){
  if(!enabled || typeof performance.getEntriesByType !== 'function') return [];
  const all = performance.getEntriesByType('measure');
  return names.map((name)=> {
    const entries = all.filter((m)=> m.name === name);
    return { name, durationMs: entries.length ? Math.round(entries[entries.length-1].duration) : null };
  });
}
